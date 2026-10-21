import { z } from 'zod';

export function loadAccountMailSender(env: Readonly<Record<string, string | undefined>> = process.env) {
  const enabled = env.ACCOUNT_MAIL_WORKFLOW_ENABLED;
  if (enabled === undefined || enabled === 'false') return null;
  if (enabled !== 'true') throw new Error('ACCOUNT_MAIL_WORKFLOW_ENABLED must be true or false.');
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey || !/^[^\s\x00-\x1f\x7f]{8,4096}$/.test(apiKey)) {
    throw new Error('RESEND_API_KEY is required for enabled account email delivery.');
  }
  const from = env.ACCOUNT_MAIL_FROM?.trim();
  const address = from?.match(/^(?:[^<>\r\n]+<([^<>\r\n]+)>|([^<>\r\n]+))$/);
  if (!from || from.length > 320 || !z.email().safeParse(address?.[1] ?? address?.[2]).success) {
    throw new Error('ACCOUNT_MAIL_FROM must contain a verified sender email address.');
  }
  return Object.freeze({ apiKey, from });
}
