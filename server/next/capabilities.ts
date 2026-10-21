import { HttpError } from '../http-error';

export function communityParticipationEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = env.COMMUNITY_WRITES_ENABLED;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('COMMUNITY_WRITES_ENABLED must be true or false.');
  }
  return value === 'true';
}

export function assertCommunityParticipation() {
  if (!communityParticipationEnabled()) {
    throw new HttpError(403, 'Community publishing is currently read-only. Your saved contributions are unchanged.');
  }
}
