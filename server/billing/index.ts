import express from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import type { BillingConfig } from '../config';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { DurableJobs, TerminalJobFailure, type JobClaim } from '../jobs';
import { digest, encodePayload, InvalidJobPayload } from '../jobs/schema';
import { StripeEvidence } from './provider';
import { InvalidBillingNotification, notification, notificationSchema, stripeApiVersion, type Notification } from './schema';
import { bindBillingReference } from './reference';
import { SandboxCheckout } from './checkout';
import { canonicalOriginSchema } from './checkout-schema';
import { SandboxBillingLedger } from './ledger';
import { assertSandboxAccessConfiguration } from './service';
import { SandboxPortal } from './portal';

export async function assertBillingConfiguration(db: Database, settings: BillingConfig | null) {
  if (db.dialect !== 'postgres') return;
  const row = await db.prepare('SELECT account_id FROM stripe_billing_reference WHERE singleton=1').get();
  if (row && !settings) throw new Error('Stored billing notifications require explicit sandbox billing configuration; disabling reconciliation is not a fallback.');
  if (row && settings && row.account_id !== settings.accountId) throw new Error('Stored billing evidence belongs to a different provider account.');
  if (settings && await db.prepare('SELECT 1 AS present FROM stripe_event_notifications WHERE account_id<>? LIMIT 1').get(settings.accountId)) {
    throw new Error('Stored billing evidence belongs to a different provider account.');
  }
  await assertSandboxAccessConfiguration(db, settings);
}
export class BillingNotifications {
  private constructor(private readonly db: Database, private readonly settings: BillingConfig, readonly jobs: DurableJobs,
    readonly provider: StripeEvidence, readonly checkout: SandboxCheckout | null, readonly ledger: SandboxBillingLedger,
    readonly portal: SandboxPortal | null) {}
  static async open(db: Database, settings: BillingConfig, shutdown: AbortSignal, worker = false, client?: Stripe, origin?: string) {
    await assertBillingConfiguration(db, settings);
    if ((settings.offers || settings.portalConfiguration) && !origin || origin && !canonicalOriginSchema.safeParse(origin).success) throw new Error('Owned sandbox billing requires the canonical HTTPS application origin.');
    const provider = new StripeEvidence(settings, shutdown, client);
    const jobs = await DurableJobs.open(db, worker);
    const ledger = new SandboxBillingLedger(db, settings, jobs, provider);
    return new BillingNotifications(db, settings, jobs, provider, origin ? new SandboxCheckout(db, settings, origin, jobs, provider, ledger) : null, ledger,
      origin ? new SandboxPortal(db, settings, origin) : null);
  }
  private source() { return `stripe:${this.settings.accountId}:sandbox`; }
  private resource(eventId: string) { return `stripe:${digest(`${this.settings.accountId}:${eventId}`)}`; }
  register(app: express.Express) {
    const raw = express.raw({ type: 'application/json', limit: '256kb', inflate: false });
    app.post('/api/webhooks/stripe', (req, res, next) => raw(req, res, (error: unknown) => {
      if (error && typeof error === 'object' && 'type' in error) {
        if (error.type === 'entity.too.large') return next(new HttpError(413, 'The billing event exceeds its size limit.'));
        if (error.type === 'encoding.unsupported') return next(new HttpError(415, 'Compressed billing events are not supported.'));
      }
      next(error);
    }), async (req, res) => {
      const signature = req.get('Stripe-Signature'), timestamps = signature?.split(',').filter(part => part.startsWith('t=')) ?? [];
      const timestamp = timestamps.length === 1 ? timestamps[0].match(/^t=(\d{1,12})$/)?.[1] : undefined;
      if (!Buffer.isBuffer(req.body) || !signature || signature.length > 4096 || !timestamp ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new HttpError(403, 'The billing event could not be authenticated.');
      let value: unknown;
      try { value = this.provider.verify(req.body, signature); }
      catch (error) {
        if (error instanceof Stripe.errors.StripeSignatureVerificationError) throw new HttpError(403, 'The billing event could not be authenticated.');
        if (error instanceof SyntaxError) throw new HttpError(400, 'The authenticated billing event is malformed.');
        throw error;
      }
      let event: Notification;
      try { event = notification(value, this.settings.accountId); }
      catch (error) {
        if (error instanceof z.ZodError || error instanceof InvalidBillingNotification || error instanceof InvalidJobPayload) {
          throw new HttpError(400, `The authenticated event must use own-account sandbox snapshots with API ${stripeApiVersion} and a matching billing object.`);
        }
        throw error;
      }
      const accepted = await this.db.transaction(async () => {
        await bindBillingReference(this.db, this.settings.accountId);
        const result = await this.jobs.ingestVerifiedEvent({
          source: this.source(), eventId: event.eventId, payload: event,
          operation: { kind: 'billing.reconcile', resource: this.resource(event.eventId), payload: event, retryMode: 'idempotent' },
        });
        await this.db.prepare(`INSERT INTO stripe_event_notifications
          (account_id,event_id,event_type,object_id,object_kind,operation_id,classification,payload)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (account_id,event_id) DO NOTHING`).run(
          event.accountId, event.eventId, event.eventType, event.objectId, event.objectKind, result.operation.id, event.classification, encodePayload(event, 4096));
        const saved = await this.db.prepare('SELECT operation_id,payload FROM stripe_event_notifications WHERE account_id=? AND event_id=?').get(event.accountId, event.eventId);
        if (!saved || saved.operation_id !== result.operation.id || saved.payload !== encodePayload(event, 4096)) throw new HttpError(409, 'The billing notification conflicts with its saved evidence.');
        return result;
      });
      res.json({ accepted: true, duplicate: accepted.duplicate });
    });
  }
  async runClaim(claim: JobClaim, signal?: AbortSignal) {
    const operation = await this.jobs.operation(claim.data.operationId);
    if (operation.kind === 'billing.customer.snapshot') return this.ledger.runClaim(claim, signal);
    if (operation.kind !== 'billing.reconcile') {
      if (!this.checkout) throw new TerminalJobFailure('not-eligible');
      await this.checkout.runClaim(claim, signal);
      return;
    }
    const event = notificationSchema.parse(operation.payload);
    if (operation.kind !== 'billing.reconcile' || operation.principal.type !== 'system' || operation.principal.id !== this.source() ||
      event.accountId !== this.settings.accountId || operation.resource !== this.resource(event.eventId)) throw new TerminalJobFailure('not-eligible');
    const observed = event.classification === 'supported' ? await this.provider.observe(event, signal) : null;
    await this.ledger.withObservedCustomer(observed?.customerId ?? null, reference => this.jobs.finish(claim, async () => {
      const row = await this.db.prepare('SELECT operation_id,payload,state FROM stripe_event_notifications WHERE account_id=? AND event_id=? FOR UPDATE').get(event.accountId, event.eventId);
      if (!row || row.operation_id !== operation.id || row.payload !== encodePayload(event, 4096) || row.state !== 'accepted') throw new TerminalJobFailure('invalid-result');
      const state = observed ? 'observed' : 'ignored';
      await this.db.prepare('UPDATE stripe_event_notifications SET state=?,observation=?,observed_at=clock_timestamp() WHERE account_id=? AND event_id=?')
        .run(state, observed ? encodePayload(observed, 8192) : null, event.accountId, event.eventId);
      if (reference) await this.ledger.request(reference);
      return { eventId: event.eventId, state, authority: 'notification-evidence-only' };
    }, signal));
    if (!observed) console.warn(JSON.stringify({ event: 'billing.event.unsupported', type: event.eventType }));
  }
  close() { return this.jobs.close(); }
}
