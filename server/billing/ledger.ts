import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OwnedBillingLedgerView } from '../../shared/billing-ledger';
import type { BillingConfig } from '../config';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim, type Operation } from '../jobs';
import { digest, encodePayload } from '../jobs/schema';
import { checkoutRowSchema, customerRowSchema, type CustomerRow } from './checkout-schema';
import { invoiceFactSchema, ledgerOperationSchema, ledgerSnapshotSchema, ledgerStateSchema, subscriptionFactSchema, type LedgerSnapshot } from './ledger-schema';
import type { StripeEvidence } from './provider';
import { observationSchema, providerId } from './schema';
import { assertSandboxAccessConfiguration, SandboxBillingAccess } from './service';
import { serviceEvidenceSchema } from './service-policy';
import { sandboxResumptionAuthority, sandboxRenewalAuthority, sandboxRenewalCycleAuthority } from '../../shared/billing-ledger';

const pending = ['created', 'active', 'retry'];
const timestamp = (value: number | null) => value === null ? null : new Date(value * 1000).toISOString();
export class SandboxBillingLedger {
  private readonly access: SandboxBillingAccess | null;
  constructor(private readonly db: Database, private readonly settings: BillingConfig, private readonly jobs: DurableJobs,
    private readonly provider: StripeEvidence) { this.access = settings.accessPolicy ? new SandboxBillingAccess(db, settings) : null; }
  private source() { return `stripe:${this.settings.accountId}:sandbox`; }
  private async withCustomer<T>(id: string, action: (customer: CustomerRow) => Promise<T>): Promise<T> {
    const hint = await this.db.prepare("SELECT user_id FROM stripe_owned_customers WHERE id=? AND account_id=? AND state='mapped'").get(z.uuid().parse(id), this.settings.accountId);
    if (!hint?.user_id) throw new TerminalJobFailure('not-eligible');
    const owner = z.uuid().parse(hint.user_id);
    return this.db.transaction(async () => {
      const user = await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(owner);
      const account = await this.db.prepare('SELECT user_id FROM managed_accounts WHERE user_id=? FOR UPDATE').get(owner);
      const row = await this.db.prepare('SELECT * FROM stripe_owned_customers WHERE id=? AND account_id=? FOR UPDATE').get(id, this.settings.accountId);
      if (!user || !account || !row) throw new TerminalJobFailure('not-eligible');
      const customer = customerRowSchema.parse(row);
      if (customer.user_id !== owner || customer.state !== 'mapped' || !customer.customer_id) throw new TerminalJobFailure('not-eligible');
      await assertSandboxAccessConfiguration(this.db, this.settings);
      return action(customer);
    });
  }
  async withObservedCustomer<T>(customerId: string | null, action: (reference: string | null) => Promise<T>) {
    const row = customerId ? await this.db.prepare("SELECT id FROM stripe_owned_customers WHERE account_id=? AND customer_id=? AND state='mapped'")
      .get(this.settings.accountId, providerId.parse(customerId)) : null;
    return row ? this.withCustomer(z.uuid().parse(row.id), customer => action(customer.id)) : action(null);
  }
  private async state(customer: CustomerRow) {
    await this.db.prepare('INSERT INTO stripe_customer_ledger_state (customer_ref) VALUES (?) ON CONFLICT DO NOTHING').run(customer.id);
    const row = await this.db.prepare('SELECT * FROM stripe_customer_ledger_state WHERE customer_ref=? FOR UPDATE').get(customer.id);
    return ledgerStateSchema.parse(row);
  }
  private async enqueue(customer: CustomerRow, revision: number) {
    const operation = await this.jobs.enqueue({
      principal: { type: 'system', id: this.source() }, kind: 'billing.customer.snapshot',
      key: `ledger:${customer.id}:${revision}`, resource: `sandbox-customer:${customer.id}`, retryMode: 'idempotent',
      payload: { accountId: this.settings.accountId, customerRef: customer.id, customerId: customer.customer_id, revision },
    });
    await this.db.prepare('UPDATE stripe_customer_ledger_state SET operation_id=? WHERE customer_ref=?').run(operation.id, customer.id);
  }
  async request(reference: string, coalesce = false) {
    return this.withCustomer(reference, async customer => {
      const state = await this.state(customer);
      const status = state.operation_id ? (await this.jobs.systemStatus(this.source(), state.operation_id)).status : null;
      if (coalesce && status && pending.includes(status)) return { accepted: true };
      if (coalesce && status && ['failed', 'cancelled', 'missing'].includes(status)) throw new HttpError(409, 'This canonical read needs operator queue reconciliation before refreshing.');
      const revision = z.number().int().positive().safe().parse(state.requested_revision + 1);
      await this.db.prepare('UPDATE stripe_customer_ledger_state SET requested_revision=? WHERE customer_ref=?').run(revision, customer.id);
      await this.db.prepare(`INSERT INTO stripe_ledger_notification_links (account_id,event_id,customer_ref,revision)
        SELECT n.account_id,n.event_id,?,? FROM stripe_event_notifications n
        WHERE n.account_id=? AND n.state='observed' AND (n.observation::jsonb)->>'customerId'=?
        ON CONFLICT (account_id,event_id) DO NOTHING`).run(customer.id, revision, this.settings.accountId, customer.customer_id);
      if (!status || status === 'completed') await this.enqueue(customer, revision);
      return { accepted: true };
    });
  }
  async refresh(owner: string) {
    const row = await this.db.prepare("SELECT id FROM stripe_owned_customers WHERE account_id=? AND user_id=? AND state='mapped'").get(this.settings.accountId, z.uuid().parse(owner));
    if (!row) throw new HttpError(409, 'Your owned sandbox customer must be prepared before requesting its canonical ledger.');
    return this.request(z.uuid().parse(row.id), true);
  }
  async enqueueSweep() {
    const rows = await this.db.prepare(`SELECT c.id FROM stripe_owned_customers c
      LEFT JOIN stripe_customer_ledger_state s ON s.customer_ref=c.id
      WHERE c.account_id=? AND c.state='mapped' AND c.user_id IS NOT NULL AND
      (s.customer_ref IS NULL OR s.observed_at IS NULL OR s.observed_at<clock_timestamp()-INTERVAL '5 minutes' OR EXISTS (
        SELECT 1 FROM stripe_event_notifications n WHERE n.account_id=c.account_id AND n.state='observed'
        AND (n.observation::jsonb)->>'customerId'=c.customer_id AND NOT EXISTS (
          SELECT 1 FROM stripe_ledger_notification_links l WHERE l.account_id=n.account_id AND l.event_id=n.event_id)))
      ORDER BY s.observed_at NULLS FIRST,c.id LIMIT 100`).all(this.settings.accountId);
    for (const row of rows) {
      try { await this.withCustomer(z.uuid().parse(row.id), async customer => {
        const state = await this.state(customer);
        const status = state.operation_id ? (await this.jobs.systemStatus(this.source(), state.operation_id)).status : null;
        const unlinked = await this.db.prepare(`SELECT 1 AS present FROM stripe_event_notifications n WHERE n.account_id=?
          AND n.state='observed' AND (n.observation::jsonb)->>'customerId'=? AND NOT EXISTS (
            SELECT 1 FROM stripe_ledger_notification_links l WHERE l.account_id=n.account_id AND l.event_id=n.event_id) LIMIT 1`)
          .get(this.settings.accountId, customer.customer_id);
        if (unlinked || !status || status === 'completed') await this.request(customer.id);
      }); } catch (error) {
        if (!(error instanceof TerminalJobFailure) || error.code !== 'not-eligible') throw error;
        console.warn(JSON.stringify({ event: 'billing.ledger.sweep.customer-retired' }));
      }
    }
    return rows.length;
  }
  private validate(operation: Operation) {
    const input = ledgerOperationSchema.parse(operation.payload);
    if (operation.kind !== 'billing.customer.snapshot' || operation.principal.type !== 'system' || operation.principal.id !== this.source() ||
      input.accountId !== this.settings.accountId || operation.resource !== `sandbox-customer:${input.customerRef}`) throw new TerminalJobFailure('not-eligible');
    return input;
  }
  private async superseded(claim: JobClaim, operation: Operation, customer: CustomerRow, requested: number, signal?: AbortSignal) {
    await this.jobs.finish(claim, async () => {
      await this.enqueue(customer, requested);
      return { superseded: true, authority: 'sandbox-ledger-observation-only', revision: this.validate(operation).revision };
    }, signal);
  }
  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation = await this.jobs.operation(claim.data.operationId), input = this.validate(operation);
    await this.jobs.assertCurrentClaim(claim, signal);
    const context = await this.withCustomer(input.customerRef, async customer => {
      const state = await this.state(customer);
      if (customer.customer_id !== input.customerId || state.operation_id !== operation.id) throw new TerminalJobFailure('not-eligible');
      if (state.requested_revision !== input.revision) {
        await this.superseded(claim, operation, customer, state.requested_revision, signal);
        return null;
      }
      const attempts = (await this.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE customer_ref=?').all(customer.id)).map(row => checkoutRowSchema.parse(row));
      const known = await this.db.prepare('SELECT subscription_id FROM stripe_owned_subscription_ledger WHERE customer_ref=?').all(customer.id);
      const notifications = await this.db.prepare(`SELECT n.observation FROM stripe_ledger_notification_links l JOIN stripe_event_notifications n
        ON n.account_id=l.account_id AND n.event_id=l.event_id WHERE l.customer_ref=? AND l.revision<=?`).all(customer.id, input.revision);
      const observations = notifications.map(row => observationSchema.parse(JSON.parse(z.string().parse(row.observation))));
      const targets = [...new Set(observations.filter(row => row.objectKind === 'invoice').map(row => row.objectId))];
      const chargeTargets = [...new Set(observations.flatMap(row => row.objectKind === 'charge' ? [row.objectId] :
        ['refund', 'dispute'].includes(row.objectKind) && row.chargeId ? [row.chargeId] : []))];
      const creditTargets = [...new Set(observations.filter(row => row.objectKind === 'credit_note').map(row => row.objectId))];
      const knownChargeLinks = (await this.db.prepare('SELECT charge_id,invoice_id FROM stripe_invoice_charge_links WHERE customer_ref=?').all(customer.id))
        .map(row => ({ chargeId: providerId.parse(row.charge_id), invoiceId: providerId.parse(row.invoice_id) }));
      const knownSubscriptions = [...new Set([...known.map(row => providerId.parse(row.subscription_id)), ...attempts.flatMap(row => row.subscription_id ? [row.subscription_id] : [])])];
      if ([targets.length, knownSubscriptions.length, attempts.length, chargeTargets.length, creditTargets.length, knownChargeLinks.length].some(count => count > 500)) throw new TerminalJobFailure('reconciliation-required');
      const clock = await this.db.prepare('SELECT floor(extract(epoch from clock_timestamp()))::bigint AS now').get();
      return { customer, since: Math.max(0, z.coerce.number().int().safe().parse(clock?.now) - 90 * 86400), attempts: attempts.map(row => ({
        id: row.id, priceId: row.price_id, subscriptionId: row.subscription_id, state: row.state,
      })), knownSubscriptions, invoiceTargets: targets, chargeTargets, creditTargets, knownChargeLinks };
    });
    if (!context) return;
    let snapshot: LedgerSnapshot;
    try {
      snapshot = await this.provider.ledger({ ...context, customerRef: context.customer.id, customerId: input.customerId, serviceProof: !!this.access },
        () => this.jobs.heartbeat(claim, signal), signal);
    } catch (error) {
      if (!(error instanceof TerminalJobFailure) || error.code !== 'reconciliation-required') throw error;
      const superseded = await this.withCustomer(input.customerRef, async customer => {
        const state = await this.state(customer);
        if (customer.customer_id !== input.customerId || state.operation_id !== operation.id) throw new TerminalJobFailure('not-eligible');
        if (state.requested_revision === input.revision) return false;
        await this.superseded(claim, operation, customer, state.requested_revision, signal); return true;
      });
      if (superseded) return;
      throw error;
    }
    const encoded = encodePayload(snapshot, 262144);
    await this.withCustomer(input.customerRef, async customer => {
      const state = await this.state(customer);
      if (customer.customer_id !== input.customerId || state.operation_id !== operation.id) throw new TerminalJobFailure('not-eligible');
      if (state.requested_revision !== input.revision) return this.superseded(claim, operation, customer, state.requested_revision, signal);
      await this.jobs.finish(claim, async () => {
        await this.publish(customer, input.revision, snapshot);
        await this.db.prepare(`INSERT INTO stripe_customer_ledger_snapshots (customer_ref,revision,operation_id,fingerprint,payload)
          VALUES (?,?,?,?,?)`).run(customer.id, input.revision, operation.id, digest(encoded), encoded);
        await this.db.prepare('UPDATE stripe_customer_ledger_state SET reconciled_revision=?,observed_at=clock_timestamp(),snapshot=? WHERE customer_ref=?')
          .run(input.revision, encoded, customer.id);
        await this.withCustomer(customer.id, async current => {
          const final = await this.state(current);
          if (current.customer_id !== input.customerId || final.requested_revision !== input.revision || final.operation_id !== operation.id) {
            throw new TerminalJobFailure('reconciliation-required');
          }
        });
        return { revision: input.revision, subscriptions: snapshot.subscriptions.length, invoices: snapshot.invoices.length,
          reviewRequired: snapshot.reviewReasons.length > 0, authority: this.settings.accessPolicy ?? 'sandbox-ledger-observation-only' };
      }, signal);
    });
  }
  private async publish(customer: CustomerRow, revision: number, snapshot: LedgerSnapshot) {
    for (const sub of snapshot.subscriptions) {
      const previous = await this.db.prepare('SELECT customer_ref,status FROM stripe_owned_subscription_ledger WHERE account_id=? AND subscription_id=?')
        .get(this.settings.accountId, sub.id);
      if (previous && (previous.customer_ref !== customer.id || ['canceled', 'incomplete_expired'].includes(z.string().parse(previous.status)) && previous.status !== sub.status)) throw new TerminalJobFailure('reconciliation-required');
      await this.db.prepare(`INSERT INTO stripe_owned_subscription_ledger (id,customer_ref,account_id,subscription_id,revision,status,payload)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT (account_id,subscription_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,payload=excluded.payload`)
        .run(randomUUID(), customer.id, this.settings.accountId, sub.id, revision, sub.status, encodePayload(sub, 16384));
    }
    for (const invoice of snapshot.invoices) {
      const previous = await this.db.prepare('SELECT customer_ref,status,created_at_seconds,payload FROM stripe_owned_invoice_ledger WHERE account_id=? AND invoice_id=?')
        .get(this.settings.accountId, invoice.id);
      if (previous && (previous.customer_ref !== customer.id || Number(previous.created_at_seconds) !== invoice.created ||
        ['paid', 'void'].includes(z.string().parse(previous.status)) && previous.status !== invoice.status)) throw new TerminalJobFailure('reconciliation-required');
      if (previous) {
        const old = invoiceFactSchema.parse(JSON.parse(z.string().parse(previous.payload))).funding;
        if (old && invoice.funding?.currency !== old.currency) throw new TerminalJobFailure('reconciliation-required');
        for (const charge of old?.charges ?? []) {
          const current = invoice.funding?.charges.find(value => value.id === charge.id);
          if (charge.capturedAmount > 0 && (!current || current.currency !== charge.currency || current.intentId !== charge.intentId ||
            current.amount !== charge.amount || current.method !== charge.method ||
            current.capturedAmount < charge.capturedAmount)) throw new TerminalJobFailure('reconciliation-required');
          for (const refund of charge.refunds.filter(refund => refund.status === 'succeeded')) {
            const next = current?.refunds.find(value => value.id === refund.id);
            if (!next || next.status !== 'succeeded' || next.amount !== refund.amount) throw new TerminalJobFailure('reconciliation-required');
          }
          for (const dispute of charge.disputes) {
            const next = current?.disputes.find(value => value.id === dispute.id);
            if (!next || next.amount !== dispute.amount || ['won', 'lost', 'prevented'].includes(dispute.status) && next.status !== dispute.status) {
              throw new TerminalJobFailure('reconciliation-required');
            }
          }
        }
        for (const credit of old?.credits ?? []) {
          const next = invoice.funding?.credits.find(value => value.id === credit.id);
          if (!next || next.amount !== credit.amount || credit.status === 'void' && next.status !== 'void') throw new TerminalJobFailure('reconciliation-required');
        }
      }
      await this.db.prepare(`INSERT INTO stripe_owned_invoice_ledger (id,customer_ref,account_id,invoice_id,revision,created_at_seconds,status,payload)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (account_id,invoice_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,payload=excluded.payload`)
        .run(randomUUID(), customer.id, this.settings.accountId, invoice.id, revision, invoice.created, invoice.status, encodePayload(invoice, 131072));
      for (const charge of invoice.funding?.charges ?? []) {
        await this.db.prepare(`INSERT INTO stripe_invoice_charge_links (account_id,charge_id,invoice_id,customer_ref,first_revision)
          VALUES (?,?,?,?,?) ON CONFLICT (account_id,charge_id,invoice_id) DO NOTHING`).run(this.settings.accountId, charge.id, invoice.id, customer.id, revision);
        const link = await this.db.prepare('SELECT customer_ref FROM stripe_invoice_charge_links WHERE account_id=? AND charge_id=? AND invoice_id=?')
          .get(this.settings.accountId, charge.id, invoice.id);
        if (link?.customer_ref !== customer.id) throw new TerminalJobFailure('reconciliation-required');
      }
      await this.access?.apply(customer, revision, invoice, snapshot);
    }
  }
  async view(customer: CustomerRow): Promise<OwnedBillingLedgerView | null> {
    await assertSandboxAccessConfiguration(this.db, this.settings);
    const row = await this.db.prepare('SELECT * FROM stripe_customer_ledger_state WHERE customer_ref=?').get(customer.id);
    if (!row) return null;
    const state = ledgerStateSchema.parse(row);
    const snapshot = state.snapshot ? ledgerSnapshotSchema.parse(JSON.parse(state.snapshot)) : null;
    const subscriptions = await this.db.prepare(`SELECT s.id,s.payload,c.id AS cancellation_id,c.policy_version,c.state AS cancellation_state,
      c.operation_id AS cancellation_operation,c.confirmed_at,c.result AS cancellation_result,c.cycle,c.previous_resumption_id,
      r.id AS resumption_id,r.policy_version AS resumption_policy,r.state AS resumption_state,r.operation_id AS resumption_operation,
      r.confirmed_at AS resumption_confirmed_at,r.result AS resumption_result FROM stripe_owned_subscription_ledger s
      LEFT JOIN LATERAL (SELECT * FROM stripe_subscription_cancellations c WHERE c.subscription_ref=s.id AND c.customer_ref=s.customer_ref
        ORDER BY c.cycle DESC LIMIT 1) c ON true
      LEFT JOIN stripe_subscription_resumptions r ON r.cancellation_id=c.id AND r.customer_ref=s.customer_ref AND r.subscription_ref=s.id
      WHERE s.customer_ref=? ORDER BY s.revision DESC,s.id LIMIT 21`).all(customer.id);
    const invoices = await this.db.prepare(`SELECT i.id,i.payload,s.payload AS service FROM stripe_owned_invoice_ledger i
      LEFT JOIN stripe_invoice_service_evidence s ON s.account_id=i.account_id AND s.invoice_id=i.invoice_id AND s.customer_ref=i.customer_ref
      WHERE i.customer_ref=? ORDER BY i.created_at_seconds DESC,i.id LIMIT 21`).all(customer.id);
    const holds = await this.db.prepare(`SELECT payload::jsonb->'reviewReasons' AS reasons FROM stripe_owned_subscription_ledger WHERE customer_ref=?
      UNION SELECT payload::jsonb->'reviewReasons' AS reasons FROM stripe_owned_invoice_ledger WHERE customer_ref=?`).all(customer.id, customer.id);
    const reviewReasons = [...new Set([...(snapshot?.reviewReasons ?? []),
      ...holds.flatMap(row => ledgerSnapshotSchema.shape.reviewReasons.parse(row.reasons))])].sort();
    return { authority: this.settings.accessPolicy ?? 'sandbox-ledger-observation-only', processing: state.operation_id ? (await this.jobs.systemStatus(this.source(), state.operation_id)).status : 'missing',
      stale: state.requested_revision !== state.reconciled_revision || !state.observed_at || Date.now() - state.observed_at.getTime() >= 300000,
      observedAt: state.observed_at?.toISOString() ?? null, reviewReasons,
      subscriptions: await Promise.all(subscriptions.slice(0, 20).map(async row => {
        const sub = subscriptionFactSchema.parse(JSON.parse(z.string().parse(row.payload)));
        return { id: z.uuid().parse(row.id), status: sub.status, nonrenewing: sub.cancelAtPeriodEnd,
          currentPeriodEnd: sub.items.length === 1 ? timestamp(sub.items[0].periodEnd) : null,
          cancellation: row.cancellation_id ? { id: z.uuid().parse(row.cancellation_id), policy: z.enum([sandboxRenewalAuthority, sandboxRenewalCycleAuthority]).parse(row.policy_version),
            cycle: z.coerce.number().int().nonnegative().safe().parse(row.cycle),
            previousResumptionId: z.uuid().nullable().parse(row.previous_resumption_id),
            state: z.enum(['queued', 'confirmed']).parse(row.cancellation_state),
            processing: (await this.jobs.ownedStatus(z.uuid().parse(customer.user_id), z.uuid().parse(row.cancellation_operation))).status,
            confirmedAt: row.confirmed_at === null ? null : z.date().parse(row.confirmed_at).toISOString(),
            result: z.enum(['nonrenewing', 'ended']).nullable().parse(row.cancellation_result),
            resumption: row.resumption_id ? { id: z.uuid().parse(row.resumption_id), policy: z.literal(sandboxResumptionAuthority).parse(row.resumption_policy),
              state: z.enum(['queued', 'confirmed']).parse(row.resumption_state),
              processing: (await this.jobs.ownedStatus(z.uuid().parse(customer.user_id), z.uuid().parse(row.resumption_operation))).status,
              confirmedAt: row.resumption_confirmed_at === null ? null : z.date().parse(row.resumption_confirmed_at).toISOString(),
              result: z.literal('renewing').nullable().parse(row.resumption_result) } : null } : null };
      })),
      invoices: invoices.slice(0, 20).map(row => {
        const invoice = invoiceFactSchema.parse(JSON.parse(z.string().parse(row.payload)));
        const service = row.service ? serviceEvidenceSchema.parse(JSON.parse(z.string().parse(row.service))) : null;
        return { id: z.uuid().parse(row.id), status: invoice.status, currency: invoice.currency, total: invoice.total, amountPaid: invoice.amountPaid,
          amountRemaining: invoice.amountRemaining, paidAt: timestamp(invoice.paidAt),
          funding: invoice.funding ? { state: invoice.funding.state, captured: invoice.funding.captured, refunded: invoice.funding.refunded,
            creditAdjusted: invoice.funding.credits.some(credit => credit.status === 'issued') } : null,
          service: service ? { policy: service.policy, state: service.state, startsAt: service.startsAt === null ? null : new Date(service.startsAt).toISOString(),
            endsAt: service.endsAt === null ? null : new Date(service.endsAt).toISOString(), reviewReasons: service.reviewReasons } : null };
      }), historyTruncated: subscriptions.length > 20 || invoices.length > 20 };
  }
  async reviewRequiredCustomers() {
    const row = await this.db.prepare(`SELECT count(*)::integer AS count FROM stripe_owned_customers c WHERE c.account_id=? AND
      (EXISTS (SELECT 1 FROM stripe_customer_ledger_state s WHERE s.customer_ref=c.id AND jsonb_array_length(s.snapshot::jsonb->'reviewReasons')>0)
      OR EXISTS (SELECT 1 FROM stripe_owned_subscription_ledger s WHERE s.customer_ref=c.id AND jsonb_array_length(s.payload::jsonb->'reviewReasons')>0)
      OR EXISTS (SELECT 1 FROM stripe_owned_invoice_ledger i WHERE i.customer_ref=c.id AND jsonb_array_length(i.payload::jsonb->'reviewReasons')>0))`).get(this.settings.accountId);
    return z.number().int().nonnegative().parse(row?.count);
  }
}
