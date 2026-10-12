# 15 - Owned sandbox customer and hosted checkout

**Status: second W08 engineering checkpoint, private sandbox only.** This adds
durable, owned customer and hosted Checkout intents to the
[notification foundation](14-billing-implementation.md). It is not a payment
ledger, subscription-access adapter, Portal integration or live launch approval.
Managed `commerce` remains `disabled`; completed test sessions issue no grants
and never replace independent W06 access sources.

## Configuration and rollout

Use the existing own-account, test-only Stripe configuration with managed OIDC,
PostgreSQL and a canonical HTTPS public origin. The official SDK/API remain
pinned to `stripe@23.0.0` / `2026-09-30.endive`. No vendor account, product,
price, customer, card or charge was provisioned against a real provider.

An optional private setting enables **new** owned checkout reservations:

```text
STRIPE_TEST_OFFERS={"pro_monthly":"price_SyntheticMonthly","pro_annual":"price_SyntheticAnnual"}
```

These identifiers illustrate the strict format, not usable or approved offers.
Only those two distinct Price IDs are accepted. Operator configuration captures
the allowlist; a browser cannot choose a provider price, amount, customer,
metadata, trial, coupon, payment method or return destination.

The worker validates current own-account test-mode prices/products. New sessions
require active, positive fixed USD `per_unit` recurring licensed prices with
quantity one and month/year cadence, interval count one. The reference permits
only cards, no promotional codes or trials, and disables automatic tax/adaptive
pricing. These narrow sandbox assumptions are not commercial or tax decisions.
Existing correlated sessions can be recovered after price/product deactivation.

Apply controlled application **migration 9** and the maintained queue migration
with `npm run db:migrate` before deploying this binary. Startup never migrates.
Migrations 1-8 are unchanged. New queues are `billing-customer`,
`billing-checkout` and `billing-checkout-refresh`; existing queues are preserved.
Older binaries reject the new schema rather than silently serving it.

Keep the account/signature binding and appropriate restricted keys configured
once durable billing references exist. Key rotation must preserve the account.
Use distinct per-deployment restricted keys where supported: the web producer
does not need SDK mutation authority; the isolated worker needs the checked
reads and enabled customer/session creation. Removing `STRIPE_TEST_OFFERS`
disables **new reservations**, not already accepted immutable intents. It is
not cancellation or an emergency stop for external outcomes; drain/stop workers
and reconcile those outcomes explicitly.

## Owned records and authorization

`stripe_owned_customers` reserves a random permanent correlation for the
configured account/member. Only that server-reserved UUID is sent as customer
metadata (`studio_customer_ref`); email, contact data and user IDs are not sent.
The local owned reservation and canonical SDK response establish the mapping,
not arbitrary metadata or matching email addresses.

`stripe_checkout_attempts` records the member's UUID request key, offer,
captured price, canonical origin, security epoch, fixed two-hour deadline,
creation/refresh operation references and minimized canonical session facts.
The private hosted URL is stored only for an open session and is never returned
in a status DTO, operation payload, receipt or log. Terminal sessions clear it.
The owned DTO includes the member's request key so the browser can distinguish
an expired known intent from a newer request with an unknown response.

Owner/account, customer, attempt and durable-operation locks follow a consistent
order. Reservation atomically commits the singleton account binding, owned
customer reservation, creation operation/outbox and waiting checkout. The
customer's fenced publication maps its provider ID and enqueues the captured
checkout in the same transaction as its own completion. SQL failure rolls the
whole publication back, not just the visible status.

Admission requires an active verified managed owner, browser CSRF and hosted
proof within ten minutes. Proof is checked before and after actual mutations
under the owner lock. Thirty billing mutations per account per fifteen-minute
window are shared across replicas; denial includes `Retry-After`. Unknown
shapes and client-supplied provider authority are rejected explicitly.

Billable creation captures the security epoch. The worker verifies current
eligibility, immutable intent fields and the live claim before preparation,
immediately before a provider POST, and around actual SQL publication. Provider
I/O occurs outside SQL transactions; SDK requests have bounded timeouts and no
automatic network retries. Revocation/deletion during an already dispatched
request cannot recall a provider side effect. Its result stays unresolved and
must be reconciled; it is never published as authorized access.

Deletion retires both local surfaces, clears redirects and removes customer
ownership while retaining minimized financial correlations. Tombstones cannot
be assigned to another member. This is not provider customer deletion,
subscription cancellation or a complete privacy-request implementation.

## Idempotency and unknown outcomes

Customer/session POSTs use the immutable **durable operation UUID**, never the
queue job, retry count or replay generation. Captured parameters remain stable
after origin/offer configuration changes. A per-owner request replay returns
its original attempt; a changed offer conflicts. A unique partial index and
owner lock admit at most one unresolved checkout per customer.

Stripe may prune an idempotency result after at least twenty-four hours. The
reference uses a conservative **twenty-hour POST window**, checked again at
dispatch. Checkout also needs more than thirty-one minutes before its captured
deadline. Crossing either bound permits only read-only recovery, not a new key.

After that window, customer recovery searches the original UUID correlation.
Exactly one canonical result is required. Missing/eventually consistent,
paginated, deleted, foreign-mode/account or ambiguous results hold for operator
reconciliation. Not-found is never permission to create a replacement customer.

Checkout recovery first lists existing sessions for the owned customer and
looks for the original attempt. It recovers that session **before** rejecting
an existing nonterminal subscription, including when a lost creation response
was followed by successful completion. A missing/ambiguous/paginated result
outside the window holds. Before a new POST, any nonterminal subscription or
partial subscription list also holds.

Canonical sessions must match the fixed customer, attempt/reference metadata,
test mode, subscription/hosted mode, deadline and captured return/cancel URLs.
Expanded line items must identify exactly the captured price, quantity one and
USD. Redirects require exact `https://checkout.stripe.com/c/pay/`, no credentials
or control characters; opaque hosted fragments are preserved. The same
redirect validation is repeated when opening the persisted URL.

`complete`, `expired` and deletion retirement are terminal; a stale or
contradictory snapshot cannot reopen them. A complete session remains
**unresolved for another purchase** until the future subscription/invoice
lifecycle is implemented. Its payment-status display is not a paid interval.

## API and browser journey

| Endpoint | Contract |
| --- | --- |
| `GET /api/billing` | Active verified owner; minimized owned view, no redirects/provider customer IDs |
| `POST /api/billing/checkouts` | Fresh CSRF-protected proof; exactly `{ offer, key }`; durable reservation returns `202 { id }` |
| `POST /api/billing/checkouts/:id/open` | Fresh proof, owned ID and empty body; server-clock-open session returns its private hosted destination |
| `POST /api/billing/checkouts/:id/refresh` | Fresh proof, owned ID and empty body; enqueues a canonical read-only refresh |

Concurrent refreshes coalesce while a refresh is queued/active/retrying.
An explicit request after completion creates a new chained read operation;
it does not fabricate a fresh observation from the previous result. Shared
HTTP admission and bounded worker sweeps limit reads.

An optional safe bootstrap capability advertises sandbox availability separately
from disabled commerce. Account links to `/billing`; local/demo behavior is
unchanged. The dedicated page requires explicit sandbox acknowledgement, keeps
request UUID/offer in per-account session storage before admission, displays
inline errors and uses bounded status polling. Storage failure blocks creation;
it does not silently lose the retry key. An unknown request after an older
expired session still reuses its **new** saved UUID after reload.

Hosted return parameters only trigger an owned canonical refresh when matching
the already returned owned view and fresh proof. `paid`, `plan`, `cancelled` or
foreign attempt claims never create payment/access evidence. Completion says
explicitly that no entitlement was issued. A confirmed fresh account session
is needed to create, resume or manually refresh.

## Worker and operating boundary

`npm run billing:worker` runs separately from the web producer.
`npm run billing:reconcile` performs a bounded pass and fails nonzero for **any**
incomplete billing operation, including new customer/checkout kinds.
Correlation receipts/output identify `sandbox-correlation-only` authority.
Notification receipts retain `notification-evidence-only`.
The subsequent [canonical ledger checkpoint](16-canonical-sandbox-ledger.md)
adds a durable customer snapshot child to mapping and completed sessions;
combined maintenance can report `sandbox-ledger-observation-only`.

Once a minute, maintenance enqueues read-only refreshes for at most one hundred
eligible open mapped sessions, oldest observations first. It does not discover
missing invoices/subscriptions, resolve failed billable intents, cancel or
refund, operate a Portal, or prove launch-ready recovery. Supervision, private
diagnostics, permission/API drift alerts and failed/old-intent handling need
approved operators.

Use `jobs:status` and audited `jobs:replay`. Inspect the original account,
correlation, provider outcome, security epoch and deadline before replay.
Replay preserves the operation key; it does not renew the POST window, bypass
an epoch fence or authorize a replacement for a tombstone. Security-invalid
unknown outcomes require a later explicitly authorized read-only reconciliation
path, not manual changes to epochs, immutable payloads or owned mappings.

## Automated evidence and next dependencies

The contracts use actual PostgreSQL/maintained queues, HTTPS OIDC/session/CSRF
replicas and the official SDK against a synthetic loopback provider. They cover
concurrent reservations, key conflicts, strict authority rejection, fresh proof,
shared admission, SDK pagination/object/mode/cadence/line-item checks, independent
grants, immutable configuration capture and terminal status.

Sequence witnesses prove SQL execution before admission/security/lease failures
roll back actual reservation/publication and outboxes. A compiled worker is
killed after the synthetic provider creates its session; maintained expiry and
retry recover it without manually failing/replaying the claim and without a
second session. Lost customer responses reuse the original POST key; late
recovery performs reads only. Actual Chromium journeys check hosted resume,
forged returns, completion with no Pro, CSRF, responsive layout and retry-key
preservation after an expired session plus an unknown new response.

W08 remains in progress. Subsequent checkpoints add
[canonical ledger observations](16-canonical-sandbox-ledger.md),
[card-funding/adjustment evidence](17-sandbox-payment-evidence.md),
[default-off sandbox service grants](18-sandbox-service-authority.md) and
[owned sandbox stop-renewal commands](19-owned-sandbox-cancellation.md).
These are private engineering boundaries, not commercial approval.
Approved commercial/grace/refund/dispute rules, restricted Portal/resumption,
missing-event/drift sweeps and operated lifecycle recovery remain. Financial
retention, paid deletion/privacy/support authority, commercial/tax/vendor
decisions and explicit live/public launch approval remain gates.

Sources: [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests),
[hosted subscription Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions),
[customer search](https://docs.stripe.com/api/customers/search),
[Checkout session retrieval](https://docs.stripe.com/api/checkout/sessions/retrieve),
and [the pinned official SDK](https://github.com/stripe/stripe-node/tree/v23.0.0).
