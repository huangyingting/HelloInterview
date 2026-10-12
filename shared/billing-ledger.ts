export const billingReviewReasons = [
  'unexpected-subscription', 'checkout-not-reconciled', 'unexpected-price', 'duplicate-subscriptions',
  'trial-not-supported', 'uncorrelated-invoice', 'invoice-adjustment', 'payment-attestation-pending',
  'payment-lifecycle-unverified',
] as const;
export type BillingReviewReason = typeof billingReviewReasons[number];
export interface OwnedBillingLedgerView {
  authority: 'sandbox-ledger-observation-only';
  processing: string;
  stale: boolean;
  observedAt: string | null;
  reviewReasons: BillingReviewReason[];
  subscriptions: { id: string; status: string; nonrenewing: boolean; currentPeriodEnd: string | null }[];
  invoices: { id: string; status: string; currency: string; total: number; amountPaid: number; amountRemaining: number; paidAt: string | null }[];
  historyTruncated: boolean;
}
