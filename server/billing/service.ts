import { z } from 'zod';
import { sandboxServicePolicy } from '../../shared/billing-ledger';
import type { BillingConfig } from './config';
import type { Database } from '../db/connection';
import { Entitlements } from '../entitlements';
import { TerminalJobFailure } from '../jobs';
import { digest, encodePayload } from '../jobs/schema';
import { checkoutRowSchema, type CustomerRow } from './checkout-schema';
import type { InvoiceFact, LedgerSnapshot } from './ledger-schema';
import { evaluateSandboxService, serviceEvidenceSchema, type ServiceEvidence } from './service-policy';

export async function assertSandboxAccessConfiguration(db: Database, settings: BillingConfig | null) {
  const service = await db.prepare('SELECT account_id,policy_version FROM stripe_invoice_service_evidence LIMIT 1').get();
  if (service && (!settings || settings.accountId !== service.account_id || settings.accessPolicy !== service.policy_version)) {
    throw new Error('Stored sandbox service authority requires its explicit account and versioned access policy; disabling reversal reconciliation is not a fallback.');
  }
}

export class SandboxBillingAccess {
  private readonly entitlements: Entitlements;
  constructor(private readonly db: Database, private readonly settings: BillingConfig) { this.entitlements = new Entitlements(db); }
  private source(invoiceId: string) { return { kind: 'billing' as const, key: `stripe-test-v1:${digest(`${this.settings.accountId}:${invoiceId}`)}` }; }
  async apply(customer: CustomerRow, revision: number, invoice: InvoiceFact, snapshot: LedgerSnapshot) {
    if (this.settings.accessPolicy !== sandboxServicePolicy || !customer.user_id) throw new TerminalJobFailure('not-eligible');
    const source = this.source(invoice.id);
    const row = await this.db.prepare('SELECT customer_ref,source_key,policy_version,payload FROM stripe_invoice_service_evidence WHERE account_id=? AND invoice_id=? FOR UPDATE')
      .get(this.settings.accountId, invoice.id);
    if (row && (row.customer_ref !== customer.id || row.source_key !== source.key || row.policy_version !== sandboxServicePolicy)) throw new TerminalJobFailure('reconciliation-required');
    const old = row ? serviceEvidenceSchema.parse(JSON.parse(z.string().parse(row.payload))) : null;
    const revoked = await this.db.prepare("SELECT user_id FROM entitlement_revocations WHERE source_kind='billing' AND source_key=?").get(source.key);
    if (revoked && revoked.user_id !== customer.user_id) throw new TerminalJobFailure('reconciliation-required');
    const sub = snapshot.subscriptions.find(sub => sub.id === invoice.subscriptionId);
    const rawAttempt = sub?.attemptId ? await this.db.prepare('SELECT * FROM stripe_checkout_attempts WHERE id=? AND customer_ref=?')
      .get(sub.attemptId, customer.id) : null;
    const evaluation = evaluateSandboxService(invoice, sub, rawAttempt ? checkoutRowSchema.parse(rawAttempt) : undefined, customer.id, snapshot.reviewReasons);
    let current: ServiceEvidence = { policy: sandboxServicePolicy, state: revoked ? 'revoked' : old?.state ?? 'held',
      startsAt: old?.startsAt ?? null, endsAt: old?.endsAt ?? null, proof: old?.proof ?? null, reviewReasons: evaluation.reviewReasons };
    if (evaluation.decision === 'revoke') {
      await this.entitlements.revoke(customer.user_id, source, { actor: 'stripe-sandbox-ledger',
        reason: `${sandboxServicePolicy}: terminal sandbox adjustment: ${evaluation.reviewReasons.join(', ')}.` });
      current.state = 'revoked';
    } else if (current.state !== 'revoked' && evaluation.decision === 'eligible') {
      if (old?.proof && (old.proof !== evaluation.proof || old.startsAt !== evaluation.startsAt || old.endsAt !== evaluation.endsAt)) throw new TerminalJobFailure('reconciliation-required');
      if (evaluation.startsAt === null || evaluation.endsAt === null || evaluation.proof === null) throw new TerminalJobFailure('invalid-result');
      const grant = await this.entitlements.issue({ owner: customer.user_id, source, policy: 'pro-v1',
        startsAt: evaluation.startsAt, endsAt: evaluation.endsAt,
        evidence: { actor: 'stripe-sandbox-ledger', reason: `${sandboxServicePolicy}: verified owned sandbox service evidence ${evaluation.proof}.` } });
      current = { ...current, state: grant.revoked ? 'revoked' : 'granted', startsAt: evaluation.startsAt, endsAt: evaluation.endsAt, proof: evaluation.proof };
    }
    if (current.state === 'revoked') current.reviewReasons = [...new Set([...current.reviewReasons, 'terminal-source' as const])].sort();
    current = serviceEvidenceSchema.parse(current);
    await this.db.prepare(`INSERT INTO stripe_invoice_service_evidence (account_id,invoice_id,customer_ref,source_key,policy_version,revision,payload)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT (account_id,invoice_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload`)
      .run(this.settings.accountId, invoice.id, customer.id, source.key, sandboxServicePolicy, revision, encodePayload(current, 8192));
  }
}
