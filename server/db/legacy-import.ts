import { createHash } from 'node:crypto';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { z } from 'zod';
import { emptyState } from '../../shared/domain';
import type { UserState } from '../../shared/types';
import type { Database, DatabaseRow } from './connection';
import { assertDatabaseVersion } from './migrations';
import { StateRepository } from './state-repository';
import { userStateSchema } from './state-schema';

const legacyUser = z.strictObject({ id: z.string().min(1), name: z.string().min(1), email: z.string().min(1), demo: z.literal(0) });
const relationalColumns = {
  posts: ['id', 'kind', 'title', 'body', 'company', 'track', 'level', 'region', 'author', 'author_id', 'created_at', 'sample'],
  votes: ['post_id', 'user_id'],
  follows: ['post_id', 'user_id'],
  comments: ['id', 'resource', 'user_id', 'author', 'body', 'created_at', 'parent_id'],
  support: ['id', 'user_id', 'email', 'body', 'created_at'],
} as const;

export interface ImportReport {
  readonly fingerprint: string;
  readonly selectedUsers: number;
  readonly excludedDemoUsers: number;
  readonly excludedOtherUsers: number;
  readonly skippedSessions: number;
  readonly skippedGifts: number;
  readonly records: Record<string, { imported: number; excluded: number }>;
  readonly stateChecksums: string[];
}
interface ImportedUser {
  user: z.infer<typeof legacyUser>;
  raw: string;
  checksum: string;
  state: UserState;
}
export interface LegacyImport {
  readonly report: ImportReport;
  readonly users: readonly ImportedUser[];
  readonly records: Readonly<Record<keyof typeof relationalColumns, DatabaseRow[]>>;
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function inspectLegacyImport(source: string, selectedUserIds: readonly string[]): LegacyImport {
  if (!selectedUserIds.length || new Set(selectedUserIds).size !== selectedUserIds.length) throw new Error('Select a nonempty, distinct, owner-approved user allowlist.');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('The legacy backup failed integrity checks. Nothing has been imported.');
    const accounts = db.prepare('SELECT id,name,email,demo FROM users ORDER BY id').all();
    const chosen = new Set(selectedUserIds);
    const users: ImportedUser[] = [];
    for (const id of [...chosen].sort()) {
      const row = accounts.find(account => account.id === id);
      if (!row || row.demo !== 0) throw new Error('Every selected legacy account must exist and must not be a demo account.');
      const user = legacyUser.parse(row);
      const saved = db.prepare('SELECT value FROM states WHERE user_id=?').get(id);
      if (!saved || typeof saved.value !== 'string') throw new Error('A selected account is missing its saved state.');
      const parsed: unknown = JSON.parse(saved.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('A selected account has invalid saved state.');
      const combined = { ...emptyState(), ...parsed };
      const checked = userStateSchema.parse(combined);
      if (canonical(checked) !== canonical(combined)) throw new Error('Legacy state normalization would change stored values. Resolve the mismatch before importing.');
      users.push({ user, raw: saved.value, checksum: digest(saved.value), state: { ...checked, plan: 'free', planExpiresAt: null } });
    }
    const sourceRecords = Object.fromEntries(Object.entries(relationalColumns).map(([table, columns]) => {
      const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      if (canonical([...actual].sort()) !== canonical([...columns].sort())) throw new Error('The legacy relational schema is unsupported. Resolve schema drift before importing.');
      return [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${columns.join(',')}`).all()];
    })) as Record<keyof typeof relationalColumns, DatabaseRow[]>;
    const posts = sourceRecords.posts.filter(row => chosen.has(String(row.author_id)) && row.sample === 0);
    const postIds = new Set(posts.map(row => row.id));
    const records = {
      posts,
      votes: sourceRecords.votes.filter(row => chosen.has(String(row.user_id)) && postIds.has(row.post_id)),
      follows: sourceRecords.follows.filter(row => chosen.has(String(row.user_id)) && postIds.has(row.post_id)),
      comments: sourceRecords.comments.filter(row => chosen.has(String(row.user_id))),
      support: sourceRecords.support.filter(row => chosen.has(String(row.user_id))),
    };
    const commentIds = new Set(records.comments.map(row => row.id));
    if (records.comments.some(row => row.parent_id !== null && !commentIds.has(row.parent_id))) throw new Error('Selected replies refer to unselected comments. Expand the approved allowlist or resolve the relationship explicitly.');
    const report: ImportReport = {
      fingerprint: digest(canonical({ users: users.map(item => ({ user: item.user, checksum: item.checksum })), records })),
      selectedUsers: users.length,
      excludedDemoUsers: accounts.filter(account => account.demo !== 0).length,
      excludedOtherUsers: accounts.filter(account => account.demo === 0 && !chosen.has(String(account.id))).length,
      skippedSessions: Number(db.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count),
      skippedGifts: Number(db.prepare('SELECT COUNT(*) AS count FROM gifts').get()!.count),
      records: Object.fromEntries(Object.keys(records).map(key => {
        const table = key as keyof typeof relationalColumns;
        return [table, { imported: records[table].length, excluded: sourceRecords[table].length - records[table].length }];
      })),
      stateChecksums: users.map(item => item.checksum),
    };
    db.exec('COMMIT');
    return { report, users, records };
  } finally {
    db.close();
  }
}

export async function applyLegacyImport(db: Database, input: LegacyImport, approvedFingerprint: string): Promise<void> {
  if (db.dialect !== 'postgres' || approvedFingerprint !== input.report.fingerprint) throw new Error('Applying an import requires PostgreSQL and the exact approved dry-run fingerprint.');
  await assertDatabaseVersion(db);
  await db.transaction(async () => {
    await db.prepare('SELECT pg_advisory_xact_lock(?)').get(749131621);
    if (await db.prepare('SELECT fingerprint FROM legacy_imports WHERE fingerprint=?').get(input.report.fingerprint)) throw new Error('This legacy snapshot was already imported. It will not overwrite newer records.');
    const states = new StateRepository(db);
    await db.prepare('INSERT INTO legacy_imports (fingerprint,summary) VALUES (?,?)').run(input.report.fingerprint, JSON.stringify(input.report));
    for (const item of input.users) {
      await db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,NULL,0)').run(item.user.id, item.user.name, item.user.email);
      await states.initialize(item.user.id, item.state);
      const restored = await states.read(item.user.id);
      if (canonical(restored) !== canonical(item.state)) throw new Error('An imported account failed state reconciliation. The entire import will roll back.');
      await db.prepare('INSERT INTO legacy_state_snapshots (user_id,version,value,checksum,import_fingerprint) VALUES (?,?,?,?,?)').run(item.user.id, 'legacy-v1', item.raw, item.checksum, input.report.fingerprint);
    }
    for (const [name, columns] of Object.entries(relationalColumns)) {
      const table = name as keyof typeof relationalColumns;
      for (const row of input.records[table]) {
        const values = columns.map(column => {
          const value = row[column];
          if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('Unsupported legacy relational value. The entire import will roll back.');
          return value as SQLInputValue;
        });
        await db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...values);
      }
    }
  });
}
