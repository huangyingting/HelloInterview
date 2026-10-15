function normalizeOrigin(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export function getPublicAppOrigin(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    normalizeOrigin(env.APP_URL) ??
    normalizeOrigin(env.NEXT_PUBLIC_APP_URL) ??
    normalizeOrigin(env.NEXTAUTH_URL) ??
    'http://localhost:3000'
  );
}

export function buildInvitationAcceptUrl(token: string): string {
  return `${getPublicAppOrigin()}/invite/${encodeURIComponent(token)}`;
}

export function buildEmailVerificationUrl(token: string): string {
  return `${getPublicAppOrigin()}/verify-email/${encodeURIComponent(token)}`;
}

export function buildPasswordResetUrl(token: string): string {
  return `${getPublicAppOrigin()}/reset-password/${encodeURIComponent(token)}`;
}
