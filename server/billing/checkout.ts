import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SandboxBillingView } from '../../shared/billing';
import type { BillingConfig } from '../config';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim, type Operation } from '../jobs';
import { bindBillingReference } from './reference';
import { checkoutOperationSchema, checkoutRequestSchema, checkoutRowSchema, customerRequestSchema, customerRowSchema, hostedCheckoutUrl, type CheckoutRow, type CustomerRow } from './checkout-schema';
import type { StripeEvidence } from './provider';
import { encodePayload } from '../jobs/schema';
import type { SandboxBillingLedger } from './ledger';

const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const postWindowMs = 20 * 3600000, checkoutMarginMs = 31 * 60000;
export const checkoutJobKinds = ['billing.customer', 'billing.checkout', 'billing.checkout.refresh'] as const;
export class SandboxCheckout {
  constructor(private readonly db: Database, private readonly settings: BillingConfig, private readonly origin: string,
    private readonly jobs: DurableJobs, private readonly provider: StripeEvidence, private readonly ledger: SandboxBillingLedger) {}
  private async now() { return z.coerce.number().int().parse((await this.db.prepare(`SELECT ${clock} AS now`).get())?.now); }
  private async owner(owner: string, epoch?: number) {
    await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(z.uuid().parse(owner));
    const row = await this.db.prepare('SELECT status,contact_verified,session_epoch FROM managed_accounts WHERE user_id=? FOR UPDATE').get(owner);
    if (!row || row.status !== 'active' || row.contact_verified !== 1 || epoch !== undefined && Number(row.session_epoch) !== epoch) throw new TerminalJobFailure('not-eligible');
    return z.coerce.number().int().nonnegative().parse(row.session_epoch);
  }
  private async customer(owner: string, id?: string): Promise<CustomerRow | null> {
    const row = await this.db.prepare(`SELECT * FROM stripe_owned_customers WHERE account_id=? AND user_id=?${id ? ' AND id=?' : ''} FOR UPDATE`)
      .get(this.settings.accountId, owner, ...(id ? [id] : []));
    return row ? customerRowSchema.parse(row) : null;
  }
  private async attempt(customer: CustomerRow, id: string): Promise<CheckoutRow> {
    const row = await this.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE id=? AND customer_ref=? FOR UPDATE').get(z.uuid().parse(id), customer.id);
    if (!row) throw new HttpError(404, 'Owned sandbox checkout not found.');
    return checkoutRowSchema.parse(row);
  }
  private async enqueueCheckout(owner: string, customer: CustomerRow, attempt: CheckoutRow) {
    const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.checkout',
      key: `checkout:${attempt.id}`, resource: `sandbox-customer:${customer.id}`,
      payload: this.intent(attempt), retryMode: 'idempotent' });
    await this.db.prepare("UPDATE stripe_checkout_attempts SET state='queued',operation_id=? WHERE id=?").run(operation.id, attempt.id);
  }
  private intent(attempt: CheckoutRow) {
    return { customerRef: attempt.customer_ref, attemptId: attempt.id, priceId: attempt.price_id, offer: attempt.offer_key,
      origin: attempt.origin, expiresAt: attempt.expires_at, authEpoch: attempt.auth_epoch };
  }
  async reserve(owner: string, input: z.input<typeof checkoutRequestSchema>) {
    const request = checkoutRequestSchema.parse(input);
    const offers = this.settings.offers;
    if (!offers) throw new HttpError(503, 'Hosted sandbox checkout is not configured. Production purchases remain disabled.');
    return this.db.transaction(async () => {
      const epoch = await this.owner(owner);
      await bindBillingReference(this.db, this.settings.accountId);
      let customer = await this.customer(owner);
      if (!customer) {
        const id = randomUUID();
        const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.customer',
          key: `customer:${id}`, resource: `sandbox-customer:${id}`, payload: { customerRef: id, authEpoch: epoch }, retryMode: 'idempotent' });
        await this.db.prepare(`INSERT INTO stripe_owned_customers (id,account_id,user_id,state,auth_epoch,operation_id)
          VALUES (?,?,?,'reserved',?,?)`).run(id, this.settings.accountId, owner, epoch, operation.id);
        customer = await this.customer(owner, id);
      }
      if (!customer || customer.state === 'retired' || customer.state === 'reserved' && customer.auth_epoch !== epoch) throw new HttpError(409, 'This sandbox customer intent needs security reconciliation before creating another checkout.');
      const previous = await this.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE customer_ref=? AND request_key=?').get(customer.id, request.key);
      if (previous) {
        const attempt = checkoutRowSchema.parse(previous);
        if (attempt.offer_key !== request.offer) throw new HttpError(409, 'This checkout request key was already used with a different offer.');
        return { id: attempt.id };
      }
      if (await this.db.prepare("SELECT id FROM stripe_checkout_attempts WHERE customer_ref=? AND state IN ('waiting-customer','queued','open','complete')").get(customer.id)) {
        throw new HttpError(409, 'An unresolved sandbox checkout already exists. Refresh or resume it; a second subscription cannot be started.');
      }
      const id = randomUUID(), expiresAt = (Math.floor(await this.now() / 1000) + 7200) * 1000;
      await this.db.prepare(`INSERT INTO stripe_checkout_attempts
        (id,customer_ref,request_key,offer_key,price_id,origin,auth_epoch,state,expires_at) VALUES (?,?,?,?,?,?,?,'waiting-customer',?)`)
        .run(id, customer.id, request.key, request.offer, offers[request.offer], this.origin, epoch, expiresAt);
      if (customer.state === 'mapped') await this.enqueueCheckout(owner, customer, await this.attempt(customer, id));
      await this.owner(owner, epoch);
      return { id };
    });
  }
  async view(owner: string): Promise<SandboxBillingView> {
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customer = await this.customer(owner);
      if (!customer) return { mode: 'sandbox', enabled: !!this.settings.offers, customerReady: false, checkout: null, ledger: null, accessAuthority: this.settings.accessPolicy ?? 'none' };
      const row = await this.db.prepare(`SELECT * FROM stripe_checkout_attempts WHERE customer_ref=?
        ORDER BY (state IN ('waiting-customer','queued','open','complete')) DESC,created_at DESC,id DESC LIMIT 1`).get(customer.id);
      const attempt = row ? checkoutRowSchema.parse(row) : null;
      if (attempt?.state === 'retired') throw new HttpError(403, 'This sandbox billing archive is retired.');
      const operationId = attempt?.refresh_operation_id ?? attempt?.operation_id ?? customer.operation_id;
      const operation = await this.jobs.ownedStatus(owner, operationId);
      return { mode: 'sandbox', enabled: !!this.settings.offers, customerReady: customer.state === 'mapped', accessAuthority: this.settings.accessPolicy ?? 'none', ledger: await this.ledger.view(customer),
        checkout: attempt ? { id: attempt.id, requestKey: attempt.request_key, offer: attempt.offer_key, state: attempt.state, processing: operation.status,
          expiresAt: new Date(attempt.expires_at).toISOString(), paymentStatus: attempt.payment_status,
          quote: attempt.currency && attempt.unit_amount ? { currency: attempt.currency, unitAmount: attempt.unit_amount } : null } : null };
    });
  }
  async open(owner: string, id: string) {
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customer = await this.customer(owner);
      if (!customer) throw new HttpError(404, 'Owned sandbox checkout not found.');
      const attempt = await this.attempt(customer, id);
      if (attempt.state !== 'open' || !attempt.hosted_url || await this.now() >= attempt.expires_at) throw new HttpError(409, 'This hosted checkout is not open. Refresh its canonical status before continuing.');
      return { url: hostedCheckoutUrl(attempt.hosted_url) };
    });
  }
  async refresh(owner: string, id: string) {
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customer = await this.customer(owner);
      if (!customer) throw new HttpError(404, 'Owned sandbox checkout not found.');
      const attempt = await this.attempt(customer, id);
      if (!attempt.session_id) throw new HttpError(409, 'The hosted sandbox checkout is still being prepared.');
      if (attempt.refresh_operation_id) {
        const previous = await this.jobs.ownedStatus(owner, attempt.refresh_operation_id);
        if (['created', 'active', 'retry'].includes(previous.status)) return { accepted: true };
      }
      const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.checkout.refresh',
        key: `refresh:${attempt.id}:${attempt.refresh_operation_id ?? 'initial'}`, resource: `sandbox-customer:${customer.id}`,
        payload: this.intent(attempt), retryMode: 'idempotent' });
      await this.db.prepare('UPDATE stripe_checkout_attempts SET refresh_operation_id=? WHERE id=?').run(operation.id, attempt.id);
      return { accepted: true };
    });
  }
  async enqueueSweep() {
    const rows = await this.db.prepare(`SELECT a.id,c.user_id FROM stripe_checkout_attempts a JOIN stripe_owned_customers c ON c.id=a.customer_ref
      JOIN managed_accounts m ON m.user_id=c.user_id WHERE c.account_id=? AND c.state='mapped' AND a.state='open'
      AND m.status='active' AND m.contact_verified=1 ORDER BY a.observed_at NULLS FIRST,a.id LIMIT 100`).all(this.settings.accountId);
    for (const row of rows) await this.refresh(z.uuid().parse(row.user_id), z.uuid().parse(row.id));
    return rows.length;
  }
  private async context(operation: Operation) {
    if (operation.principal.type !== 'user' || !operation.ownerId) throw new TerminalJobFailure('not-eligible');
    const owner = operation.ownerId;
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customerInput = operation.kind === 'billing.customer' ? customerRequestSchema.parse(operation.payload) : null;
      const checkoutInput = operation.kind === 'billing.customer' ? null : checkoutOperationSchema.parse(operation.payload);
      const reference = customerInput?.customerRef ?? checkoutInput?.customerRef;
      if (!reference) throw new TerminalJobFailure('invalid-result');
      const customer = await this.customer(owner, reference);
      if (!customer || operation.resource !== `sandbox-customer:${customer.id}`) throw new TerminalJobFailure('not-eligible');
      const attempt = checkoutInput ? await this.attempt(customer, checkoutInput.attemptId) : null;
      if (attempt && checkoutInput ? encodePayload(this.intent(attempt)) !== encodePayload(checkoutInput) :
        customer.auth_epoch !== customerInput?.authEpoch) throw new TerminalJobFailure('invalid-result');
      if (operation.kind !== 'billing.checkout.refresh') await this.owner(owner, attempt?.auth_epoch ?? customer.auth_epoch);
      if (operation.kind === 'billing.customer' && (customer.state !== 'reserved' || customer.operation_id !== operation.id) ||
        operation.kind === 'billing.checkout' && (customer.state !== 'mapped' || attempt?.state !== 'queued' || attempt.operation_id !== operation.id) ||
        operation.kind === 'billing.checkout.refresh' && (customer.state !== 'mapped' || !attempt?.session_id)) throw new TerminalJobFailure('not-eligible');
      return { owner, customer, attempt, now: await this.now() };
    });
  }
  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation = await this.jobs.operation(claim.data.operationId);
    if (!checkoutJobKinds.some(kind => kind === operation.kind)) throw new TerminalJobFailure('not-eligible');
    await this.jobs.assertCurrentClaim(claim, signal);
    const context = await this.context(operation);
    const beforeMutation = async () => {
      const current = await this.context(operation);
      await this.jobs.assertCurrentClaim(claim, signal);
      const now = await this.now(), age = now - Date.parse(operation.createdAt);
      if (age < 0 || age >= postWindowMs ||
        current.attempt && now + checkoutMarginMs >= current.attempt.expires_at) throw new TerminalJobFailure('reconciliation-required');
    };
    const age = context.now - Date.parse(operation.createdAt), replayWindow = age >= 0 && age < postWindowMs;
    if (operation.kind === 'billing.customer') {
      const id = await this.provider.createCustomer(context.customer.id, operation.id, replayWindow, beforeMutation, signal);
      await this.db.transaction(async () => {
        await this.owner(context.owner, context.customer.auth_epoch);
        const customer = await this.customer(context.owner, context.customer.id);
        if (!customer || customer.state !== 'reserved' || customer.operation_id !== operation.id ||
          customer.auth_epoch !== context.customer.auth_epoch) throw new TerminalJobFailure('not-eligible');
        await this.jobs.finish(claim, async () => {
          await this.db.prepare("UPDATE stripe_owned_customers SET customer_id=?,state='mapped' WHERE id=?").run(id, customer.id);
          const mapped = await this.customer(context.owner, customer.id);
          if (!mapped) throw new TerminalJobFailure('invalid-result');
          const row = await this.db.prepare("SELECT * FROM stripe_checkout_attempts WHERE customer_ref=? AND state='waiting-customer'").get(customer.id);
          if (row) await this.enqueueCheckout(context.owner, mapped, checkoutRowSchema.parse(row));
          await this.ledger.request(mapped.id);
          await this.owner(context.owner, customer.auth_epoch);
          return { customerMapped: true, authority: 'sandbox-correlation-only' };
        }, signal);
      });
      return;
    }
    const attempt = context.attempt, customerId = context.customer.customer_id;
    if (!attempt || !customerId) throw new TerminalJobFailure('not-eligible');
    const creation = operation.kind === 'billing.checkout' ?
      await this.provider.createCheckout(attempt, customerId, attempt.origin, operation.id, replayWindow && context.now + checkoutMarginMs < attempt.expires_at, beforeMutation, signal) : null;
    const facts = creation ?? await this.provider.refreshCheckout(attempt, customerId, attempt.origin, signal);
    await this.db.transaction(async () => {
      await this.owner(context.owner, operation.kind === 'billing.checkout' ? attempt.auth_epoch : undefined);
      const customer = await this.customer(context.owner, context.customer.id);
      if (!customer || customer.customer_id !== customerId || customer.state !== 'mapped') throw new TerminalJobFailure('not-eligible');
      const current = await this.attempt(customer, attempt.id);
      if (encodePayload(this.intent(current)) !== encodePayload(operation.payload)) throw new TerminalJobFailure('invalid-result');
      if (current.session_id && current.session_id !== facts.id ||
        current.subscription_id && current.subscription_id !== facts.subscriptionId ||
        operation.kind === 'billing.checkout' && (current.operation_id !== operation.id || current.state !== 'queued')) throw new TerminalJobFailure('not-eligible');
      await this.jobs.finish(claim, async () => {
        if (current.state === 'retired' || ['complete', 'expired'].includes(current.state) && current.state !== facts.state) throw new TerminalJobFailure('reconciliation-required');
        await this.db.prepare(`UPDATE stripe_checkout_attempts SET state=?,session_id=?,subscription_id=?,payment_status=?,
          hosted_url=?,currency=coalesce(currency,?),unit_amount=coalesce(unit_amount,?),observed_at=clock_timestamp() WHERE id=?`)
          .run(facts.state, facts.id, facts.subscriptionId, facts.paymentStatus, facts.url,
            creation?.currency ?? null, creation?.unitAmount ?? null, attempt.id);
        await this.owner(context.owner, operation.kind === 'billing.checkout' ? attempt.auth_epoch : undefined);
        if (facts.state === 'complete') await this.ledger.request(customer.id);
        return { checkoutId: attempt.id, state: facts.state, authority: 'sandbox-correlation-only' };
      }, signal);
    });
  }
}
