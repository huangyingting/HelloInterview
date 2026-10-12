import type { CommunityKind } from './types';

export const communityKinds = ['questions','stories','submissions','discussion'] as const;
export function isCommunityKind(value: unknown): value is CommunityKind {
  return communityKinds.some(kind => kind === value);
}
interface CommunityAddress { kind: CommunityKind; id: string; track?: string }
interface StudioAddress { segments: string[]; invalid: boolean; detail?: CommunityAddress; track?: string }
function postQuery({ kind, id, track }: CommunityAddress) {
  return new URLSearchParams({ kind, id, ...(track ? { track } : {}) }).toString();
}
export function communityPostPath(post: CommunityAddress) {
  return `/community/post?${postQuery(post)}`;
}
export function communityPostApi(post: CommunityAddress) {
  return `/api/community/post?${postQuery(post)}`;
}
export function communityFeedPath(kind: CommunityKind, track = '') {
  return `/community/${kind}${kind === 'submissions' && track ? `?${new URLSearchParams({ track })}` : ''}`;
}
function bounded(value: string, max: number) {
  return value.length <= max && !value.includes('\0');
}
export function parseStudioAddress(path: string, search: string): StudioAddress {
  let segments: string[];
  try {
    segments = path.split('/').filter(Boolean).map(decodeURIComponent);
    decodeURIComponent(search.replaceAll('+', ' '));
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return { segments: [], invalid: true };
  }
  const invalid = () => ({ segments, invalid: true });
  if (segments.some(segment => segment.includes('\0'))) return invalid();
  const params = new URLSearchParams(search);
  if (segments[0] === 'community' && segments[1] === 'post') {
    if (segments.length !== 2 || [...params.keys()].some(key =>
      !['kind','id','track'].includes(key) || params.getAll(key).length !== 1)) return invalid();
    const kind = params.get('kind'), id = params.get('id'), track = params.get('track') ?? '';
    if (!isCommunityKind(kind) || id === null || !id.length || !bounded(id, 200) || !bounded(track, 80)) return invalid();
    return { segments, invalid: false, detail: { kind, id, track } };
  }
  const track = segments[0] === 'community' && segments[1] === 'submissions' && segments.length === 2 ? params.get('track') ?? '' : '';
  if (!bounded(track, 80) || segments[0] === 'community' && segments[1] === 'submissions' && segments.length === 2 && params.getAll('track').length > 1) return invalid();
  return { segments, invalid: false, track };
}
