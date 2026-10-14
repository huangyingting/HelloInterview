import NextAuth from 'next-auth';
import { createAuthOptions } from '../../../../server/auth/options';
import { withAuthRequest } from '../../../../server/auth/request-context';

type RouteContext = { params: Promise<{ nextauth: string[] }> };

async function handle(request: Request, context: RouteContext) {
  try {
    return withAuthRequest(() => NextAuth(createAuthOptions())(request, context));
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth.configuration.failed', reason: error instanceof Error ? error.name : 'unknown' }));
    return Response.json({ error: 'Authentication is not configured.' }, { status: 503 });
  }
}

export { handle as GET, handle as POST };
