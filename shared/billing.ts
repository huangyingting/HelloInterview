import type { OwnedBillingLedgerView } from './billing-ledger';
import type { sandboxServicePolicy } from './billing-ledger';

export const sandboxOffers = ['pro_monthly', 'pro_annual'] as const;
export type SandboxOffer = typeof sandboxOffers[number];
export const sandboxRecheckoutAuthority = 'sandbox-ended-recheckout-v1' as const;
export interface SandboxCheckoutView {
  id: string;
  requestKey: string;
  offer: SandboxOffer;
  state: 'waiting-customer' | 'queued' | 'open' | 'complete' | 'expired';
  processing: string;
  expiresAt: string;
  quote: { currency: string; unitAmount: number } | null;
  paymentStatus: string | null;
  subscriptionRef: string | null;
  previousSubscriptionRef: string | null;
}
export interface SandboxBillingView {
  mode: 'sandbox';
  enabled: boolean;
  customerReady: boolean;
  portalEnabled: boolean;
  checkout: SandboxCheckoutView | null;
  ledger: OwnedBillingLedgerView | null;
  accessAuthority: 'none' | typeof sandboxServicePolicy;
}
