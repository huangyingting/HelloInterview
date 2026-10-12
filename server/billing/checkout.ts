import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SandboxBillingView } from '../../shared/billing';
import type { BillingConfig } from '../config';
import type { Database, DatabaseRow } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim, type Operation } from '../jobs';
import { bindBillingReference } from './reference';
import { checkoutOperationSchema, checkoutRequestSchema, checkoutRowSchema, customerRequestSchema, customerRowSchema, hostedCheckoutUrl, type CheckoutRow, type CustomerRow } from './checkout-schema';
import type { StripeEvidence } from './provider';
import { encodePayload } from '../jobs/schema';
import type { SandboxBillingLedger } from './ledger';
import { invoiceFactSchema, ledgerSnapshotSchema, ledgerStateSchema, subscriptionFactSchema } from './ledger-schema';
import { cancellationOperationSchema, cancellationRequestSchema, cancellationRowSchema, type CancellationRequest, type CancellationRow } from './cancellation-schema';
import { resumptionOperationSchema, resumptionRequestSchema, resumptionRowSchema, type ResumptionRequest, type ResumptionRow } from './resumption-schema';
import { sandboxResumptionAuthority, sandboxRenewalAuthority, sandboxRenewalCycleAuthority } from '../../shared/billing-ledger';
import { assertSandboxAccessConfiguration } from './service';
import { assertSandboxOwner, ownedSandboxCustomer } from './ownership';
import { evaluateSandboxService } from './service-policy';
import { sandboxRecheckoutAuthority } from '../../shared/billing';

const clock = 'floor(extract(epoch from clock_timestamp())*1000)::bigint';
const postWindowMs = 20 * 3600000, checkoutMarginMs = 31 * 60000;
export const checkoutJobKinds = ['billing.customer', 'billing.checkout', 'billing.checkout.refresh', 'billing.subscription.cancel', 'billing.subscription.resume'] as const;
export class SandboxCheckout {
  constructor(private readonly db: Database, private readonly settings: BillingConfig, private readonly origin: string,
    private readonly jobs: DurableJobs, private readonly provider: StripeEvidence, private readonly ledger: SandboxBillingLedger) {}
  private async now() { return z.coerce.number().int().parse((await this.db.prepare(`SELECT ${clock} AS now`).get())?.now); }
  private async owner(owner: string, epoch?: number) {
    return assertSandboxOwner(this.db, owner, epoch);
  }
  private async customer(owner: string, id?: string): Promise<CustomerRow | null> {
    return ownedSandboxCustomer(this.db, this.settings.accountId, owner, id);
  }
  private async attempt(customer: CustomerRow, id: string): Promise<CheckoutRow> {
    const row = await this.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE id=? AND customer_ref=? FOR UPDATE').get(z.uuid().parse(id), customer.id);
    if (!row) throw new HttpError(404, 'Owned sandbox checkout not found.');
    return checkoutRowSchema.parse(row);
  }
  private async currentAttempt(customer: CustomerRow): Promise<CheckoutRow | null> {
    const row = await this.db.prepare(`SELECT a.* FROM stripe_customer_checkout_cursor p
      JOIN stripe_checkout_attempts a ON a.id=p.attempt_id AND a.customer_ref=p.customer_ref WHERE p.customer_ref=? FOR UPDATE OF p`).get(customer.id);
    if (!row && await this.db.prepare('SELECT id FROM stripe_checkout_attempts WHERE customer_ref=? LIMIT 1').get(customer.id)) {
      throw new HttpError(409, 'The owned Checkout cursor is missing; operator reconciliation is required before preparing or displaying another intent.');
    }
    return row ? checkoutRowSchema.parse(row) : null;
  }
  private async recheckoutParent(customer: CustomerRow, subscriptionRef: string, attemptId?: string, subscriptionId?: string) {
    const row = await this.db.prepare(`SELECT subscription_id,payload FROM stripe_owned_subscription_ledger
      WHERE id=? AND customer_ref=? AND account_id=? FOR UPDATE`).get(subscriptionRef, customer.id, this.settings.accountId);
    if (!row) throw new HttpError(404, 'Owned ended subscription not found.');
    const sub = subscriptionFactSchema.parse(JSON.parse(z.string().parse(row.payload)));
    if (!['canceled', 'incomplete_expired'].includes(sub.status) || sub.reviewReasons.length > 0 ||
      !sub.attemptId || sub.id !== row.subscription_id || attemptId && sub.attemptId !== attemptId ||
      subscriptionId && sub.id !== subscriptionId) throw new HttpError(409, 'The retained recheckout predecessor needs operator reconciliation.');
    const previous = await this.attempt(customer, sub.attemptId);
    if (previous.state !== 'complete' || previous.subscription_id !== sub.id) throw new HttpError(409, 'Recheckout requires its retained completed owned Checkout.');
    return { sub, previous, row };
  }
  private async assertRecheckoutObservation(customer: CustomerRow, subscriptionRef: string, attemptId?: string, subscriptionId?: string) {
    await assertSandboxAccessConfiguration(this.db, this.settings);
    const state = await this.db.prepare('SELECT * FROM stripe_customer_ledger_state WHERE customer_ref=? FOR UPDATE').get(customer.id);
    const rows = await this.db.prepare('SELECT subscription_id,payload FROM stripe_owned_subscription_ledger WHERE customer_ref=? AND account_id=?')
      .all(customer.id, this.settings.accountId);
    const parent = await this.recheckoutParent(customer, subscriptionRef, attemptId, subscriptionId);
    await this.renewalObservation(state, parent.row);
    if (!['canceled', 'incomplete_expired'].includes(parent.sub.status) || rows.length === 0 || rows.some(row => {
      const sub = subscriptionFactSchema.parse(JSON.parse(z.string().parse(row.payload)));
      return sub.id !== row.subscription_id || !['canceled', 'incomplete_expired'].includes(sub.status) || sub.reviewReasons.length > 0;
    })) throw new HttpError(409, 'Recheckout requires complete canonical ended subscription history; active or unsupported history requires review.');
    const unknown = await this.db.prepare(`SELECT c.id FROM stripe_subscription_cancellations c
      LEFT JOIN stripe_subscription_resumptions r ON r.cancellation_id=c.id
      WHERE c.customer_ref=? AND (c.state='queued' OR r.state='queued') LIMIT 1`).get(customer.id);
    if (unknown) throw new HttpError(409, 'Reconcile unknown renewal-control outcomes before creating another sandbox subscription.');
    return parent;
  }
  private async enqueueCheckout(owner: string, customer: CustomerRow, attempt: CheckoutRow) {
    const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.checkout',
      key: `checkout:${attempt.id}`, resource: `sandbox-customer:${customer.id}`,
      payload: this.intent(attempt), retryMode: 'idempotent' });
    await this.db.prepare("UPDATE stripe_checkout_attempts SET state='queued',operation_id=? WHERE id=?").run(operation.id, attempt.id);
  }
  private intent(attempt: CheckoutRow) {
    const common = { customerRef: attempt.customer_ref, attemptId: attempt.id, priceId: attempt.price_id, offer: attempt.offer_key,
      origin: attempt.origin, expiresAt: attempt.expires_at, authEpoch: attempt.auth_epoch };
    return attempt.previous_subscription_ref === null ? common : { ...common, policy: sandboxRecheckoutAuthority,
      previousSubscriptionRef: attempt.previous_subscription_ref, previousAttemptId: z.uuid().parse(attempt.previous_attempt_id),
      previousSubscriptionId: z.string().parse(attempt.previous_subscription_id), acknowledged: true };
  }
  async reserve(owner: string, input: z.input<typeof checkoutRequestSchema>) {
    const request = checkoutRequestSchema.parse(input);
    const offers = this.settings.offers;
    if (!offers) throw new HttpError(503, 'Hosted sandbox checkout is not configured. Production purchases remain disabled.');
    return this.db.transaction(async () => {
      const epoch = await this.owner(owner);
      await bindBillingReference(this.db, this.settings.accountId);
      let customer = await this.customer(owner);
      if (!customer && 'previousSubscriptionRef' in request) throw new HttpError(404, 'Owned ended subscription not found.');
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
        if (attempt.offer_key !== request.offer || attempt.previous_subscription_ref !==
          ('previousSubscriptionRef' in request ? request.previousSubscriptionRef : null)) throw new HttpError(409, 'This checkout request key was already used with a different offer or predecessor.');
        return { id: attempt.id };
      }
      const current = await this.currentAttempt(customer);
      if (await this.db.prepare("SELECT id FROM stripe_checkout_attempts WHERE customer_ref=? AND state IN ('waiting-customer','queued','open')").get(customer.id)) {
        throw new HttpError(409, 'An unresolved sandbox checkout already exists. Refresh or resume it; a second subscription cannot be started.');
      }
      let parent: Awaited<ReturnType<SandboxCheckout['recheckoutParent']>> | null = null;
      if ('previousSubscriptionRef' in request) {
        if (customer.state !== 'mapped') throw new HttpError(409, 'Recheckout requires the existing mapped owned customer.');
        parent = await this.assertRecheckoutObservation(customer, request.previousSubscriptionRef);
        if (!current || (current.state === 'complete' ? current.id !== parent.previous.id :
          current.state !== 'expired' || current.previous_subscription_ref !== request.previousSubscriptionRef)) {
          throw new HttpError(409, 'Use the exact current ended-subscription predecessor; older cycles cannot authorize a new Checkout.');
        }
      } else if (await this.db.prepare("SELECT id FROM stripe_checkout_attempts WHERE customer_ref=? AND state='complete' LIMIT 1").get(customer.id)) {
        throw new HttpError(409, 'A completed Checkout is retained. Recheckout requires the exact ended-subscription predecessor and new acknowledgment.');
      }
      const id = randomUUID(), expiresAt = (Math.floor(await this.now() / 1000) + 7200) * 1000;
      await this.db.prepare(`INSERT INTO stripe_checkout_attempts
        (id,customer_ref,request_key,offer_key,price_id,origin,auth_epoch,state,expires_at,
          previous_subscription_ref,previous_attempt_id,previous_subscription_id,recheckout_acknowledged)
        VALUES (?,?,?,?,?,?,?,'waiting-customer',?,?,?,?,?)`)
        .run(id, customer.id, request.key, request.offer, offers[request.offer], this.origin, epoch, expiresAt,
          'previousSubscriptionRef' in request ? request.previousSubscriptionRef : null, parent?.previous.id ?? null,
          parent?.sub.id ?? null, parent ? 1 : null);
      await this.db.prepare(`INSERT INTO stripe_customer_checkout_cursor(customer_ref,attempt_id) VALUES(?,?)
        ON CONFLICT(customer_ref) DO UPDATE SET attempt_id=excluded.attempt_id`).run(customer.id, id);
      const created = await this.attempt(customer, id);
      if (created.request_key !== request.key || created.offer_key !== request.offer || created.price_id !== offers[request.offer] ||
        created.origin !== this.origin || created.auth_epoch !== epoch || created.expires_at !== expiresAt ||
        created.previous_subscription_ref !== ('previousSubscriptionRef' in request ? request.previousSubscriptionRef : null) ||
        created.previous_attempt_id !== (parent?.previous.id ?? null) || created.previous_subscription_id !== (parent?.sub.id ?? null)) {
        throw new TerminalJobFailure('not-eligible');
      }
      if (customer.state === 'mapped') await this.enqueueCheckout(owner, customer, created);
      await this.owner(owner, epoch);
      const retained = await this.customer(owner, customer.id);
      if (!retained || retained.state !== customer.state || retained.customer_id !== customer.customer_id ||
        (await this.currentAttempt(retained))?.id !== id) throw new TerminalJobFailure('not-eligible');
      return { id };
    });
  }
  async view(owner: string): Promise<SandboxBillingView> {
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customer = await this.customer(owner);
      if (!customer) return { mode: 'sandbox', enabled: !!this.settings.offers, portalEnabled: !!this.settings.portalConfiguration, customerReady: false, checkout: null, ledger: null, accessAuthority: this.settings.accessPolicy ?? 'none' };
      const attempt = await this.currentAttempt(customer);
      if (attempt?.state === 'retired') throw new HttpError(403, 'This sandbox billing archive is retired.');
      const operationId = attempt?.refresh_operation_id ?? attempt?.operation_id ?? customer.operation_id;
      const operation = await this.jobs.ownedStatus(owner, operationId);
      const subscription = attempt?.subscription_id ? await this.db.prepare(`SELECT id FROM stripe_owned_subscription_ledger
        WHERE customer_ref=? AND account_id=? AND subscription_id=?`).get(customer.id, this.settings.accountId, attempt.subscription_id) : null;
      return { mode: 'sandbox', enabled: !!this.settings.offers, portalEnabled: !!this.settings.portalConfiguration, customerReady: customer.state === 'mapped', accessAuthority: this.settings.accessPolicy ?? 'none', ledger: await this.ledger.view(customer),
        checkout: attempt ? { id: attempt.id, requestKey: attempt.request_key, offer: attempt.offer_key, state: attempt.state, processing: operation.status,
          expiresAt: new Date(attempt.expires_at).toISOString(), paymentStatus: attempt.payment_status,
          subscriptionRef: subscription ? z.uuid().parse(subscription.id) : null, previousSubscriptionRef: attempt.previous_subscription_ref,
          quote: attempt.currency && attempt.unit_amount ? { currency: attempt.currency, unitAmount: attempt.unit_amount } : null } : null };
    });
  }
  async open(owner: string, id: string) {
    return this.db.transaction(async () => {
      await this.owner(owner);
      const customer = await this.customer(owner);
      if (!customer) throw new HttpError(404, 'Owned sandbox checkout not found.');
      const attempt = await this.attempt(customer, id);
      if ((await this.currentAttempt(customer))?.id !== attempt.id) throw new HttpError(409, 'Only the current owned Checkout can be opened.');
      if (attempt.previous_subscription_ref) await this.assertRecheckoutObservation(customer, attempt.previous_subscription_ref,
        z.uuid().parse(attempt.previous_attempt_id), z.string().parse(attempt.previous_subscription_id));
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
  private cancellationIntent(row: Pick<CancellationRow, 'id' | 'customer_ref' | 'subscription_ref' | 'attempt_id' | 'auth_epoch' | 'cycle' | 'previous_resumption_id'>,
    subscriptionId: string, priceId: string) {
    const common = { id: row.id, customerRef: row.customer_ref, subscriptionRef: row.subscription_ref,
      subscriptionId, attemptId: row.attempt_id, priceId, authEpoch: row.auth_epoch };
    return row.cycle === 0 ? { ...common, policy: sandboxRenewalAuthority } :
      { ...common, policy: sandboxRenewalCycleAuthority, cycle: row.cycle, previousResumptionId: z.uuid().parse(row.previous_resumption_id) };
  }
  private async renewalAdmission(owner: string, id: string) {
    const epoch = await this.owner(owner), customer = await this.customer(owner);
    if (!customer || customer.state !== 'mapped') throw new HttpError(404, 'Owned sandbox subscription not found.');
    await assertSandboxAccessConfiguration(this.db, this.settings);
    const stateRow = await this.db.prepare('SELECT * FROM stripe_customer_ledger_state WHERE customer_ref=? FOR UPDATE').get(customer.id);
    const subRow = await this.db.prepare('SELECT subscription_id,payload FROM stripe_owned_subscription_ledger WHERE id=? AND customer_ref=? AND account_id=? FOR UPDATE')
      .get(z.uuid().parse(id), customer.id, this.settings.accountId);
    if (!subRow) throw new HttpError(404, 'Owned sandbox subscription not found.');
    return { epoch, customer, stateRow, subRow };
  }
  private async renewalObservation(stateRow: DatabaseRow | undefined, subRow: DatabaseRow) {
    const state = stateRow ? ledgerStateSchema.parse(stateRow) : null, now = await this.now();
    const age = state?.observed_at ? now - state.observed_at.getTime() : -1;
    if (!state?.observed_at || state.requested_revision !== state.reconciled_revision || age < 0 || age >= 300000) {
      throw new HttpError(409, 'Refresh the owned canonical ledger before changing sandbox renewal.');
    }
    const sub = subscriptionFactSchema.parse(JSON.parse(z.string().parse(subRow.payload)));
    if (sub.id !== subRow.subscription_id || !sub.attemptId) throw new HttpError(409, 'This subscription lacks its owned completed Checkout correlation.');
    return { sub, state, now };
  }
  private async latestCancellation(subscriptionRef: string) {
    const row = await this.db.prepare('SELECT * FROM stripe_subscription_cancellations WHERE subscription_ref=? ORDER BY cycle DESC LIMIT 1 FOR UPDATE').get(subscriptionRef);
    return row ? cancellationRowSchema.parse(row) : null;
  }
  async cancelRenewal(owner: string, id: string, input: CancellationRequest = {}) {
    const request = cancellationRequestSchema.parse(input);
    const predecessor = 'previousResumptionId' in request ? request.previousResumptionId : null;
    return this.db.transaction(async () => {
      const { epoch, customer, stateRow, subRow } = await this.renewalAdmission(owner, id);
      const previous = await this.db.prepare(`SELECT * FROM stripe_subscription_cancellations WHERE subscription_ref=? AND
        ${predecessor ? 'previous_resumption_id=?' : 'cycle=0'} FOR UPDATE`).get(id, ...(predecessor ? [predecessor] : []));
      const old = previous ? cancellationRowSchema.parse(previous) : null;
      if (old && old.customer_ref !== customer.id) throw new HttpError(409, 'Stored cancellation ownership conflicts; operator reconciliation is required.');
      if (old?.state === 'queued') {
        const status = await this.jobs.ownedStatus(owner, old.operation_id);
        if (old.auth_epoch !== epoch || !['created', 'active', 'retry'].includes(status.status)) {
          throw new HttpError(409, 'This cancellation needs operator reconciliation; its unknown external outcome cannot be replaced.');
        }
        return { id: old.id, accepted: true };
      }
      if (old && await this.db.prepare("SELECT id FROM stripe_subscription_resumptions WHERE cancellation_id=? AND state='confirmed'").get(old.id)) {
        return { id: old.id, accepted: true };
      }
      const { sub } = await this.renewalObservation(stateRow, subRow);
      if (old) {
        if (!sub.cancelAtPeriodEnd && !['canceled', 'incomplete_expired'].includes(sub.status)) {
          throw new HttpError(409, 'The earlier cancellation differs from current provider state without a confirmed owned resumption. Operator reconciliation is required.');
        }
        return { id: old.id, accepted: true };
      }
      const latest = await this.latestCancellation(id);
      let cycle = 0;
      if (predecessor) {
        const row = await this.db.prepare('SELECT * FROM stripe_subscription_resumptions WHERE id=? AND customer_ref=? AND subscription_ref=? FOR UPDATE')
          .get(predecessor, customer.id, id);
        if (!row) throw new HttpError(404, 'Owned sandbox resumption not found.');
        const resume = resumptionRowSchema.parse(row);
        if (resume.state !== 'confirmed' || !latest || resume.cancellation_id !== latest.id || latest.attempt_id !== resume.attempt_id) {
          throw new HttpError(409, 'Only the latest confirmed owned resumption can authorize the next cancellation cycle.');
        }
        cycle = z.number().int().positive().safe().parse(latest.cycle + 1);
      } else if (latest) throw new HttpError(409, 'Use the exact owned predecessor for this cancellation cycle.');
      const attempt = await this.attempt(customer, z.uuid().parse(sub.attemptId));
      if (attempt.state !== 'complete' || attempt.subscription_id !== sub.id) throw new HttpError(409, 'Refresh the owned completed Checkout before stopping renewal.');
      const intent = { id: randomUUID(), customer_ref: customer.id, subscription_ref: id, attempt_id: attempt.id, auth_epoch: epoch,
        cycle, previous_resumption_id: predecessor };
      const payload = this.cancellationIntent(intent, sub.id, attempt.price_id);
      const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.subscription.cancel',
        key: `cancel:${intent.id}`, resource: `sandbox-customer:${customer.id}`, payload, retryMode: 'idempotent' });
      await this.db.prepare(`INSERT INTO stripe_subscription_cancellations
        (id,policy_version,customer_ref,subscription_ref,attempt_id,auth_epoch,operation_id,cycle,previous_resumption_id,state)
        VALUES (?,?,?,?,?,?,?,?,?,'queued')`).run(intent.id, payload.policy, customer.id, id, attempt.id, epoch, operation.id, cycle, predecessor);
      await this.owner(owner, epoch);
      return { id: intent.id, accepted: true };
    });
  }
  private async cancellationContext(operation: Operation, expected: 'queued' | 'confirmed' = 'queued') {
    if (operation.kind !== 'billing.subscription.cancel' || operation.principal.type !== 'user' || !operation.ownerId) throw new TerminalJobFailure('not-eligible');
    const input = cancellationOperationSchema.parse(operation.payload), owner = operation.ownerId;
    return this.db.transaction(async () => {
      await this.owner(owner, input.authEpoch);
      const customer = await this.customer(owner, input.customerRef);
      if (!customer || customer.state !== 'mapped' || !customer.customer_id || operation.resource !== `sandbox-customer:${customer.id}`) throw new TerminalJobFailure('not-eligible');
      await assertSandboxAccessConfiguration(this.db, this.settings);
      const row = cancellationRowSchema.parse(await this.db.prepare('SELECT * FROM stripe_subscription_cancellations WHERE id=? AND customer_ref=? FOR UPDATE').get(input.id, customer.id));
      if (row.cycle > 0) {
        const previous = await this.db.prepare(`SELECT r.*,c.cycle AS previous_cycle FROM stripe_subscription_resumptions r
          JOIN stripe_subscription_cancellations c ON c.id=r.cancellation_id
          WHERE r.id=? AND r.customer_ref=? AND r.subscription_ref=?`).get(z.uuid().parse(row.previous_resumption_id), customer.id, row.subscription_ref);
        if (!previous || resumptionRowSchema.parse(previous).state !== 'confirmed' ||
          z.coerce.number().int().nonnegative().safe().parse(previous.previous_cycle) !== row.cycle - 1) throw new TerminalJobFailure('not-eligible');
      }
      const sub = await this.db.prepare('SELECT subscription_id FROM stripe_owned_subscription_ledger WHERE id=? AND customer_ref=? AND account_id=?')
        .get(row.subscription_ref, customer.id, this.settings.accountId);
      const attempt = await this.attempt(customer, row.attempt_id);
      const latest = await this.latestCancellation(row.subscription_ref);
      if (!sub || row.state !== expected || row.operation_id !== operation.id ||
        latest?.id !== row.id ||
        attempt.state !== 'complete' || attempt.subscription_id !== sub.subscription_id ||
        encodePayload(this.cancellationIntent(row, z.string().parse(sub.subscription_id), attempt.price_id)) !== encodePayload(input)) throw new TerminalJobFailure('not-eligible');
      return { owner, customer, attempt, input, now: await this.now() };
    });
  }
  private async runCancellation(claim: JobClaim, operation: Operation, signal?: AbortSignal) {
    const context = await this.cancellationContext(operation), customerId = context.customer.customer_id;
    if (!customerId) throw new TerminalJobFailure('not-eligible');
    const age = context.now - Date.parse(operation.createdAt);
    const beforeMutation = async () => {
      const current = await this.cancellationContext(operation);
      if (current.customer.customer_id !== customerId) throw new TerminalJobFailure('not-eligible');
      await this.jobs.assertCurrentClaim(claim, signal);
      const elapsed = current.now - Date.parse(operation.createdAt);
      if (elapsed < 0 || elapsed >= postWindowMs) throw new TerminalJobFailure('reconciliation-required');
    };
    const result = await this.provider.stopRenewal(context.attempt, customerId, operation.id, age >= 0 && age < postWindowMs,
      beforeMutation, () => this.jobs.heartbeat(claim, signal), signal);
    await this.db.transaction(async () => {
      const current = await this.cancellationContext(operation);
      if (current.customer.customer_id !== customerId) throw new TerminalJobFailure('not-eligible');
      await this.jobs.finish(claim, async () => {
        await this.db.prepare("UPDATE stripe_subscription_cancellations SET state='confirmed',confirmed_at=clock_timestamp(),result=? WHERE id=?")
          .run(result, context.input.id);
        await this.ledger.request(current.customer.id);
        await this.cancellationContext(operation, 'confirmed');
        return { cancellationId: context.input.id, result, authority: context.input.policy };
      }, signal);
    });
  }
  private resumptionIntent(row: Pick<ResumptionRow, 'id' | 'cancellation_id' | 'customer_ref' | 'subscription_ref' | 'attempt_id' |
    'auth_epoch' | 'price_id' | 'offer_key' | 'currency' | 'unit_amount' | 'item_id' | 'period_start' | 'period_end' | 'billing_anchor' | 'invoice_id' | 'eligibility_proof'>,
    subscriptionId: string) {
    return resumptionOperationSchema.parse({ policy: sandboxResumptionAuthority, id: row.id, cancellationId: row.cancellation_id,
      customerRef: row.customer_ref, subscriptionRef: row.subscription_ref, subscriptionId, attemptId: row.attempt_id,
      priceId: row.price_id, offer: row.offer_key, currency: row.currency, unitAmount: row.unit_amount, itemId: row.item_id,
      periodStart: row.period_start, periodEnd: row.period_end, invoiceId: row.invoice_id, eligibilityProof: row.eligibility_proof,
      billingAnchor: row.billing_anchor,
      acknowledged: true, authEpoch: row.auth_epoch });
  }
  private async resumableObservation(customer: CustomerRow, stateRow: DatabaseRow | undefined, subRow: DatabaseRow, attempt: CheckoutRow) {
    const { sub, state, now } = await this.renewalObservation(stateRow, subRow);
    if (sub.status !== 'active' || !sub.cancelAtPeriodEnd || attempt.state !== 'complete' ||
      attempt.id !== sub.attemptId || attempt.subscription_id !== sub.id || this.settings.offers?.[attempt.offer_key] !== attempt.price_id) {
      throw new HttpError(409, 'Only an active owned scheduled cancellation with its still-enabled reference offer can resume.');
    }
    const invoiceRow = sub.latestInvoiceId ? await this.db.prepare('SELECT payload FROM stripe_owned_invoice_ledger WHERE invoice_id=? AND customer_ref=? AND account_id=?')
      .get(sub.latestInvoiceId, customer.id, this.settings.accountId) : null;
    const invoice = invoiceRow ? invoiceFactSchema.parse(JSON.parse(z.string().parse(invoiceRow.payload))) : null;
    const snapshot = state.snapshot ? ledgerSnapshotSchema.parse(JSON.parse(state.snapshot)) : null;
    const eligibility = invoice ? evaluateSandboxService(invoice, sub, attempt, customer.id, snapshot?.reviewReasons ?? []) : null;
    if (!invoice || eligibility?.decision !== 'eligible' || !eligibility.proof || eligibility.startsAt === null || eligibility.endsAt === null ||
      now < eligibility.startsAt || now >= eligibility.endsAt) {
      throw new HttpError(409, 'Renewal resumption requires the current funded supported calendar interval; refresh or seek operator review.');
    }
    return { sub, invoice, eligibility: { ...eligibility, proof: eligibility.proof }, now };
  }
  async resumeRenewal(owner: string, id: string, input: ResumptionRequest) {
    const request = resumptionRequestSchema.parse(input);
    return this.db.transaction(async () => {
      const { epoch, customer, stateRow, subRow } = await this.renewalAdmission(owner, id);
      const row = await this.db.prepare('SELECT * FROM stripe_subscription_cancellations WHERE id=? AND subscription_ref=? AND customer_ref=? FOR UPDATE')
        .get(request.cancellationId, id, customer.id);
      if (!row) throw new HttpError(404, 'Owned sandbox cancellation not found.');
      const cancellation = cancellationRowSchema.parse(row), latest = await this.latestCancellation(id);
      const previous = await this.db.prepare('SELECT * FROM stripe_subscription_resumptions WHERE cancellation_id=? FOR UPDATE').get(cancellation.id);
      if (previous) {
        const resume = resumptionRowSchema.parse(previous);
        if (resume.state === 'queued') {
          const status = await this.jobs.ownedStatus(owner, resume.operation_id);
          if (resume.auth_epoch !== epoch || latest?.id !== cancellation.id || !['created', 'active', 'retry'].includes(status.status)) {
            throw new HttpError(409, 'This resumption needs operator reconciliation; its unknown future-renewal outcome cannot be replaced.');
          }
        } else if (latest?.id === cancellation.id) {
          const { sub } = await this.renewalObservation(stateRow, subRow);
          if (sub.cancelAtPeriodEnd || sub.status !== 'active') throw new HttpError(409, 'Current renewal differs from the retained resumption; operator review is required.');
        }
        return { id: resume.id, accepted: true };
      }
      if (latest?.id !== cancellation.id || cancellation.state !== 'confirmed' || cancellation.result !== 'nonrenewing') {
        throw new HttpError(409, 'Resume only the latest confirmed owned end-of-period cancellation.');
      }
      const attempt = await this.attempt(customer, cancellation.attempt_id);
      const current = await this.resumableObservation(customer, stateRow, subRow, attempt), item = current.sub.items[0];
      const intent = { id: randomUUID(), cancellation_id: cancellation.id, customer_ref: customer.id, subscription_ref: id,
        attempt_id: attempt.id, auth_epoch: epoch, price_id: attempt.price_id, offer_key: attempt.offer_key, currency: 'usd' as const,
        unit_amount: z.number().int().positive().safe().parse(attempt.unit_amount), item_id: item.id, period_start: item.periodStart,
        period_end: item.periodEnd, invoice_id: current.invoice.id, eligibility_proof: current.eligibility.proof };
      const captured = { ...intent, billing_anchor: z.number().int().nonnegative().safe().parse(current.sub.billingCycleAnchor) };
      const operation = await this.jobs.enqueue({ principal: { type: 'user', id: owner }, kind: 'billing.subscription.resume',
        key: `resume:${intent.id}`, resource: `sandbox-customer:${customer.id}`, payload: this.resumptionIntent(captured, current.sub.id), retryMode: 'idempotent' });
      await this.db.prepare(`INSERT INTO stripe_subscription_resumptions
        (id,policy_version,cancellation_id,customer_ref,subscription_ref,attempt_id,auth_epoch,price_id,offer_key,currency,unit_amount,
          item_id,period_start,period_end,billing_anchor,invoice_id,eligibility_proof,acknowledged,operation_id,state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,'queued')`).run(intent.id, sandboxResumptionAuthority, cancellation.id, customer.id, id,
          attempt.id, epoch, intent.price_id, intent.offer_key, intent.currency, intent.unit_amount, item.id, item.periodStart, item.periodEnd,
          captured.billing_anchor, intent.invoice_id, z.string().parse(intent.eligibility_proof), operation.id);
      await this.owner(owner, epoch);
      return { id: intent.id, accepted: true };
    });
  }
  private async resumptionContext(operation: Operation, expected: 'queued' | 'confirmed' = 'queued') {
    if (operation.kind !== 'billing.subscription.resume' || operation.principal.type !== 'user' || !operation.ownerId) throw new TerminalJobFailure('not-eligible');
    const input = resumptionOperationSchema.parse(operation.payload), owner = operation.ownerId;
    return this.db.transaction(async () => {
      await this.owner(owner, input.authEpoch);
      const customer = await this.customer(owner, input.customerRef);
      if (!customer || customer.state !== 'mapped' || !customer.customer_id || operation.resource !== `sandbox-customer:${customer.id}`) throw new TerminalJobFailure('not-eligible');
      await assertSandboxAccessConfiguration(this.db, this.settings);
      const cancellation = await this.latestCancellation(input.subscriptionRef);
      const row = resumptionRowSchema.parse(await this.db.prepare('SELECT * FROM stripe_subscription_resumptions WHERE id=? AND customer_ref=? FOR UPDATE').get(input.id, customer.id));
      const sub = await this.db.prepare('SELECT subscription_id,payload FROM stripe_owned_subscription_ledger WHERE id=? AND customer_ref=? AND account_id=?')
        .get(input.subscriptionRef, customer.id, this.settings.accountId);
      const attempt = await this.attempt(customer, input.attemptId);
      if (!sub || row.state !== expected || row.operation_id !== operation.id || cancellation?.id !== row.cancellation_id ||
        cancellation.state !== 'confirmed' || cancellation.result !== 'nonrenewing' || cancellation.attempt_id !== row.attempt_id ||
        attempt.state !== 'complete' || attempt.subscription_id !== sub.subscription_id || attempt.price_id !== row.price_id ||
        attempt.offer_key !== row.offer_key || attempt.currency !== row.currency || attempt.unit_amount !== row.unit_amount ||
        encodePayload(this.resumptionIntent(row, z.string().parse(sub.subscription_id))) !== encodePayload(input)) throw new TerminalJobFailure('not-eligible');
      return { owner, customer, attempt, input, sub, now: await this.now() };
    });
  }
  private async runResumption(claim: JobClaim, operation: Operation, signal?: AbortSignal) {
    const context = await this.resumptionContext(operation), customerId = context.customer.customer_id;
    if (!customerId) throw new TerminalJobFailure('not-eligible');
    const beforeMutation = async () => {
      await this.db.transaction(async () => {
        const current = await this.resumptionContext(operation);
        if (current.customer.customer_id !== customerId) throw new TerminalJobFailure('not-eligible');
        const stateRow = await this.db.prepare('SELECT * FROM stripe_customer_ledger_state WHERE customer_ref=? FOR UPDATE').get(current.customer.id);
        const funded = await this.resumableObservation(current.customer, stateRow, current.sub, current.attempt);
        if (funded.invoice.id !== current.input.invoiceId || funded.eligibility.proof !== current.input.eligibilityProof) throw new TerminalJobFailure('reconciliation-required');
        await this.jobs.assertCurrentClaim(claim, signal);
        const elapsed = await this.now() - Date.parse(operation.createdAt);
        if (elapsed < 0 || elapsed >= postWindowMs) throw new TerminalJobFailure('reconciliation-required');
      });
    };
    const age = context.now - Date.parse(operation.createdAt);
    const result = await this.provider.resumeRenewal(context.attempt, context.input, customerId, operation.id,
      age >= 0 && age < postWindowMs, beforeMutation, () => this.jobs.heartbeat(claim, signal), signal);
    await this.db.transaction(async () => {
      const current = await this.resumptionContext(operation);
      if (current.customer.customer_id !== customerId) throw new TerminalJobFailure('not-eligible');
      await this.jobs.finish(claim, async () => {
        await this.db.prepare("UPDATE stripe_subscription_resumptions SET state='confirmed',confirmed_at=clock_timestamp(),result=? WHERE id=?")
          .run(result, current.input.id);
        await this.ledger.request(current.customer.id);
        await this.resumptionContext(operation, 'confirmed');
        return { resumptionId: current.input.id, cancellationId: current.input.cancellationId, result, authority: sandboxResumptionAuthority };
      }, signal);
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
      const parent = attempt?.previous_subscription_ref ? await this.recheckoutParent(customer, attempt.previous_subscription_ref,
        z.uuid().parse(attempt.previous_attempt_id), z.string().parse(attempt.previous_subscription_id)) : null;
      if (attempt && checkoutInput ? encodePayload(this.intent(attempt)) !== encodePayload(checkoutInput) :
        customer.auth_epoch !== customerInput?.authEpoch) throw new TerminalJobFailure('invalid-result');
      if (operation.kind !== 'billing.checkout.refresh') await this.owner(owner, attempt?.auth_epoch ?? customer.auth_epoch);
      if (operation.kind === 'billing.customer' && (customer.state !== 'reserved' || customer.operation_id !== operation.id) ||
        operation.kind === 'billing.checkout' && (customer.state !== 'mapped' || attempt?.state !== 'queued' || attempt.operation_id !== operation.id ||
          (await this.currentAttempt(customer))?.id !== attempt.id) ||
        operation.kind === 'billing.checkout.refresh' && (customer.state !== 'mapped' || !attempt?.session_id)) throw new TerminalJobFailure('not-eligible');
      return { owner, customer, attempt, parent, now: await this.now() };
    });
  }
  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation = await this.jobs.operation(claim.data.operationId);
    if (!checkoutJobKinds.some(kind => kind === operation.kind)) throw new TerminalJobFailure('not-eligible');
    await this.jobs.assertCurrentClaim(claim, signal);
    if (operation.kind === 'billing.subscription.cancel') return this.runCancellation(claim, operation, signal);
    if (operation.kind === 'billing.subscription.resume') return this.runResumption(claim, operation, signal);
    const context = await this.context(operation);
    const beforeMutation = async () => {
      const current = await this.context(operation);
      if (current.customer.customer_id !== context.customer.customer_id) throw new TerminalJobFailure('not-eligible');
      if (current.attempt?.previous_subscription_ref) {
        if (this.settings.offers?.[current.attempt.offer_key] !== current.attempt.price_id ||
          current.parent?.previous.price_id !== context.parent?.previous.price_id) throw new TerminalJobFailure('not-eligible');
        await this.db.transaction(async () => {
          await this.owner(current.owner, current.attempt?.auth_epoch);
          const customer = await this.customer(current.owner, current.customer.id);
          if (!customer || customer.customer_id !== context.customer.customer_id ||
            (await this.currentAttempt(customer))?.id !== current.attempt?.id) throw new TerminalJobFailure('not-eligible');
          await this.assertRecheckoutObservation(customer, z.uuid().parse(current.attempt?.previous_subscription_ref),
            z.uuid().parse(current.attempt?.previous_attempt_id), z.string().parse(current.attempt?.previous_subscription_id));
        });
      }
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
      await this.provider.createCheckout(attempt, customerId, attempt.origin, operation.id, replayWindow && context.now + checkoutMarginMs < attempt.expires_at,
        beforeMutation, signal, context.parent ? { subscriptionId: context.parent.sub.id, attemptId: context.parent.previous.id, priceId: context.parent.previous.price_id } : undefined) : null;
    const facts = creation ?? await this.provider.refreshCheckout(attempt, customerId, attempt.origin, signal);
    await this.db.transaction(async () => {
      await this.owner(context.owner, operation.kind === 'billing.checkout' ? attempt.auth_epoch : undefined);
      const customer = await this.customer(context.owner, context.customer.id);
      if (!customer || customer.customer_id !== customerId || customer.state !== 'mapped') throw new TerminalJobFailure('not-eligible');
      const current = await this.attempt(customer, attempt.id);
      if (operation.kind === 'billing.checkout' && (await this.currentAttempt(customer))?.id !== current.id) throw new TerminalJobFailure('not-eligible');
      if (current.previous_subscription_ref) {
        const parent = await this.recheckoutParent(customer, current.previous_subscription_ref,
          z.uuid().parse(current.previous_attempt_id), z.string().parse(current.previous_subscription_id));
        if (parent.previous.price_id !== context.parent?.previous.price_id) throw new TerminalJobFailure('not-eligible');
      }
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
        const retained = await this.customer(context.owner, customer.id);
        if (!retained || retained.state !== 'mapped' || retained.customer_id !== customerId) throw new TerminalJobFailure('not-eligible');
        const published = await this.attempt(retained, attempt.id);
        if (encodePayload(this.intent(published)) !== encodePayload(operation.payload) || published.state !== facts.state ||
          published.session_id !== facts.id || published.subscription_id !== facts.subscriptionId ||
          operation.kind === 'billing.checkout' && (await this.currentAttempt(customer))?.id !== attempt.id) throw new TerminalJobFailure('not-eligible');
        if (published.previous_subscription_ref) {
          const parent = await this.recheckoutParent(customer, published.previous_subscription_ref,
            z.uuid().parse(published.previous_attempt_id), z.string().parse(published.previous_subscription_id));
          if (parent.previous.price_id !== context.parent?.previous.price_id) throw new TerminalJobFailure('not-eligible');
        }
        if (facts.state === 'complete') await this.ledger.request(customer.id);
        return { checkoutId: attempt.id, state: facts.state,
          authority: published.previous_subscription_ref ? sandboxRecheckoutAuthority : 'sandbox-correlation-only' };
      }, signal);
    });
  }
}
