import NextAuth from 'next-auth';
import type { NextAuthOptions } from 'next-auth';
import { loadAuthSettings } from '../../../../server/auth/config';
import { clearSocialLinkCookie } from '../../../../server/auth/linking';
import { createAuthOptions } from '../../../../server/auth/options';
import { withAuthRequest } from '../../../../server/auth/request-context';

type RouteContext = { params: Promise<{ nextauth: string[] }> };

async function handle(request: Request, context: RouteContext) {
  let options: NextAuthOptions;
  try {
    options = createAuthOptions();
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.configuration.failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 });
  }
  const response = await withAuthRequest(request, () => NextAuth(options)(request, context));
  const settings = loadAuthSettings();
  if (settings && new URL(request.url).pathname.includes('/api/auth/callback/')) {
    response.headers.append('Set-Cookie', clearSocialLinkCookie(settings));
  }
  return response;
}

export { handle as GET, handle as POST };
