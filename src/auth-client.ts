export async function signOutAuth() {
  const csrfResponse = await fetch('/api/auth/csrf', { headers: { Accept: 'application/json' } });
  if (!csrfResponse.ok) throw new Error('Could not prepare sign-out.');
  const payload: unknown = await csrfResponse.json();
  const token = payload && typeof payload === 'object' && 'csrfToken' in payload && typeof payload.csrfToken === 'string'
    ? payload.csrfToken
    : null;
  if (!token) throw new Error('Could not prepare sign-out.');
  const response = await fetch('/api/auth/signout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: token, callbackUrl: window.location.origin }),
  });
  if (!response.ok) throw new Error('Sign-out failed. Try again.');
}
