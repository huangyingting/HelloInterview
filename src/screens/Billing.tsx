import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from '../navigation';
import { sandboxOffers, type SandboxBillingView, type SandboxOffer } from '../../shared/billing';
import type { IdentitySecurity } from '../../shared/types';
import { AuthPrompt, Badge, PageHeading } from '../components';
import { request, useStudio } from '../store';
import { Select } from '../components/Select';

interface SavedRequest { key: string; offer: SandboxOffer; previousSubscriptionRef?: string; acknowledged?: true }
function savedRequest(key: string): SavedRequest | null {
  const text = sessionStorage.getItem(key);
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' || !('key' in value) || typeof value.key !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.key) ||
    !('offer' in value) || ![2, 4].includes(Object.keys(value).length)) throw new Error('The saved sandbox request is invalid. Do not start a replacement while its outcome is unknown.');
  const offer = sandboxOffers.find(offer => offer === value.offer);
  if (!offer) throw new Error('The saved sandbox offer is invalid. Refresh owned billing status before continuing.');
  if (Object.keys(value).length === 2) return { key: value.key, offer };
  if (!('previousSubscriptionRef' in value) || typeof value.previousSubscriptionRef !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value.previousSubscriptionRef) ||
    !('acknowledged' in value) || value.acknowledged !== true) throw new Error('The saved recheckout predecessor or acknowledgment is invalid. Do not replace unknown consent.');
  return { key: value.key, offer, previousSubscriptionRef: value.previousSubscriptionRef, acknowledged: true };
}
const labels = { pro_monthly: 'Monthly reference offer', pro_annual: 'Annual reference offer' };
export function SandboxBillingPage() {
  const { data, act, pending, refresh: refreshAccess } = useStudio(), [params] = useSearchParams();
  const [view, setView] = useState<SandboxBillingView | null>(null), [security, setSecurity] = useState<IdentitySecurity | null>(null);
  const [offer, setOffer] = useState<SandboxOffer>('pro_monthly'), [intent, setIntent] = useState<SavedRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [error, setError] = useState('');
  const [resumeAcknowledgedFor, setResumeAcknowledgedFor] = useState<string | null>(null);
  const [recheckoutAcknowledgedFor, setRecheckoutAcknowledgedFor] = useState<string | null>(null);
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
  const cancellationReading = view?.ledger?.subscriptions.some(sub => ['created', 'retry', 'active'].includes(sub.cancellation?.processing ?? '') ||
    ['created', 'retry', 'active'].includes(sub.cancellation?.resumption?.processing ?? '')) ?? false;
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
  const checkout = view?.checkout;
  const previousRef = checkout?.state === 'complete' ? checkout.subscriptionRef : checkout?.previousSubscriptionRef;
  const previous = previousRef ? view?.ledger?.subscriptions.find(sub => sub.id === previousRef) : null;
  const recheckoutTarget = previous && ['canceled', 'incomplete_expired'].includes(previous.status) ? previous.id : null;
  const recheckoutReady = recheckoutTarget && !view?.ledger?.stale && !view?.ledger?.historyTruncated &&
    view?.ledger?.subscriptions.every(sub => ['canceled', 'incomplete_expired'].includes(sub.status) &&
      sub.cancellation?.state !== 'queued' && sub.cancellation?.resumption?.state !== 'queued');
  const unresolved = checkout && checkout.state !== 'expired' && !(checkout.state === 'complete' && recheckoutTarget);
  const savedExpired = checkout?.state === 'expired' && checkout.requestKey === intent?.key;
  const savedCompleted = checkout?.state === 'complete' && checkout.requestKey === intent?.key && !!recheckoutTarget;
  const savedResolved = savedExpired || savedCompleted;
  const consentReady = recheckoutTarget ? recheckoutAcknowledgedFor === recheckoutTarget : acknowledged;
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
      {view?.portalEnabled && <div>
        <p>Restricted hosted sandbox Portal: card-method updates and invoice history only. No plan changes, provider-login shortcut or portal-side cancellation.
          Updating a payment method or returning here is not payment or premium-access proof.</p>
        <p>Each click prepares a fresh hosted session. An unknown opening can be retried without creating a subscription.
          Signing out here cannot revoke a provider link already delivered; do not share it.</p>
        <button className="button secondary small" disabled={pending || !view.customerReady || !security?.fresh} onClick={() => action(async () => {
          const result = await request<{ url: string }>('/api/billing/portal', {});
          window.location.assign(result.url);
        })}>Open restricted sandbox Portal</button>
      </div>}
      {params.has('portal') && <p role="status">Returned from hosted billing. Refresh the owned canonical ledger; the return message cannot prove a card update or payment.</p>}
    </section>
    {checkout && <section className="panel">
      <h2>Your sandbox checkout</h2><p>{labels[checkout.offer]} - <strong>{checkout.state.replaceAll('-', ' ')}</strong></p>
      <p>Processing: {checkout.processing}. Hosted session deadline: {new Date(checkout.expiresAt).toLocaleString()}.</p>
      {checkout.quote && <p>Reference recurring price: {new Intl.NumberFormat(undefined, { style: 'currency', currency: checkout.quote.currency }).format(checkout.quote.unitAmount / 100)}. Final test details are shown by the provider.</p>}
      {needsReview && <p role="status">An operator must inspect this unresolved intent and reconcile its provider outcome. Do not create a replacement customer or checkout.</p>}
      {checkout.state === 'complete' && <p>Sandbox session completed; payment display: {checkout.paymentStatus ?? 'unavailable'}.
        {' '}{sandboxAccess ? 'The session alone is not service authority; inspect the separate sandbox grant below.' : 'No paid entitlement was issued.'}
        {' '}A new subscription requires a canonically ended predecessor and explicit new sandbox consent.</p>}
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
      {view.ledger?.subscriptions.map(sub => <div key={sub.id}><p>Observed subscription: <strong>{sub.status.replaceAll('_', ' ')}</strong>.
        {' '}{sub.nonrenewing ? 'Renewal is disabled.' : 'No cancellation-at-period-end flag observed.'}
        {' '}{sub.currentPeriodEnd && `Reported item period end: ${new Date(sub.currentPeriodEnd).toLocaleString()}.`}
        {' '}{sub.cancellation && <>Sandbox cancellation: <strong>{sub.cancellation.state}</strong>; processing: {sub.cancellation.processing}.
          {' '}{sub.cancellation.state === 'queued' && 'A requested cancellation is not confirmation. The maintained worker must verify provider state.'}
          {' '}{sub.cancellation.confirmedAt && `Last verified ${new Date(sub.cancellation.confirmedAt).toLocaleString()}: ${sub.cancellation.result}.`}
          {' '}{['failed', 'cancelled', 'missing'].includes(sub.cancellation.processing) && 'An operator must reconcile the unknown external outcome; do not replace this intent.'}
          {' '}Owned cancellation cycle: {sub.cancellation.cycle}.
          {' '}{sub.cancellation.resumption && <>Sandbox resumption: <strong>{sub.cancellation.resumption.state}</strong>; processing: {sub.cancellation.resumption.processing}.
            {' '}{sub.cancellation.resumption.state === 'queued' && 'Acknowledged future renewal is queued, not confirmed. Logout does not withdraw a durable billing request.'}
            {' '}{sub.cancellation.resumption.confirmedAt && `Last verified ${new Date(sub.cancellation.resumption.confirmedAt).toLocaleString()}: ${sub.cancellation.resumption.result}.`}
            {' '}{['failed', 'cancelled', 'missing'].includes(sub.cancellation.resumption.processing) && 'An operator must reconcile this unknown renewal outcome; do not replace its intent.'}</>}
          {' '}{sub.cancellation.state === 'confirmed' && !view.ledger?.stale && !['canceled', 'incomplete_expired'].includes(sub.status) &&
            (sub.cancellation.resumption?.state === 'confirmed' ? sub.nonrenewing : !sub.nonrenewing && !sub.cancellation.resumption) &&
            'Current renewal state differs from the retained owned confirmation. Operator review is required; external changes are not silently overridden.'}</>}
        {' '}{!sub.nonrenewing && (!sub.cancellation || sub.cancellation.resumption?.state === 'confirmed') && ['active', 'past_due', 'unpaid', 'paused'].includes(sub.status) &&
          <button className="button secondary small" disabled={pending || !security?.fresh || view.ledger?.stale} onClick={() => action(async () => {
            const previous = sub.cancellation?.resumption;
            await request(`/api/billing/subscriptions/${sub.id}/cancel`, previous ? { previousResumptionId: previous.id } : {}); await load();
          })}>Stop sandbox renewal</button>}</p>
        {sub.nonrenewing && sub.status === 'active' && sub.cancellation?.state === 'confirmed' && sub.cancellation.result === 'nonrenewing' &&
          !sub.cancellation.resumption && view.checkout?.quote && <div>
          <label><input type="checkbox" checked={resumeAcknowledgedFor === sub.cancellation.id}
            disabled={pending || !security?.fresh || view.ledger?.stale || !view.enabled}
            onChange={event => setResumeAcknowledgedFor(event.target.checked ? sub.cancellation?.id ?? null : null)}/>
            I acknowledge future automatic sandbox renewal at the same {labels[view.checkout.offer].toLowerCase()}:
            {' '}{new Intl.NumberFormat(undefined, { style: 'currency', currency: view.checkout.quote.currency }).format(view.checkout.quote.unitAmount / 100)}.
            This grants no additional paid access now.</label>
          <button className="button secondary small" disabled={pending || !security?.fresh || view.ledger?.stale || !view.enabled ||
            resumeAcknowledgedFor !== sub.cancellation.id} onClick={() => action(async () => {
              await request(`/api/billing/subscriptions/${sub.id}/resume`, { cancellationId: sub.cancellation?.id, acknowledged: true }); await load();
            })}>Resume sandbox renewal</button>
        </div>}
      </div>)}
      {!!view.ledger?.subscriptions.length && <p>Stopping sandbox renewal does not refund money, end paid access immediately or erase saved work.
        Resuming acknowledges future test renewals at the captured reference offer, not an immediate payment or a new entitlement.
        Current access comes from eligible invoice intervals and account policy, never a renewal-control request.
        Recheckout creates a new owned intent only after the previous subscription is canonically ended; preparation alone grants no access.</p>}
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
      <h2>{recheckoutTarget ? 'Recheckout after an ended sandbox subscription' : 'Start a sandbox intent'}</h2>
      {recheckoutTarget && <p>Keep the previous Checkout and paid interval as retained history. This prepares a new test subscription at the selected reference offer,
        not a resumption, refund, allowance reset or access extension. Final recurring test details are confirmed on hosted checkout.</p>}
      {recheckoutTarget && !recheckoutReady && <p role="status">Refresh complete canonical ended history and reconcile unknown renewal-control outcomes before recheckout.</p>}
      {!intentReady && <p>Saved retry information must be loaded before reserving a new intent. Reload owned status; an unknown request must not be replaced.</p>}
      {!view.enabled && <p>New sandbox checkout is disabled by the operator. Existing owned intents are retained for reconciliation.</p>}
      {intent && !savedResolved && <p>A saved request will be reused exactly. An unknown response never creates a replacement request key.</p>}
      <label>Reference offer<Select aria-label="Reference offer" value={offer} disabled={pending || !!intent && !savedResolved} onValueChange={selectedValue => {
        const value = sandboxOffers.find(offer => offer === selectedValue); if (value) setOffer(value);
      }} options={sandboxOffers.map(value => ({ value, label: labels[value] }))}/></label>
      <label><input type="checkbox" checked={!!consentReady} onChange={event => {
        if (recheckoutTarget) setRecheckoutAcknowledgedFor(event.target.checked ? recheckoutTarget : null);
        else setAcknowledged(event.target.checked);
      }}/> {recheckoutTarget ? 'I acknowledge a new sandbox subscription after the confirmed end of the previous subscription.' : sandboxAccess ?
        'I understand this is sandbox-only with test-service access, not a production purchase.' :
        'I understand this is sandbox-only and grants no premium access.'}</label>
      <button className="button" disabled={pending || !intentReady || !view.enabled || !consentReady || !security?.fresh || !!error ||
        !!recheckoutTarget && !recheckoutReady} onClick={() => action(async () => {
        const saved = savedResolved ? null : intent;
        const next: SavedRequest = saved ?? { key: crypto.randomUUID(), offer,
          ...(recheckoutTarget ? { previousSubscriptionRef: recheckoutTarget, acknowledged: true } : {}) };
        sessionStorage.setItem(storageKey, JSON.stringify(next)); setIntent(next);
        await request<{ id: string }>('/api/billing/checkouts', next); await load();
      })}>{intent && !savedResolved ? 'Retry saved sandbox request' : recheckoutTarget ? 'Prepare new sandbox checkout' : 'Prepare sandbox checkout'}</button>
    </section>}
  </>;
}
