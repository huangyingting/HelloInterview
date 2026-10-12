const { createHmac, randomUUID } = require('node:crypto');

exports.onExecutePostChangePassword = async event => {
  const issuer = event.secrets.STUDIO_OIDC_ISSUER;
  const broker = new URL(issuer);
  const destination = new URL(event.secrets.STUDIO_PASSWORD_EVENT_URL);
  const secret = event.secrets.STUDIO_PASSWORD_HOOK_SECRET;
  if (broker.protocol !== 'https:' || issuer !== `${broker.origin}/` ||
      destination.protocol !== 'https:' || destination.username || destination.password || destination.search || destination.hash ||
      destination.pathname !== '/webhooks/identity/password-change' ||
      typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret) ||
      typeof event.user.user_id !== 'string' || event.user.user_id.length > 512 || !/^auth0\|[\x21-\x7e]+$/.test(event.user.user_id)) {
    throw new Error('Studio password-event configuration is invalid.');
  }
  const payload = JSON.stringify({ version: 1, eventId: randomUUID(), issuer, subject: event.user.user_id, kind: 'password-changed', occurredAt: Date.now() });
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', Buffer.from(secret, 'hex')).update(`${timestamp}.${payload}`).digest('hex');
  const response = await fetch(destination, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'X-Studio-Timestamp': timestamp, 'X-Studio-Signature': signature },
    body: payload,
  });
  if (!response.ok) throw new Error('Studio did not acknowledge the password event. Canonical reconciliation is required.');
  const acknowledgement = await response.json();
  if (!acknowledgement || acknowledgement.accepted !== true || typeof acknowledgement.duplicate !== 'boolean') throw new Error('Studio returned an invalid password-event acknowledgement. Canonical reconciliation is required.');
};
