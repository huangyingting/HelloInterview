export const browserAccount = {
  email: 'browser-member@example.test',
  password: 'Browser-fixture-password-only-123!',
  name: 'Browser Member',
};
export const browserPort = Number(process.env.TEST_BROWSER_PORT ?? '3100');
if (!Number.isInteger(browserPort) || browserPort < 1024 || browserPort > 65535) throw new Error('TEST_BROWSER_PORT must be an unprivileged TCP port.');
export const browserOrigin = `http://127.0.0.1:${browserPort}`;
