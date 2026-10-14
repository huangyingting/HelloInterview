import { randomBytes } from 'node:crypto';
import type { NextAuthOptions } from 'next-auth';
import FacebookProvider from 'next-auth/providers/facebook';
import GoogleProvider from 'next-auth/providers/google';
import { admitSocialIdentity } from './admission';
import { studioAuthAdapter } from './adapter';
import { loadAuthSettings } from './config';
import { recordAuthAdmission } from './request-context';

export function createAuthOptions(): NextAuthOptions {
  const settings = loadAuthSettings();
  if (!settings) throw new Error('Auth.js is not configured.');
  const secureCookies = settings.origin.startsWith('https://');
  return {
    secret: settings.secret,
    adapter: studioAuthAdapter(),
    session: {
      strategy: 'database',
      maxAge: 30 * 24 * 60 * 60,
      updateAge: 30 * 24 * 60 * 60,
      generateSessionToken: () => randomBytes(32).toString('hex'),
    },
    cookies: {
      sessionToken: {
        name: secureCookies ? '__Host-studio_session' : 'studio_session',
        options: { httpOnly: true, sameSite: 'lax', path: '/', secure: secureCookies },
      },
    },
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
          recordAuthAdmission(await admitSocialIdentity(settings, account, profile));
          return true;
        } catch (error) {
          console.error(JSON.stringify({ event: 'auth.admission.denied', reason: error instanceof Error ? error.message : 'unknown' }));
          return false;
        }
      },
      async session({ session, user }) {
        if (session.user) session.user.id = user.id;
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
