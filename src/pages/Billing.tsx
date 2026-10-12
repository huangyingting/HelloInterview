import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { sandboxOffers, type SandboxBillingView, type SandboxOffer } from '../../shared/billing';
import type { IdentitySecurity } from '../../shared/types';
import { AuthPrompt, Badge, PageHeading } from '../components';
import { request, useStudio } from '../store';

interface SavedRequest { key: string; offer: SandboxOffer }
function savedRequest(key: string): SavedRequest | null {
  const text = sessionStorage.getItem(key);
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.key) ||
    !('offer' in value) || Object.keys(value).length !== 2) throw new Error('The saved sandbox request is invalid. Do not start a replacement while its outcome is unknown.');
  const offer = sandboxOffers.find(offer => offer === value.offer);
  if (!offer) throw new Error('The saved sandbox offer is invalid. Refresh owned billing status before continuing.');
  return { key: value.key, offer };
}
const labels = { pro_monthly: 'Monthly reference offer', pro_annual: 'Annual reference offer' };
export function SandboxBillingPage() {
  const { data, act, pending, refresh: refreshAccess } = useStudio(), [params] = useSearchParams();
  const [view, setView] = useState<SandboxBillingView | null>(null), [security, setSecurity] = useState<IdentitySecurity | null>(null);
  const [offer, setOffer] = useState<SandboxOffer>('pro_monthly'), [intent, setIntent] = useState<SavedRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const [intentReady, setIntentReady] = useState(false);
  const returned = useRef<string | null>(null);
  const accessSnapshot = useRef<string | null>(null);
  const available = data.capabilities.auth?.mode === 'managed' && !!data.capabilities.billing && data.user?.identity?.status === 'active';
  const storageKey = `studio-sandbox-checkout:${data.user?.id ?? ''}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await request<SandboxBillingView>('/api/billing', undefined, undefined, signal);
    if (!signal?.aborted && result.accessAuthority !== 'none' && result.ledger?.observedAt && accessSnapshot.current !== result.ledger.observedAt) {
      await refreshAccess(true);
      if (!signal?.aborted) accessSnapshot.current = result.ledger.observedAt;
    }
    if (!signal?.aborted) setView(result);
    return result;
  }, [refreshAccess]);
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    Promise.all([load(controller.signal), request<IdentitySecurity>('/api/identity/security', undefined, undefined, controller.signal)])
      .then(([, proof]) => {
        if (controller.signal.aborted) return;
        const saved = savedRequest(storageKey);
        setIntent(saved); if (saved) setOffer(saved.offer);
        setSecurity(proof); setIntentReady(true); setError('');
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Sandbox billing could not be loaded.'); });
    return () => controller.abort();
  }, [available, storageKey, load]);
  const processing = view?.checkout?.processing, state = view?.checkout?.state;
  const ledgerProcessing = view?.ledger?.processing;
  const cancellationReading = view?.ledger?.subscriptions.some(sub => ['created', 'retry', 'active'].includes(sub.cancellation?.processing ?? '')) ?? false;
  const sandboxAccess = !!view && view.accessAuthority !== 'none';
  useEffect(() => {
    const preparing = ['waiting-customer', 'queued'].includes(state ?? '');
    const reading = ['created', 'retry', 'active'].includes(processing ?? '');
    const ledgerReading = ['created', 'retry', 'active'].includes(ledgerProcessing ?? '');
    if (!available || !preparing && !reading && !ledgerReading && !cancellationReading ||
      !ledgerReading && !cancellationReading && ['failed', 'cancelled', 'missing'].includes(processing ?? '')) return;
    const controller = new AbortController();
    let count = 0, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await load(controller.signal); }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Sandbox status refresh failed.'); return; }
      if (!controller.signal.aborted && ++count < 20) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [available, view?.checkout?.id, state, processing, ledgerProcessing, cancellationReading, load]);
  const action = (operation: () => Promise<void>) => act(async () => {
    setError('');
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The sandbox action failed. Its outcome has not been replaced with a new request.'); throw cause; }
  });
  const refresh = (id: string) => action(async () => { await request(`/api/billing/checkouts/${id}/refresh`, {}); await load(); });
  useEffect(() => {
    const id = view?.checkout?.id;
    if (!available || !security?.fresh || !id || params.get('attempt') !== id || returned.current === id ||
      !['open', 'complete', 'expired'].includes(state ?? '')) return;
    returned.current = id;
    void refresh(id);
  }, [available, security?.fresh, view?.checkout?.id, state, params]);
  if (!data.user) return <AuthPrompt/>;
  if (!available) return <PageHeading eyebrow="BILLING" title="Sandbox billing is unavailable." description="A configured private sandbox and an active verified managed account are required. Production purchases remain disabled."/>;
  const checkout = view?.checkout, unresolved = checkout && checkout.state !== 'expired';
  const savedExpired = checkout?.state === 'expired' && checkout.requestKey === intent?.key;
  const needsReview = checkout && ['failed', 'cancelled', 'missing'].includes(checkout.processing);
  return <>
    <PageHeading eyebrow="PRIVATE SANDBOX" title="Rehearse hosted checkout." description={sandboxAccess ?
      'Test-mode billing with explicitly enabled, expiring sandbox service access. Production purchases remain disabled.' :
      'Test-mode billing only. No production purchase or payment-based premium access is enabled.'}/>
    <section className="panel">
      <Badge tone="amber">Sandbox only</Badge>
      <p>Use provider test payment details only, never a real card. Reference prices are not approved commercial offers.
        {' '}{sandboxAccess ? 'Only verified funding and an eligible service interval can issue test access under the configured sandbox policy.' :
          'A completed sandbox checkout does not change your premium access.'}</p>
      <p>Customer and session ownership come from your authenticated account. Return URLs, email addresses and browser messages cannot prove payment.</p>
      {params.has('attempt') && <p role="status">Returned from hosted checkout. Only a refresh of your owned canonical session can update the status below.</p>}
      {error && <p role="alert">{error} Last displayed information is not a new payment confirmation.</p>}
      {!security?.fresh && <p>Confirm an existing sign-in method in <Link to="/account">Account security</Link> before creating, opening or refreshing a hosted session.</p>}
      {!view && !error && <p role="status">Loading owned sandbox billing...</p>}
      <button className="button secondary small" disabled={pending} onClick={() => action(async () => {
        setIntentReady(false);
        const saved = savedRequest(storageKey);
        await load(); setSecurity(await request<IdentitySecurity>('/api/identity/security'));
        setIntent(saved); if (saved) setOffer(saved.offer); setIntentReady(true);
      })}>Reload owned status</button>
    </section>
    {checkout && <section className="panel">
      <h2>Your sandbox checkout</h2><p>{labels[checkout.offer]} - <strong>{checkout.state.replaceAll('-', ' ')}</strong></p>
      <p>Processing: {checkout.processing}. Hosted session deadline: {new Date(checkout.expiresAt).toLocaleString()}.</p>
      {checkout.quote && <p>Reference recurring price: {new Intl.NumberFormat(undefined, { style: 'currency', currency: checkout.quote.currency }).format(checkout.quote.unitAmount / 100)}. Final test details are shown by the provider.</p>}
      {needsReview && <p role="status">An operator must inspect this unresolved intent and reconcile its provider outcome. Do not create a replacement customer or checkout.</p>}
      {checkout.state === 'complete' && <p>Sandbox session completed; payment display: {checkout.paymentStatus ?? 'unavailable'}.
        {' '}{sandboxAccess ? 'The session alone is not service authority; inspect the separate sandbox grant below.' : 'No paid entitlement was issued.'}
        {' '}Further subscriptions remain blocked pending billing lifecycle reconciliation.</p>}
      {checkout.state === 'open' && <button className="button" disabled={pending || !security?.fresh || !!error} onClick={() => action(async () => {
        const result = await request<{ url: string }>(`/api/billing/checkouts/${checkout.id}/open`, {});
        window.location.assign(result.url);
      })}>Open hosted sandbox checkout</button>}
      {['open', 'complete', 'expired'].includes(checkout.state) && <button className="button secondary" disabled={pending || !security?.fresh} onClick={() => refresh(checkout.id)}>Refresh canonical session</button>}
      {['waiting-customer', 'queued'].includes(checkout.state) && <p>Preparation requires the maintained billing worker. Polling is bounded; reload owned status if preparation takes longer.</p>}
    </section>}
    {view?.customerReady && <section className="panel">
      <h2>Canonical sandbox ledger</h2>
      <p>{sandboxAccess ? 'Explicit sandbox service policy is enabled. Only eligible owned invoice intervals can issue expiring test access; refunds, disputes and issued credits terminally retire their source. This is not approved live commerce.' :
        'Canonical sandbox financial observations only. A settled card-funding trace is not approved commercial or service-period authority. No paid access is granted.'}</p>
      <p>Last observation: {view.ledger?.observedAt ? new Date(view.ledger.observedAt).toLocaleString() : 'not yet available'}.
        {' '}Processing: {view.ledger?.processing ?? 'not yet requested'}. {view.ledger?.stale && 'The last displayed snapshot is stale or a newer read is pending.'}</p>
      {view.ledger?.reviewReasons.length ? <p role="status">Operator review required: {view.ledger.reviewReasons.map(reason => reason.replaceAll('-', ' ')).join(', ')}.</p> : null}
      {['failed', 'cancelled', 'missing'].includes(view.ledger?.processing ?? '') && <p role="status">Canonical reconciliation is incomplete. An operator must inspect the queue before retrying; older records are not a fresh confirmation.</p>}
      {view.ledger?.subscriptions.map(sub => <p key={sub.id}>Observed subscription: <strong>{sub.status.replaceAll('_', ' ')}</strong>.
        {' '}{sub.nonrenewing ? 'Renewal is disabled.' : 'No cancellation-at-period-end flag observed.'}
        {' '}{sub.currentPeriodEnd && `Reported item period end: ${new Date(sub.currentPeriodEnd).toLocaleString()}.`}
        {' '}{sub.cancellation && <>Sandbox cancellation: <strong>{sub.cancellation.state}</strong>; processing: {sub.cancellation.processing}.
          {' '}{sub.cancellation.state === 'queued' && 'A requested cancellation is not confirmation. The maintained worker must verify provider state.'}
          {' '}{sub.cancellation.confirmedAt && `Last verified ${new Date(sub.cancellation.confirmedAt).toLocaleString()}: ${sub.cancellation.result}.`}
          {' '}{['failed', 'cancelled', 'missing'].includes(sub.cancellation.processing) && 'An operator must reconcile the unknown external outcome; do not replace this intent.'}
          {' '}{sub.cancellation.state === 'confirmed' && !sub.nonrenewing && !view.ledger?.stale && !['canceled', 'incomplete_expired'].includes(sub.status) &&
            'Current renewal state differs from the earlier confirmation. Operator review is required; resumption is not implemented.'}</>}
        {' '}{!sub.nonrenewing && !sub.cancellation && ['active', 'past_due', 'unpaid', 'paused'].includes(sub.status) &&
          <button className="button secondary small" disabled={pending || !security?.fresh || view.ledger?.stale} onClick={() => action(async () => {
            await request(`/api/billing/subscriptions/${sub.id}/cancel`, {}); await load();
          })}>Stop sandbox renewal</button>}</p>)}
      {!!view.ledger?.subscriptions.length && <p>Stopping sandbox renewal does not refund money, end paid access immediately or erase saved work.
        Current access comes from eligible invoice intervals and account policy, not the cancellation request. Portal and resumption remain unavailable.</p>}
      {view.ledger?.invoices.map(invoice => <p key={invoice.id}>Observed invoice: <strong>{invoice.status}</strong>.
        {' '}Total: {invoice.total} {invoice.currency.toUpperCase()} minor units; paid amount hint: {invoice.amountPaid}; remaining: {invoice.amountRemaining}.
        {' '}{invoice.funding ? `Referenced card funding: ${invoice.funding.state.replaceAll('-', ' ')}; captured: ${invoice.funding.captured}; succeeded refunds: ${invoice.funding.refunded}.` : 'Payment evidence has not been evaluated.'}
        {' '}{invoice.funding?.creditAdjusted && 'Issued credit adjustments require review.'}
        {' '}{invoice.service && <>Sandbox service access: <strong>{invoice.service.state}</strong>.
          {' '}{invoice.service.startsAt && `From ${new Date(invoice.service.startsAt).toLocaleString()}.`}
          {' '}{invoice.service.endsAt && `Exclusive access end: ${new Date(invoice.service.endsAt).toLocaleString()}.`}
          {' '}{invoice.service.reviewReasons.length > 0 && `Service review: ${invoice.service.reviewReasons.map(reason => reason.replaceAll('-', ' ')).join(', ')}.`}</>}
        {' '}{sandboxAccess ? 'A historical grant label does not override expiry, account restrictions or independent current server permissions.' :
          'These amounts do not prove an eligible paid service period.'}</p>)}
      {view.ledger?.historyTruncated && <p>The displayed owned history is limited to 20 subscriptions and 20 invoices. Older retained records have not been deleted.</p>}
      <button className="button secondary" disabled={pending || !security?.fresh} onClick={() => action(async () => {
        await request('/api/billing/reconcile', {}); await load();
      })}>Refresh canonical ledger</button>
    </section>}
    {view && !unresolved && <section className="panel">
      <h2>Start a sandbox intent</h2>
      {!intentReady && <p>Saved retry information must be loaded before reserving a new intent. Reload owned status; an unknown request must not be replaced.</p>}
      {!view.enabled && <p>New sandbox checkout is disabled by the operator. Existing owned intents are retained for reconciliation.</p>}
      {intent && !savedExpired && <p>A saved request will be reused exactly. An unknown response never creates a replacement request key.</p>}
      <label>Reference offer<select value={offer} disabled={pending || !!intent && !savedExpired} onChange={event => {
        const value = sandboxOffers.find(offer => offer === event.target.value); if (value) setOffer(value);
      }}>{sandboxOffers.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/> {sandboxAccess ?
        'I understand this is sandbox-only with test-service access, not a production purchase.' :
        'I understand this is sandbox-only and grants no premium access.'}</label>
      <button className="button" disabled={pending || !intentReady || !view.enabled || !acknowledged || !security?.fresh || !!error} onClick={() => action(async () => {
        const saved = savedExpired ? null : intent;
        const next = saved ?? { key: crypto.randomUUID(), offer };
        sessionStorage.setItem(storageKey, JSON.stringify(next)); setIntent(next);
        await request<{ id: string }>('/api/billing/checkouts', next); await load();
      })}>{intent && !savedExpired ? 'Retry saved sandbox request' : 'Prepare sandbox checkout'}</button>
    </section>}
  </>;
}
