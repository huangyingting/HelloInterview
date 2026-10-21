import { acknowledgeAccountEmail, claimNextAccountEmail, type ClaimedAccountEmail } from './email';
import { loadAccountMailSender } from './mail-config';

export async function deliverAccountEmail(
  message: ClaimedAccountEmail,
  config: NonNullable<ReturnType<typeof loadAccountMailSender>>,
  send: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ status: 'sent' | 'failed' | 'unconfirmed'; error?: string }> {
  let response: Response;
  try {
    response = await send('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.id },
      body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      redirect: 'error',
    });
  } catch {
    return { status: 'unconfirmed', error: 'Provider acknowledgement was not received. Reconcile before resending.' };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status >= 500 || response.status === 408 ? 'unconfirmed' : 'failed',
      error: `Email provider returned HTTP ${response.status}. Review provider delivery evidence before resending.` };
  }
  try {
    const result: unknown = await response.json();
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string' && result.id.length > 0) {
      return { status: 'sent' };
    }
  } catch {
    return { status: 'unconfirmed', error: 'Provider accepted the request without a readable receipt. Reconcile before resending.' };
  }
  return { status: 'unconfirmed', error: 'Provider accepted the request without a delivery receipt. Reconcile before resending.' };
}

export async function processAccountMailBatch(signal?: AbortSignal, send: typeof fetch = fetch) {
  const config = loadAccountMailSender();
  if (!config) throw new Error('Account email delivery is not enabled.');
  const counts = { sent: 0, failed: 0, unconfirmed: 0 };
  for (let index = 0; index < 25 && !signal?.aborted; index++) {
    const claimed = await claimNextAccountEmail();
    if (!claimed) break;
    const result = await deliverAccountEmail(claimed, config, send, signal);
    const acknowledged = await acknowledgeAccountEmail({ id: claimed.id, claimToken: claimed.claimToken, ...result });
    if (!acknowledged) throw new Error('The email delivery lease changed. Reconcile the provider outcome before retrying.');
    counts[result.status]++;
    if (result.status !== 'sent') console.error(JSON.stringify({ event: 'account-mail.delivery-review-required', id: claimed.id, status: result.status }));
  }
  return counts;
}
