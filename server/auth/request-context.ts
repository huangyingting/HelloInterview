import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuthAdmission {
  readonly userId: string;
  readonly identityId: string;
}

interface AuthRequestContext {
  admission?: AuthAdmission;
}

const authRequests = new AsyncLocalStorage<AuthRequestContext>();

export function withAuthRequest<T>(operation: () => T): T {
  return authRequests.run({}, operation);
}

export function recordAuthAdmission(admission: AuthAdmission) {
  const context = authRequests.getStore();
  if (!context) throw new Error('Auth.js admission ran outside its request context.');
  context.admission = admission;
}

export function currentAuthAdmission() {
  return authRequests.getStore()?.admission ?? null;
}
