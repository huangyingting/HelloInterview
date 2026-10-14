import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthAdmission {
  readonly userId: string;
  readonly identityId: string;
}

interface AuthRequestContext {
  readonly cookieHeader: string;
  admission?: AuthAdmission;
}

const authRequests = new AsyncLocalStorage<AuthRequestContext>();

export function withAuthRequest<T>(request: Request, operation: () => T): T {
  return authRequests.run({ cookieHeader: request.headers.get('cookie') ?? '' }, operation);
}

export function recordAuthAdmission(admission: AuthAdmission) {
  const context = authRequests.getStore();
  if (!context) throw new Error('Auth.js admission ran outside its request context.');
  context.admission = admission;
}

export function currentAuthAdmission() {
  return authRequests.getStore()?.admission ?? null;
}

export function authRequestCookie(name: string) {
  const values = authRequests.getStore()?.cookieHeader.split(';')
    .map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`)) ?? [];
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}
