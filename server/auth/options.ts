import type { NextAuthOptions } from 'next-auth';
import FacebookProvider from 'next-auth/providers/facebook';
import GoogleProvider from 'next-auth/providers/google';
import { admitSocialIdentity, socialIdentityOwner } from './admission';
import { loadAuthSettings } from './config';

export function createAuthOptions(): NextAuthOptions {
  const settings = loadAuthSettings();
  if (!settings) throw new Error('Auth.js is not configured.');
  return {
    secret: settings.secret,
    session: { strategy: 'jwt', maxAge: 30 * 60 },
    pages: { signIn: '/auth', error: '/auth' },
    providers: [
      GoogleProvider({
        clientId: settings.google.clientId,
        clientSecret: settings.google.clientSecret,
        authorization: { params: { prompt: 'select_account', scope: 'openid email profile' } },
      }),
      FacebookProvider({
        clientId: settings.facebook.clientId,
        clientSecret: settings.facebook.clientSecret,
        authorization: { params: { scope: 'public_profile,email' } },
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        if (!account || !profile) return false;
        try {
          await admitSocialIdentity(settings, account, profile);
          return true;
        } catch (error) {
          console.error(JSON.stringify({ event: 'auth.admission.denied', reason: error instanceof Error ? error.message : 'unknown' }));
          return false;
        }
      },
      async jwt({ token, account }) {
        if (account) token.studioUserId = await socialIdentityOwner(account);
        return token;
      },
      async session({ session, token }) {
        if (session.user && typeof token.studioUserId === 'string') session.user.id = token.studioUserId;
        return session;
      },
      redirect({ url, baseUrl }) {
        if (url.startsWith('/')) return `${baseUrl}${url}`;
        try { return new URL(url).origin === baseUrl ? url : `${baseUrl}/dashboard`; }
        catch { return `${baseUrl}/dashboard`; }
      },
    },
  };
}
