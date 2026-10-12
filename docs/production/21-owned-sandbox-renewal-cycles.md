# 21 - Owned sandbox renewal resumption and repeat cycles

**Status: private test-mode engineering checkpoint, not live billing approval.**
This adds acknowledged durable renewal resumption and subsequent owned
stop/resume cycles. It does not reactivate an ended subscription, create a new
Checkout, take an immediate payment, extend paid access or approve commercial
terms. Restricted Portal sessions still cannot change subscriptions.

## Release, migration and retained authority

Apply controlled **migration 15 and maintained queue migration** using
`npm run db:migrate` before starting this release. Drain incompatible binaries;
rollback must retain these records and use a release that understands the new
authority. Published migrations 1-14 remain unchanged.

Migration 15 upgrades existing cancellation rows to cycle zero without changing
IDs, operation payloads, receipts or confirmations. It replaces the one-row-per-
subscription constraint with unique subscription/cycle and unique predecessor
constraints. First cancellation retains `sandbox-renewal-control-v1`;
subsequent cycles use `sandbox-renewal-control-v2`.

`stripe_subscription_resumptions` retains one immutable intent per exact
cancellation, `sandbox-renewal-resumption-v1`, the owned customer/subscription/
completed Checkout, captured epoch, Price/offer/USD quote, item/period/anchor,
invoice and eligibility proof, explicit acknowledgment, maintained operation,
queued/confirmed state and coherent confirmation/result. Composite foreign keys
bind both directions of the chain to the same customer, subscription and
Checkout. Application guards require consecutive latest owned lineage.

The maintained `billing.subscription.resume` kind uses
`billing-subscription-resume` with existing singleton, heartbeat, expiry,
bounded retry, dead-letter and audited replay behavior. Startup rejects missing
application or queue migrations. Do not remove history, reset operation age or
rewrite a published intent to recover or downgrade.

## Explicit owned request and anti-replay contract

Targets are opaque owned subscription **ledger UUIDs** from `GET /api/billing`,
never provider IDs. Fresh managed authentication, active verified contact,
current session/CSRF, shared billing admission and transactional ownership
checks apply.

```text
POST /api/billing/subscriptions/:ownedLedgerUUID/resume
{
  "cancellationId": "<exact owned cancellation UUID>",
  "acknowledged": true
}

202 { id: <owned resumption UUID>, accepted: true }
```

Acknowledgment authorizes future automatic test renewals at the retained
reference offer, not immediate payment or an access grant. A false/missing
acknowledgment, arbitrary provider target, Price, payment or proration fields
is rejected. A foreign owner receives not-found without financial details.

Only the latest confirmed owned `nonrenewing` cancellation may create a
resumption. Concurrent replicas or deliberately retried unknown HTTP responses
reuse that same immutable intent and native operation. Queued work with a
changed epoch or failed/canceled/missing native operation requires operator
reconciliation, not replacement consent.

The first cancellation keeps its original request:

```text
POST /api/billing/subscriptions/:ownedLedgerUUID/cancel
{}
```

After a confirmed resumption, the next stop requires:

```text
POST /api/billing/subscriptions/:ownedLedgerUUID/cancel
{ "previousResumptionId": "<exact latest confirmed owned resumption UUID>" }
```

Each new cycle gets a new cancellation and operation UUID. An existing
predecessor request never creates a replacement cancellation. **An old `{}` retry
always targets cycle zero; it cannot stop a later cycle.** Similarly, an old
resumption request cannot resume a later cancellation. Historical successful
retries return the historical intent; `accepted` does not mean current renewal
flags were changed again. Callers must reload owned canonical status.

Never infer a target from "latest" at retry time or reuse a financial operation
key across cycles. An external flag change without owned lineage requires
review instead of silently manufacturing an app-authorized resumption.

## New-consent and dispatch boundaries

New resumption requires an active subscription with scheduled cancellation,
its completed owned Checkout and its still-enabled exact reference Price. The
owned canonical ledger must be complete, requested/reconciled revisions equal,
and observed age nonnegative and strictly under five minutes.

The existing pure sandbox service evaluator must establish the **current
funded supported calendar interval** for its latest invoice, with current
database time inside the interval. Refunds, disputes, issued credits,
unsupported lines/calendar periods and inconsistent funding hold admission.
This evaluation is required even in observation-only mode. It is a minimized
eligibility proof, not an entitlement issuing operation or permission to
restore a previously retired source.

The durable intent captures the quote, invoice/proof, item, current period and
billing anchor. Immediately before an SDK write, local authority is checked
again: owner/epoch, exact mapped customer, latest lineage, completed Checkout/
quote, native claim, enabled reference offer and the same fresh funding proof.
The original operation age must be nonnegative and **strictly under 20 hours**;
retry does not restart it. A write heartbeat precedes the final guards.

The funding proof describes the last complete bounded canonical observation.
It cannot atomically freeze Stripe against external changes after that
observation. Independently reconciled future invoices, not a renewal flag,
determine future access.

## Narrow SDK command and canonical recovery

SDK I/O remains outside SQL. A normal dispatch uses exactly **eight SDK calls**,
with an eight-call cap: account, customer, initial subscription, Price, product,
update, final subscription and final customer. SDK retries remain disabled.
Each call uses maintained claim/shutdown checkpoints.

For a new write, the adapter requires own-account test customer and subscription,
exact server-created metadata, one complete quantity-one item, captured Price,
item/period/anchor/latest invoice, active supported USD licensed cadence and
original amount, and an active test product. It rejects Connect application/
on-behalf-of/transfer/application-fee scope, schedules, pending updates, trials,
pause collection, tax/discount/threshold policies, invoice-interval changes and
custom cancellation dates. Subscription item taxes, discounts and thresholds
are also rejected. A generated `cancel_at` may be null or exactly item period
end; it is not an arbitrary operator-selected date.

The only provider mutation is:

```text
subscriptions.update(capturedSubscription, {
  cancel_at_period_end: false,
  proration_behavior: "none"
}, { idempotencyKey: originalOperationId })
```

It does not ask for prorations, change Price/items/anchor, retry an invoice,
charge/refund money or update a payment method. It is not a blanket guarantee
against independent provider invoices, usage or external activity. A previously
funded card invoice does not prove the method or outcome of a future renewal.

The final independent canonical read must still be the exact active owned
subscription with flag false and `cancel_at=null`. A mutation must preserve the
captured period/latest invoice. Final customer ownership must also match.
Cached idempotent POST responses cannot override a current reversal, changed
period, custom cancellation date, foreign mapping or outage.

Already-renewing canonical state can recover **read-only in five calls**. This
remains possible after the original mutation window or offer withdrawal, without
another POST or restoring an old entitlement. Captured scope/item/Price/anchor
and supported control policy still apply. An ended subscription is not revived.
Confirmation establishes observed desired state, not proof that this particular
operation caused every provider change.

## Atomic publication, access and private UI

After SDK reads, publication reacquires current owner/epoch/customer, retained
intent and latest cancellation/Checkout/quote lineage. Under the maintained
native completion fence it commits together:

1. Canonical `renewing` confirmation and timestamp.
2. Dirty owned ledger revision and maintained snapshot handoff.
3. Minimized resumption receipt and native completion.

Actual SQL errors, native expiry, ownership/security changes or deletion roll
all publication back. Remote success may still exist. The honest state remains
queued/unknown, not "nothing happened" or permission to replace the intent.
An accepted durable billing consent is not withdrawn merely by logging out.
Epoch/account changes still fence later dispatch/publication.

No resumption or cycle directly changes grants, grant intervals/source/hash,
entitlement audit, funding, refunds or owned premium archives. Ordinary ledger
reconciliation advances its observation revision while replaying the same
immutable eligible source. Database-clock expiry, adjustments and independent
account/source permissions remain authoritative.

The private UI shows current flags separately from retained latest-cycle
cancellation/resumption and native processing state. Resumption requires an
inline same-price acknowledgment tied to the exact cancellation ID. Resuming
a new cancellation requires fresh acknowledgment tied to that new cycle.
There are no optimistic access extensions or modal dialogs. Polling observes
queued resumption and the subsequent canonical ledger. Stop-again requests
carry the exact confirmed predecessor.

General billing DTOs expose only minimized latest-cycle status and opaque IDs,
not provider IDs, captured security/eligibility proof or financial secrets.
Earlier history remains retained, not duplicated in the subscription list.
Unknown resumption may require operator reconciliation before another stop;
this is not yet a staffed emergency-cancellation or paid-deletion service.

## Evidence and remaining gates

The focused backend suite covers 23 cases using real PostgreSQL, managed HTTPS/
CSRF, replicas and the pinned official SDK against a synthetic loopback provider.
It exercises strict acknowledgment, current supported funded intervals,
observation-only annual behavior, fiscal/control/quote/period drift, exact
eight-call writes and five-call recovery, native/epoch/mapping/deletion fences,
unknown success, immutable age, repeat cycles and stale target replay.

Nontransactional sequence witnesses prove actual admission/publication SQL
executed before rollback. A migration-14 database with a real confirmed original
cancellation proves migration 15 preserves IDs, payloads and confirmations.
Compiled maintained reconciliation claims the new queue without development
loaders. Paid source/audit, funded money and a real saved premium mock remain
unchanged.

Two additional actual Chromium journeys prove same-price inline consent,
repeat cycles with exact request bodies and fresh per-cycle acknowledgment,
lost real accepted resumption response recovery without replacing consent,
unchanged Free/Pro access, secret minimization and mobile layout.

This does not provide authentic Stripe-hosted/test-clock evidence or approve
commercial/grace/refund/dispute rules. Ended-subscription recheckout is outside
this checkpoint and is subsequently implemented in
[checkpoint 22](22-owned-ended-subscription-recheckout.md), not by this resumption
command; historical renewal authority remains unchanged. Financial history
partitioning, staffed support/privacy, operated recovery, paid deletion,
vendor/merchant/legal approval and live mode remain gated.

Provider references:
[subscription update](https://docs.stripe.com/api/subscriptions/update),
[cancellation and cancel-at-period-end reversal](https://docs.stripe.com/billing/subscriptions/cancel).
