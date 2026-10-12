export const billingReviewReasons = [
  'unexpected-subscription', 'checkout-not-reconciled', 'unexpected-price', 'duplicate-subscriptions',
  'trial-not-supported', 'uncorrelated-invoice', 'invoice-adjustment', 'payment-attestation-pending',
  'payment-lifecycle-unverified',
  'commercial-policy-pending', 'payment-not-settled', 'unsupported-payment-funding', 'refund-pending',
  'payment-refunded', 'payment-disputed', 'credit-adjustment',
] as const;
export type BillingReviewReason = typeof billingReviewReasons[number];
export const fundingStates = ['unpaid', 'review-required', 'settled', 'partially-refunded', 'refunded', 'disputed'] as const;
export type FundingState = typeof fundingStates[number];
export interface OwnedBillingLedgerView {
  authority: 'sandbox-ledger-observation-only';
  processing: string;
  stale: boolean;
  observedAt: string | null;
  reviewReasons: BillingReviewReason[];
  subscriptions: { id: string; status: string; nonrenewing: boolean; currentPeriodEnd: string | null }[];
  invoices: { id: string; status: string; currency: string; total: number; amountPaid: number; amountRemaining: number; paidAt: string | null;
    funding: { state: FundingState; captured: number; refunded: number; creditAdjusted: boolean } | null }[];
  historyTruncated: boolean;
}
