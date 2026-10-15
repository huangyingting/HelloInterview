import { z } from 'zod';
import { assertCsrf } from '../auth/csrf';
import { loadAuthSettings } from '../auth/config';
import { BillingNotifications } from '../billing';
import { loadBillingConfig } from '../billing/config';
import { cancellationRequestSchema } from '../billing/cancellation-schema';
import { checkoutRequestSchema } from '../billing/checkout-schema';
import { resumptionRequestSchema } from '../billing/resumption-schema';
import { prismaConnection } from '../db/prisma';
import { HttpError } from '../http-error';
import { IdentityLimits } from '../identity/limits';
import { TerminalJobFailure } from '../jobs';
import type { ManagedAuthSession } from '../auth/adapter';
import { assertAccountSession, requireAccountSession } from './identity';

const emptyBody = z.strictObject({});
const uuid = z.uuid();
const maximumWebhookBytes = 256 * 1024;

let billingPromise: Promise<BillingNotifications> | null = null;
let billingAbort: AbortController | null = null;

function configuration() {
  const auth = loadAuthSettings();
  if (!auth) throw new HttpError(503, 'Authentication is not configured.');
  const billing = loadBillingConfig(process.env, {
    identity: true,
    databaseUrl: process.env.DATABASE_URL ?? null,
    publicOrigin: auth.origin,
  }, (setting, requirement) => {
    throw new HttpError(503, `${setting} ${requirement}`);
  });
  return { auth, billing };
}

export function nextBillingCapability() {
  const { billing } = configuration();
  return billing ? { mode: 'sandbox' as const, checkout: !!billing.offers } : null;
}

async function nextBillingService() {
  if (!billingPromise) {
    const { auth, billing } = configuration();
    if (!billing) throw new HttpError(503, 'Owned sandbox billing is not configured.');
    billingAbort = new AbortController();
    billingPromise = BillingNotifications.open(
      prismaConnection(),
      billing,
      billingAbort.signal,
      false,
      undefined,
      auth.origin,
    ).catch(error => {
      billingPromise = null;
      billingAbort = null;
      throw error;
    });
  }
  return billingPromise;
}

export async function closeNextBillingService() {
  const current = billingPromise;
  billingPromise = null;
  billingAbort?.abort();
  billingAbort = null;
  if (current) await (await current).close();
}

async function authorize(request: Request, mutation: boolean) {
  const session = await requireAccountSession(request, ['active']);
  if (mutation) {
    assertCsrf(request, session);
    const { auth } = configuration();
    const decision = await new IdentityLimits(prismaConnection(), auth.secret).consume('billing', session.userId);
    if (!decision.allowed) {
      throw new HttpError(429, 'Too many attempts. Wait for the shared 15-minute attempt window before trying again.', {
        'Retry-After': String(decision.retryAfter),
      });
    }
  }
  return { session, billing: await nextBillingService() };
}

async function run<T>(session: ManagedAuthSession, fresh: boolean, action: () => Promise<T>) {
  const db = prismaConnection();
  try {
    return await db.transaction(async () => {
      await assertAccountSession(db, session, fresh, ['active']);
      const result = await action();
      await assertAccountSession(db, session, fresh, ['active']);
      return result;
    });
  } catch (error) {
    if (error instanceof TerminalJobFailure && error.code === 'not-eligible') {
      throw new HttpError(403, 'Your verified account or security proof changed. Sign in again before using sandbox billing.');
    }
    throw error;
  }
}

export async function billingView(request: Request) {
  const { session, billing } = await authorize(request, false);
  if (!billing.checkout) throw new HttpError(503, 'Owned sandbox checkout is unavailable.');
  return run(session, false, () => billing.checkout!.view(session.userId));
}

export async function reconcileBilling(request: Request, input: unknown) {
  if (!emptyBody.safeParse(input).success) {
    throw new HttpError(400, 'Use an empty request body; customer and invoice references are server-owned.');
  }
  const { session, billing } = await authorize(request, true);
  return run(session, true, () => billing.ledger.refresh(session.userId));
}

export async function reserveCheckout(request: Request, input: unknown) {
  const parsed = checkoutRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, 'Choose a sandbox offer and a UUID request key; provider IDs, amounts and redirect URLs are not accepted.');
  }
  const { session, billing } = await authorize(request, true);
  if (!billing.checkout) throw new HttpError(503, 'Owned sandbox checkout is unavailable.');
  return run(session, true, () => billing.checkout!.reserve(session.userId, parsed.data));
}

export async function useCheckout(
  request: Request,
  id: string,
  input: unknown,
  action: 'open' | 'refresh',
) {
  const parsedId = uuid.safeParse(id);
  if (!parsedId.success || !emptyBody.safeParse(input).success) {
    throw new HttpError(400, 'Use an owned checkout ID and an empty request body.');
  }
  const { session, billing } = await authorize(request, true);
  if (!billing.checkout) throw new HttpError(503, 'Owned sandbox checkout is unavailable.');
  return action === 'open'
    ? run(session, true, () => billing.checkout!.open(session.userId, parsedId.data))
    : run(session, true, () => billing.checkout!.refresh(session.userId, parsedId.data));
}

export async function cancelSubscription(request: Request, id: string, input: unknown) {
  const parsedId = uuid.safeParse(id);
  const body = cancellationRequestSchema.safeParse(input);
  if (!parsedId.success || !body.success) {
    throw new HttpError(400, 'Use an owned subscription ID and the exact owned cycle predecessor, or an empty body for the original stop request.');
  }
  const { session, billing } = await authorize(request, true);
  if (!billing.checkout) throw new HttpError(503, 'Owned sandbox checkout is unavailable.');
  return run(session, true, () => billing.checkout!.cancelRenewal(session.userId, parsedId.data, body.data));
}

export async function resumeSubscription(request: Request, id: string, input: unknown) {
  const parsedId = uuid.safeParse(id);
  const body = resumptionRequestSchema.safeParse(input);
  if (!parsedId.success || !body.success) {
    throw new HttpError(400, 'Acknowledge future sandbox renewals and select the exact owned cancellation; provider targets, prices and charges are not client authority.');
  }
  const { session, billing } = await authorize(request, true);
  if (!billing.checkout) throw new HttpError(503, 'Owned sandbox checkout is unavailable.');
  return run(session, true, () => billing.checkout!.resumeRenewal(session.userId, parsedId.data, body.data));
}

export async function openBillingPortal(request: Request, input: unknown) {
  if (!emptyBody.safeParse(input).success) {
    throw new HttpError(400, 'Use an empty request body; Portal customer, configuration and return URL are server-owned.');
  }
  const { session, billing } = await authorize(request, true);
  const portal = billing.portal;
  if (!portal) throw new HttpError(503, 'Owned sandbox Portal is unavailable.');
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  const scope = await run(session, true, () => portal.prepare(session.userId));
  const result = await billing.provider.portalSession(scope, () => run(session, true, async () => {
    await portal.guard(scope, session.userId);
    signal.throwIfAborted();
  }), signal);
  signal.throwIfAborted();
  await run(session, true, async () => {
    await portal.complete(scope, session.userId, result);
    signal.throwIfAborted();
  });
  return { url: result.url };
}

async function rawBody(request: Request) {
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    throw new HttpError(415, 'Compressed billing events are not supported.');
  }
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new HttpError(415, 'Billing events must use application/json.');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumWebhookBytes)) {
    throw new HttpError(413, 'The billing event exceeds its size limit.');
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumWebhookBytes) {
        await reader.cancel();
        throw new HttpError(413, 'The billing event exceeds its size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function acceptStripeWebhook(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) throw new HttpError(403, 'The billing event could not be authenticated.');
  return (await nextBillingService()).acceptWebhook(await rawBody(request), signature);
}
