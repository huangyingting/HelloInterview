import { z } from 'zod';
import type { CommunityFeed, CommunityPost } from '../shared/types';
import type { Database } from './db/connection';
import { HttpError } from './http-error';
import { digest, encodePayload } from './jobs/schema';
import { communityKinds } from '../shared/community-routes';

const kindSchema = z.enum(communityKinds);
const text = (max: number) => z.string().max(max).refine(value => !value.includes('\0'));
const querySchema = z.strictObject({
  kind: kindSchema.optional(), q: text(200).default(''), company: text(80).default(''), level: text(40).default(''),
  region: text(40).default(''), track: text(80).default(''), sort: z.enum(['recent','popular']).default('recent'),
  scope: z.enum(['all','mine','following']).default('all'),
  limit: z.enum(['6','20','50']).transform(Number).default(6), cursor: z.string().max(2048).optional(),
});
export const communityIdentifierSchema = text(200).min(1);
const identifier = communityIdentifierSchema;
export const communityActionSchema = z.strictObject({ id: identifier, action: z.enum(['vote','follow']), enabled: z.boolean() });
export function communityIdentifier(value: unknown) {
  const parsed = identifier.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Choose a valid exact community identifier.');
  return parsed.data;
}
export function communityDiscussionResource(value: unknown) {
  if (typeof value === 'string' && !value.startsWith('post/') && value.trimStart().startsWith('post/')) throw new HttpError(400, 'Post discussions require an exact resource identifier.');
  if (typeof value === 'string' && value.startsWith('post/')) {
    communityIdentifier(value.slice(5));
    return value;
  }
  const parsed = z.string().trim().min(1).max(150).refine(value => !value.includes('\0')).safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Invalid Comment resource.');
  return parsed.data;
}
export function communityPageCursor<T extends { hash: string }>(encoded: string | undefined, schema: z.ZodType<T>, hash: string): T | undefined {
  if (encoded === undefined) return;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new HttpError(400, 'Invalid community cursor.');
  const bytes = Buffer.from(encoded,'base64url');
  if (bytes.toString('base64url') !== encoded) throw new HttpError(400, 'Invalid community cursor.');
  const json = bytes.toString('utf8');
  if (!Buffer.from(json,'utf8').equals(bytes)) throw new HttpError(400, 'Invalid community cursor.');
  let value: unknown;
  try { value = JSON.parse(json); }
  catch(error) { if (!(error instanceof SyntaxError)) throw error; throw new HttpError(400,'Invalid community cursor.'); }
  const saved = schema.safeParse(value);
  if (!saved.success || saved.data.hash !== hash) throw new HttpError(400, 'This cursor belongs to another query or viewer; reload the feed.');
  return saved.data;
}
const flag = z.union([z.boolean(),z.literal(0),z.literal(1)]).transform(Boolean);
const rowSchema = z.object({
  id: identifier, kind: kindSchema, title: text(200), body: text(10000), company: text(80), track: text(80),
  level: text(40), region: text(40), author: text(200), createdAt: z.iso.datetime(),
  votes: z.coerce.number().int().nonnegative().safe(), voted: flag, followed: flag, sample: flag, isMine: flag,
});
const cursorSchema = z.strictObject({ version: z.literal('community-feed-v1'), hash: z.string().regex(/^[a-f0-9]{64}$/),
  id: identifier, createdAt: z.iso.datetime(), votes: z.number().int().nonnegative().safe() });
function post(value: unknown): CommunityPost {
  const row = rowSchema.parse(value);
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, company: row.company, track: row.track,
    level: row.level, region: row.region, author: row.kind === 'questions' ? 'Anonymous' : row.author,
    createdAt: row.createdAt, votes: row.votes, voted: row.voted, followed: row.followed, sample: row.sample, isMine: row.isMine };
}

export class CommunityReads {
  constructor(private readonly db: Database) {}
  private selection(full: boolean) {
    return `p.id,p.kind,p.title,${full ? 'p.body' : 'substr(p.body,1,241)'} AS body,p.company,p.track,p.level,p.region,
      CASE WHEN p.kind='questions' THEN 'Anonymous' ELSE p.author END AS author,p.created_at AS "createdAt",p.sample,
      (SELECT COUNT(*) FROM votes WHERE post_id=p.id) AS votes,
      EXISTS(SELECT 1 FROM votes WHERE post_id=p.id AND user_id=?) AS voted,
      EXISTS(SELECT 1 FROM follows WHERE post_id=p.id AND user_id=?) AS followed,p.author_id=? AS "isMine"`;
  }
  async legacy(input: unknown, viewer: string | null) {
    const kind = kindSchema.safeParse(input);
    if (!kind.success) throw new HttpError(400, 'Choose a supported community section.');
    const rows = await this.db.prepare(`SELECT ${this.selection(true)} FROM posts p WHERE p.kind=?
      ORDER BY p.created_at DESC,p.id DESC LIMIT 1001`).all(viewer ?? '',viewer ?? '',viewer ?? '',kind.data);
    return { posts: rows.slice(0,1000).map(post), truncated: rows.length > 1000 };
  }
  async detail(id: unknown, input: unknown, viewer: string | null) {
    const parsedId = identifier.safeParse(id), query = z.strictObject({ kind: kindSchema, track: text(80).optional() }).safeParse(input);
    if (!parsedId.success || !query.success) throw new HttpError(400, 'Choose a valid community post and section.');
    const row = await this.db.prepare(`SELECT ${this.selection(true)} FROM posts p WHERE p.id=? AND p.kind=?
      ${query.data.track ? 'AND p.track=?' : ''}`)
      .get(viewer ?? '',viewer ?? '',viewer ?? '',parsedId.data,query.data.kind,...(query.data.track ? [query.data.track] : []));
    if (!row) throw new HttpError(404, 'Community post not found in this section.');
    return post(row);
  }
  async addressedDetail(input: unknown, viewer: string | null) {
    const query = z.strictObject({ id: identifier, kind: kindSchema, track: text(80).optional() }).safeParse(input);
    if (!query.success) throw new HttpError(400, 'Choose a valid community post and section.');
    const { id, ...selection } = query.data;
    return this.detail(id, selection, viewer);
  }
  async feed(input: unknown, viewer: string | null): Promise<CommunityFeed> {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) throw new HttpError(400, 'Invalid community filter, sort, page size or cursor.');
    const { cursor: encoded, ...query } = parsed.data;
    if (query.scope !== 'all' && !viewer) throw new HttpError(401, 'Sign in to read your own or followed contributions.');
    const hash = digest(encodePayload({ query, viewer }));
    const cursor = communityPageCursor(encoded,cursorSchema,hash);
    const clauses: string[] = [], values: string[] = [];
    for (const [field,value] of Object.entries({ kind: query.kind, company: query.company, level: query.level, region: query.region, track: query.track })) {
      if (value) { clauses.push(`p.${field}=?`); values.push(value); }
    }
    if (query.q) {
      const fold = this.db.dialect === 'sqlite' ? 'studio_casefold' : 'lower';
      clauses.push(`${fold}(p.title || ' ' || p.body || ' ' || p.company || ' ' || p.kind) LIKE ? ESCAPE '\\'`);
      values.push(`%${query.q.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`);
    }
    if (query.scope !== 'all') {
      if (!viewer) throw new HttpError(401, 'Sign in to read your own or followed contributions.');
      clauses.push(query.scope === 'mine' ? 'p.author_id=?' : 'EXISTS(SELECT 1 FROM follows WHERE post_id=p.id AND user_id=?)');
      values.push(viewer);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const order = `${query.sort === 'popular' ? 'votes DESC,' : ''}"createdAt" DESC,id DESC`;
    const boundary = cursor ? query.sort === 'popular' ? 'WHERE (votes,"createdAt",id)<(?,?,?)' : 'WHERE ("createdAt",id)<(?,?)' : '';
    const boundaryValues = cursor ? query.sort === 'popular' ? [cursor.votes,cursor.createdAt,cursor.id] : [cursor.createdAt,cursor.id] : [];
    const rows = await this.db.prepare(`WITH counted AS (SELECT COUNT(*) AS total FROM posts p ${where}),
      page AS (SELECT * FROM (SELECT ${this.selection(false)} FROM posts p ${where}) feed ${boundary} ORDER BY ${order} LIMIT ?)
      SELECT page.*,counted.total FROM counted LEFT JOIN page ON true ORDER BY ${order}`)
      .all(...values,viewer ?? '',viewer ?? '',viewer ?? '',...values,...boundaryValues,query.limit+1);
    const total = z.coerce.number().int().nonnegative().safe().parse(rows[0]?.total);
    const page = rows.filter(row => row.id !== null), posts = page.slice(0,query.limit).map(post), last = posts.at(-1);
    const nextCursor = page.length > query.limit && last ? Buffer.from(JSON.stringify({ version:'community-feed-v1',hash,
      id:last.id,createdAt:last.createdAt,votes:last.votes })).toString('base64url') : null;
    const companies = await this.db.prepare(`SELECT DISTINCT company FROM posts WHERE company<>'' ${query.kind ? 'AND kind=?' : ''}
      ORDER BY company LIMIT 201`).all(...(query.kind ? [query.kind] : []));
    return { posts,total,limit:query.limit,nextCursor,companies:companies.slice(0,200).map(row => text(80).parse(row.company)),
      companyOptionsTruncated:companies.length>200 };
  }
}
