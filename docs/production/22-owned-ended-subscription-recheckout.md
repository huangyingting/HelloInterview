# 22 - Owned sandbox recheckout after subscription end

**Status: private test-mode engineering checkpoint, not live billing approval.**
An owner can prepare a new hosted test subscription after complete canonical
confirmation that the previous subscription ended. This is a new Checkout and
eventual invoice source, not renewal resumption, immediate payment, refund,
allowance reset or permission to overwrite historical paid work.

## Release and current Checkout authority

Apply controlled **migration 16 and maintained queue migration** with
`npm run db:migrate` before starting this release. Published migrations 1-15
remain unchanged. Drain incompatible binaries; rollback must preserve the
new records and use a compatible application. Startup rejects incompatible
application or maintained queue migrations.

Migration 16 adds:

- Nullable coherent predecessor subscription/Checkout/provider references and
  explicit acknowledgment to recheckout attempts.
- Composite foreign keys binding those references to the same owned customer.
- `stripe_customer_checkout_cursor`, with a scoped current-attempt foreign key.
- A replacement unresolved index permitting retained historical `complete`
  rows but still allowing only one waiting/queued/open attempt per customer.

The cursor is backfilled using the previous release's unresolved-first,
created-time/ID selection. Original attempt IDs, state, keys, prices, SDK session/
subscription correlations, operation payloads and receipts are not rewritten.
After promotion, accepted reservations advance the cursor atomically. A new
expired or queued attempt must not be hidden behind an older completed row.
A missing cursor with retained attempts is an explicit reconciliation error,
not an empty account or authority to mint another subscription.

Initial Checkout operations keep their published payload and
`sandbox-correlation-only` receipt. Recheckout uses the existing maintained
`billing.checkout`/refresh queues, with a strict
`sandbox-ended-recheckout-v1` payload/receipt. There is no new customer creation,
queue kind, public purchase feature or live-mode flag.

## Fresh exact-parent request contract

```text
POST /api/billing/checkouts
{
  "key": "<new client request UUID retained before submission>",
  "offer": "pro_monthly" | "pro_annual",
  "previousSubscriptionRef": "<exact owned ended subscription ledger UUID>",
  "acknowledged": true
}

202 { id: <new owned Checkout UUID> }
```

The target is the opaque owned **ledger UUID**, not a provider subscription ID.
`GET /api/billing` exposes the current Checkout's nullable `subscriptionRef` and
`previousSubscriptionRef`, never its provider references. Missing/false
acknowledgment, arbitrary customer/Price/payment/redirect fields and provider
IDs are rejected. Another owner receives not-found without financial details.

The existing verified active managed owner, recent authentication, current
session/CSRF, shared billing admission and transactional pre/post security
checks apply. New reservations require enabled reference offers and the existing
mapped owned customer; they do not reserve a replacement customer.

Before accepting new consent:

1. The selected predecessor must be the retained completed Checkout represented
   by the current cursor, or the same predecessor of a current canonically
   expired recheckout.
2. Its owned subscription must be `canceled` or `incomplete_expired`, with exact
   Checkout correlation and no subscription review reasons.
3. Complete customer subscription history must be ended and supported. An
   active/nonrenewing subscription is not an ended subscription.
4. Owned ledger revisions must agree and observed age must be nonnegative and
   strictly under five minutes.
5. Queued/unknown cancellation or resumption outcomes require reconciliation
   before a new purchase intent.

Owner/customer/cursor and canonical authority are checked under short SQL
transactions. Reservation, acknowledged predecessor scope, cursor advancement,
operation and native queue handoff commit together. Actual SQL security/cursor
changes roll the reservation back, rather than leaving success-shaped status.

## Keys, replicas, expired attempts and stale retry

The client persists all four request fields **before** submission. Concurrent
replicas and a retried unknown accepted response reuse the same attempt,
operation, cursor and external idempotency key. Reusing a key with another
offer or predecessor returns conflict. A different key cannot replace a
waiting/queued/open attempt, including a failed or missing unknown native job.

A canonical `expired` recheckout can be followed by a new key targeting its
same ended predecessor. An expired clock or abandoned browser alone is not
expiry proof. The old request key continues to refer to its original expired
record; a retry cannot advance the current cursor.

After the new subscription completes and later ends, another purchase requires
that new exact subscription as predecessor. A still-older ended subscription
cannot authorize a fresh key. Existing original two-field request/key retries
continue to return their historical original intent; they cannot be silently
retargeted into recheckout.

Current status comes from the cursor and canonical ledger, not the return value
of a historical retry. Historical refresh remains owned and read-only. Only
the current open attempt can return its private hosted URL.

## SDK preparation, creation and unknown recovery

The durable payload captures new Price/offer/origin/deadline/epoch and exact
previous subscription ledger/Checkout/provider references, with acknowledgment
and policy version. It remains on the same owned customer resource.

SDK network I/O stays outside SQL. Normal preparation reuses the existing
**eight-call** contract: own account, customer, new Price, product, bounded
customer Checkout list, bounded customer subscription list, session POST and
final expanded session read. SDK retries are disabled; each POST uses the
original maintained operation UUID.

New creation requires:

- Exact own-account test customer and server-created metadata.
- Active supported test USD licensed quantity-one monthly/yearly Price/product.
- No ambiguous/paginated session matches or active customer subscription.
- Exactly one provider list entry for the captured ended predecessor, with
  matching own customer/Checkout metadata, complete single item and old Price.
- Fresh local owner/epoch/customer/cursor/retained parent, still-enabled captured
  offer and complete canonical ended history immediately before POST.
- Current native claim, original nonnegative operation age strictly under
  20 hours, and more than the existing 31-minute margin before captured expiry.

The new session uses the existing fixed server-owned subscription, card-only,
quantity-one, no promotion/automatic-tax/adaptive-pricing request, with fresh
new Checkout metadata. It does not edit or reactivate the old subscription or
copy its payment/invoice/grant identifiers into the new subscription.

Known matching sessions are recovered **read-only in six calls**, before any
new subscription-list/write branch. This remains possible after the original
mutation window, offer withdrawal or Price/product deactivation. It never
replaces the key or prepares a second session. No existing match beyond the
window requires review, not another POST.

Current local ownership/cursor/retained parent and canonical session scope
are rechecked before publication. Actual SDK customer/subscription movement,
mapping/epoch/cursor drift, outages and SQL/native expiry leave an honest
unknown result. Confirmation and native completion remain atomic. A provider
session may already exist despite local rollback; deleting an owner does not
pretend to undo it or permit later unowned retry.

Opening a recheckout session also requires fresh complete ended local history.
If payment or another subscription is already observed, refresh the current
session/ledger instead of opening an old cached link. Already delivered links
have the existing provider-hosted lifecycle limitations; app state is not
provider revocation or proof of authentic link expiry.

## Paid intervals, history and browser behavior

Reservation and hosted preparation leave old Checkout rows, renewal controls,
invoice/funding, grants/source hashes/intervals, entitlement audit and licensed
archives unchanged. Neither a return claim nor new Checkout completion alone
grants Pro.

Only independently reconciled funding and supported service evidence for the
new invoice can create its own interval under the separately configured
sandbox policy. Existing source/interval/audit stays immutable. Without that
policy, even a funded second test purchase remains Free and live commerce
disabled.

An externally canceled subscription can retain an unexpired paid interval.
Recheckout does not erase that interval. Multiple invoice-source intervals can
therefore overlap; no AI allowance refill or quota reset is implemented by this
command. Shared allowance-window/budget enforcement is still W09 work and a
launch requirement, not a promise of unlimited new quotas.

The owned UI shows a new inline preparation form only for the current ended
predecessor, with fresh acknowledgment separate from the original purchase or
renewal consent. It preserves the exact stored four-field request through
unknown admission/reload, accepts a new UUID only after known completion/expiry,
and shows the current cursor even while previous complete records remain.
Reference offer selection has an explicit accessible label.

Stale/incomplete/truncated displayed history or unknown renewal controls disable
new preparation and direct the owner to refresh/reconcile. The selected
reference offer is prepared first; final recurring test details remain visible
on owned hosted Checkout before provider payment consent. No modal or optimistic
access extension is introduced.

## Evidence and unfinished gates

The backend suite covers owned strict/fresh/CSRF admission, replicas and key
deduplication, exact current predecessor and stale-cycle retry, same-customer
eight-call creation, six-call recovery, separate funded intervals, original
paid source/audit/money and a real premium archive, observation-only Free
behavior, cursor integrity and partial-null database constraints.

SDK barriers exercise fresh epoch/mapping/cursor/dirty-ledger boundaries.
Nontransactional sequence witnesses prove actual admission/publication SQL
executed before rollback, including native expiry after external creation.
Actual migration-15 rows prove migration 16 preserves history and backfills
the cursor. Compiled maintained reconciliation claims the existing queue
without development loaders.

Two actual Chromium journeys cover fresh ended-subscription consent, a new
annual reference offer, same customer and retained previous purchase, funded
Free behavior, an actual lost accepted response, exact stored request/cursor
recovery, unchanged Pro/archive, minimized provider references and mobile
layout. Existing Checkout and renewal-cycle regression contracts remain.

This is not authentic Stripe-hosted/test-clock/payment evidence, approved
commercial/grace/refund/dispute policy, operated recovery or paid deletion.
Complete historical canonical reads still have their existing 48-request and
500-record bounds; history partitioning and staffed financial/privacy support
remain required. Do not prune retained financial/paid authority to bypass
those bounds. Vendor/merchant/legal approvals and live-mode launch remain gated.

Provider references:
[Checkout session creation](https://docs.stripe.com/api/checkout/sessions/create),
[subscription cancellation](https://docs.stripe.com/billing/subscriptions/cancel).
