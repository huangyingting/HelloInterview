# 04 - Billing, payments, subscriptions and entitlements

**Status: proposed feature specification.** Addresses GAP-03 through GAP-05.
This is a direct subscription business, not a marketplace or stored-value
wallet. No application endpoint should ever receive a PAN or card security code.
The [first W08 implementation checkpoint](14-billing-implementation.md) ships
the signed sandbox notification/read-only evidence boundary. The
[second checkpoint](15-owned-sandbox-checkout.md) adds durable owned customer
and hosted test-session intents, stable idempotency and a fresh authenticated
sandbox UI. The [third checkpoint](16-canonical-sandbox-ledger.md) adds owned
canonical subscription/invoice/service-line/payment-reference observations,
dirty-revision fencing and retained history, explicitly without payment
attestation. The [fourth checkpoint](17-sandbox-payment-evidence.md) adds narrow
canonical card funding, complete allocations and historical refund/dispute/
credit-note traces, without service-period or commercial authority. The
[fifth checkpoint](18-sandbox-service-authority.md) adds explicit default-off
sandbox calendar eligibility and immutable invoice-scoped issuing/revoking
adapters. Its deliberately strict partial-refund/dispute/credit retirement
policy is not approval or implementation of the commercial policies below.
The [sixth checkpoint](19-owned-sandbox-cancellation.md) adds owned durable
sandbox stop-renewal requests and canonical confirmation without a refund or
immediate access loss. The [seventh checkpoint](20-restricted-sandbox-portal.md)
adds default-off restricted test Portal sessions for owned card-method updates
and invoice history, without plan/cancel/profile/login-page features or payment/
access authority. The [eighth checkpoint](21-owned-sandbox-renewal-cycles.md)
adds acknowledged same-offer sandbox resumption and immutable repeat stop/resume
cycles with exact predecessor replay guards and unchanged paid intervals.
Ended-subscription recheckout, paid deletion and authentic recovery remain unresolved.
Live payment-derived entitlements and the operated financial lifecycle
remain unimplemented; this specification is not launch authorization.

## Launch offer and boundaries

| Offer | Billing | Access |
| --- | --- | --- |
| Free | No payment method required | Free content, ordinary practice and own saved-data access |
| Pro monthly | Recurring monthly provider price | Same Pro capabilities as annual; bounded AI allowance |
| Pro annual | One annual recurring payment | Same capabilities; AI allowance replenishes monthly, not one annual pool |

Production prices, supported currency, tax presentation, eligible countries,
refund policy and terms require approval. The current `$19/$79/$199` values are
illustrative demo copy, **not approved production prices**.

No lifetime sales, free trials, coupons, upgrades with proration, metered cash
overages, multi-seat plans or gift purchases at launch. Do not quietly convert
local lifetime/demo access into an irrevocable commercial promise. Show
recurrence, total due, taxes, renewal date and cancellation terms before purchase.

Use Stripe Checkout for hosted purchase and Customer Portal for payment-method
updates, invoice access and cancel-at-period-end. Enable only portal operations
the backend lifecycle supports. Launch with interval switching disabled;
changing monthly/annual cadence at the next renewal is a later, explicitly
tested subscription-schedule feature, not a second concurrent checkout.
The shipped sandbox Portal deliberately disables provider-side cancellation;
stop-renewal uses the separately fenced owned app command. Hosted card updates
and returns do not prove an invoice was retried/settled. Enabling live Portal
operations requires separate lifecycle, provider and commercial approval.

## Domain responsibilities and invariants

**Billing** records commercial facts and coordinates provider operations.
**Entitlements** determine feature permission from verified grants and account
status. **Usage** controls consumption of scarce/paid resources. These are
different models, even if implemented in the same service/database.

Required invariants:

1. A checkout success URL never grants access. Only server-verified provider
   facts and explicit audited administrative grants do.
2. An application user has one production customer mapping per selected
   provider account and one primary nonterminal Pro subscription. Detect and
   resolve exceptions; never silently charge two subscriptions.
3. Every grant has a source, effective interval, policy version and optional
   revocation. An operator can explain exactly why access exists or ended.
4. Duplicate/replayed events and repeated requests do not create duplicate
   grants, refunds, quota windows or customer notifications.
5. Failed or incomplete first payment grants no paid access.
6. Cancellation at period end preserves already paid access until its exact
   UTC end. An expired window cannot be extended from client dates.
7. Archived user-owned work remains readable/exportable after subscription
   expiry, subject to account safety/deletion/retention policy.
8. Existing independent grants are not revoked merely because one unrelated
   billing source changes. An explicit account suspension can override all
   product access.
9. Paid annual renewal and monthly AI resets are different events; logging in,
   webhook replay, cancel/reactivate, or price changes cannot reset allowance.

## Customer journeys

### First purchase

1. A verified, active member selects a public plan key, for example
   `pro_monthly`. The API maps it to an allowlisted server-side Price ID.
   Ignore/reject client-supplied price, amount, entitlement, customer ID or
   success URL.
2. Create a `checkout_attempt` under a user-scoped idempotency key. Reuse or
   resolve an existing active checkout; serialize attempts per customer.
   Reject creation when the user already has a nonterminal subscription.
3. Create/reuse the provider customer and create the hosted session using
   stable provider idempotency keys. Store correlation IDs and the configured
   provider account/mode. Link metadata by internal IDs, not email matching.
4. Redirect to the hosted provider. Card entry, supported wallet options and
   required payment authentication occur there.
5. Return to an app confirmation page that reads the owner's checkout status.
   Display **Payment processing** until reconciliation establishes access.
   A query parameter such as `success=true` is never trusted.
6. Durable webhook processing or an authenticated bounded reconciliation
   confirms the subscription and paid invoice. Commit billing facts, grants
   and a notification outbox event in one transaction.
7. Show the plan, next renewal date, invoice link and available allowance.
   If the browser never returns, webhook processing still completes purchase.

Persist external-operation attempts before calling Stripe. If a process dies
after provider creation but before storing the response, retry/reconcile using
the same idempotency key and correlation IDs. Do not generate a fresh key on
every HTTP retry.

A unique local subscription row cannot by itself stop an old hosted checkout
from later completing. Expire superseded sessions through the provider, block
parallel attempts, and reconcile all customer subscriptions. If an unexpected
second subscription is paid, hold it out of normal entitlement calculation,
alert billing staff, and resolve/refund under policy rather than deleting
financial evidence.

### Renewal and payment recovery

Provider-side automatic collection owns charging and supported retry rules.
The application mirrors invoice/payment state and communicates accurately.
Do not implement a second independent charging retry loop.

On successful renewal, verify the paid service period and advance that source's
grant. If authentication is required, link the user to the provider's hosted
payment recovery. Payment failure messaging includes the affected invoice,
paid-access end and grace policy; no duplicate app/provider emails.

Proposed grace: after a **previously paid** renewal fails, allow up to 72 hours
of read-only access to formerly entitled content. No new premium sessions or
provider-funded AI during grace. Never extend grace repeatedly on each retry.
Anchor it to the first eligible failed renewal/paid-period boundary. Initial
payment failures get no grace.

This policy is an application decision, not an assumption that a Stripe status
encodes the correct customer experience.

### Cancellation, resumption and return

Cancel-at-period-end requires no support contact. The account page and portal
show the last paid-access instant and whether another charge is scheduled.
Record optional cancellation reasons without making them a barrier.

Resuming before period end clears the scheduled cancellation through the
provider; it does not create a new subscription or replenish quota. After a
subscription has ended, a new checkout creates a new paid interval, with
anti-abuse rules for overlapping allowance windows.

Account deletion requests cancel future billing immediately through a durable
operation. Whether remaining service is refunded is determined by the
published refund policy and applicable law, not inferred from deletion itself.

## Billing state versus access state

Store the provider status as received, but calculate access separately using
current canonical subscription/invoice facts and source revocations.

| Provider / business condition | Effective application behavior |
| --- | --- |
| Checkout open, expired or abandoned | No change to existing grants; no new paid access |
| `incomplete` or `incomplete_expired` first subscription | No Pro access; expose payment recovery where applicable |
| `active` plus verified eligible paid interval | Pro through `paid_until`; allow each feature within its quota |
| `active` with `cancel_at_period_end` | Same paid access until end; show nonrenewing status |
| `past_due` with still-valid paid interval | Honor remaining paid interval; explain renewal issue |
| `past_due` after paid interval, prior successful payment | Fixed read-only grace if eligible; no new premium work/AI |
| `unpaid`, ended `canceled`, or grace expired | No subscription-derived Pro grant; own archive/free features remain |
| `paused` | Do not extend paid access; honor any still-valid paid interval unless an explicit hold revokes it |
| `trialing` | Launch does not sell trials; no automatic paid grant, alert unexpected state; any future trial requires its own bounded policy |
| Full refund of current service interval | Revoke the refunded source interval when refund succeeds; cancel future renewal as the policy requires |
| Full refund of an older interval | Do not erase unrelated later paid access; reconcile the affected interval |
| Partial refund | Record amount/reason; normally preserve access unless a separately approved adjustment says otherwise |
| Disputed payment | Flag the implicated payment, stop granting unverified future service, apply a scoped risk hold per policy, and open billing review |
| Administrative courtesy grant | Explicit capabilities/expiry/reason; independent of subscription status |
| Account suspension/deletion | Account policy overrides product access and stops new billable work |

Zero-value invoices may be valid commercial facts only when produced by
approved provider configuration, such as authorized credits. Do not assume
`amount_paid > 0` is the only eligible case, or that an arbitrary zero-dollar
invoice authorizes a plan. Verify price, customer, currency, collection/payment
state, service interval and approved commercial policy.

## Webhook and reconciliation architecture

### Ingestion

Mount `POST /api/webhooks/stripe` before `express.json()`. Verify the signature
against the **raw request body** using the official SDK and the environment's
webhook secret, including its supported timestamp tolerance.

Verify expected provider account, test/live mode, known event schema/API version
and bounded payload size. Persist an inbox row with a unique
`(provider, account, livemode, event_id)` key and enqueue work transactionally.
Return `2xx` only after durable acceptance. A duplicate already durably accepted
event gets `2xx`; a database failure gets a retriable non-`2xx`.

The webhook is not a cookie-authenticated browser action. Do not require the
member's session/CSRF token, and do not weaken browser CSRF checks to admit it.
Invalid signatures are rejected without storing untrusted payloads as billing
facts. Keep webhook bodies out of ordinary logs.

### Processing and ordering

Events are **notifications**, not an ordered ledger. Stripe can deliver
duplicates, retries and out-of-order events. `event.created` is not a safe
universal version for every related subscription/invoice.

Serialize reconciliation per customer (including unexpected duplicate
subscriptions) using a leased job and a fencing generation. Fetch canonical
provider subscription/invoice/refund/dispute state outside the SQL transaction.
Then, in a short transaction, verify the worker still owns its generation and
apply the fetched snapshot, grants and outbox events together. A worker whose
lease was superseded must not write an older snapshot.

If facts arrive before a local mapping exists, retain and retry reconciliation
using persisted checkout correlation and verified provider IDs. Do not attach a
payment to an account merely because the invoice email matches.

A late `invoice.paid` for an old interval cannot resurrect a canceled/refunded
subscription. A subscription deletion cannot erase a valid unrelated courtesy
grant. Recompute affected source grants rather than setting `user.plan`.

### Events to cover

Use event names and object fields verified against the pinned Stripe API
version; below is the required conceptual coverage:

| Event family | Action |
| --- | --- |
| `checkout.session.completed` | Correlate and reconcile; not unconditional proof of settled payment |
| `checkout.session.async_payment_succeeded/failed` | Reconcile delayed methods if enabled; explicitly handle failure |
| `checkout.session.expired` | Close pending attempt; do not revoke unrelated existing access |
| `customer.subscription.created/updated/deleted` | Reconcile subscription, periods, cancellation and grant eligibility |
| `invoice.paid` | Verify and record eligible paid interval; idempotent entitlement update |
| `invoice.payment_failed/payment_action_required` | Record recovery state, fixed grace eligibility, deduplicated notifications |
| `invoice.finalization_failed` | Alert billing operations; surface location/tax/payment blockers appropriately |
| Refund lifecycle / `charge.refunded` | Reconcile actual refund status and affected service interval |
| Dispute creation/update/closure | Open case, apply/release scoped holds, follow finance process |
| Credit-note creation/update/void | Reconcile canonical invoice adjustment and approved eligibility policy; never equate a credit note with a succeeded cash refund |

Initially enable only payment methods whose lifecycle is covered. If a delayed
method is not ready, disable it in checkout rather than displaying instant
success. Unknown valid event types are recorded as intentionally ignored or
unsupported with telemetry; they must not crash all event processing.

### Repair and operations

- Reconcile stuck checkout/payment states every five minutes.
- Reconcile active/recently changed subscriptions at least daily, plus targeted
  reconciliation after customer-support actions.
- Alert when billing inbox age exceeds five minutes or repeated processing fails.
- Dead-letter after bounded retries with an operator-visible reason and safe
  replay command. Keep original IDs and audit replay.
- Reconciliation compares money/state/grants, produces drift records and repairs
  deterministic differences; ambiguous refunds or duplicate charges require
  billing review.
- During provider outage, honor locally verified paid intervals; do not extend
  them indefinitely or remove valid access simply because a fetch failed.

## Entitlement policy and API

Use explicit capability keys, for example:

```text
content.premium.read
practice.premium.create
mock.create
quiz.custom.create
plan.create
project.create
ai.feedback.consume
archive.own.read
archive.own.export
```

Each route checks account status, resource ownership, required capability,
source validity at server time and quota where applicable. Client bootstrap
capabilities are hints to explain the UI, not authorization evidence.

Historical reports are user-owned snapshots, not a way to request an entire
expired paid library. Preserve their originally included questions/feedback
under the declared archive license while denying fresh protected-content reads.

`GET /api/entitlements` returns effective capabilities, explanatory reason codes,
source expiry, limits/usage/reset date and billing-recovery state. Never return
raw private provider payloads. Apply grants consistently to course enrollment,
content/solutions/media, quizzes, tutor context retrieval, progress, ordinary
practice, all premium actions, background workers and exports.

Retire production `/api/plan`, its DELETE reset, and unrestricted `/api/gift`
creation/redemption. The production server must not even register demo routes.
Administrative adjustments use a separate role-checked, audited command with a
bounded grant, not the old demo API.

## Refunds, disputes, invoices and tax

Use the provider ledger as the financial authority; local tables support
reconciliation and customer experience, not bespoke accounting.

Refund operations have a reason, eligible invoice/payment, amount/currency,
approver and idempotency key. Support can request a refund; an authorized billing
operator approves/executes within policy. Track requested, pending, succeeded
and failed outcomes. Retry unknown outcomes by reconciliation, not blind
duplicate refund calls. Cancelling a subscription and refunding a charge are
separate provider operations with a durable, repairable workflow.

Provide provider-hosted invoices/receipts and payment-method management.
Only store minimal display data such as brand/last four digits if necessary;
never full card information. Account export includes customer-visible
transaction references without exposing internal fraud notes.

Before live mode, finance/legal must approve merchant eligibility, supported
countries, tax registrations, tax-inclusive/exclusive display, invoice fields,
refund/withdrawal rights, dispute evidence, charge descriptors and financial
retention. Stripe Tax automation does **not** establish tax registration or
remove merchant responsibility. Hosted checkout reduces card-handling scope
but does not by itself certify PCI or other compliance.

## Deferred gifts and promotions

Paid gifts should be a later one-time order flow, not a subscription belonging
to the recipient without consent. Design separately: paid order, hashed
high-entropy redemption code, duration/expiry, delivery schedule, recipient
verification, one atomic redemption, overlap/stacking policy, purchase/refund
linkage, and fraud limits.

A refunded or disputed unredeemed gift must not remain redeemable. A redeemed
gift refund needs an explicit recipient-access policy. Existing demo codes
cannot enter this ledger. Promotions/trials similarly require approved
eligibility, anti-abuse and usage policies before enabling provider switches.

## Acceptance scenarios

| ID | Observable outcome |
| --- | --- |
| BILL-01 | Successful first purchase grants access without requiring browser return; forged success URL or arbitrary price/customer ID never grants access |
| BILL-02 | Decline, abandoned checkout, 3DS/action-required, delayed success/failure and expired session produce correct non-success states |
| BILL-03 | Repeated checkout clicks/process restart reuse the operation; superseded sessions and unexpected duplicate subscriptions are detected/resolved |
| BILL-04 | Invalid signature is rejected; valid duplicate, reordered and replayed events produce one correct set of grants and notifications |
| BILL-05 | Renewal advances the correct interval; first-payment failure gets no grace; renewal grace expires exactly once and never enables new AI |
| BILL-06 | Cancel-at-end, resume-before-end and resubscribe-after-end preserve exact paid dates without duplicate charges or quota resets |
| BILL-07 | Partial/current-period/old-period refunds and dispute closure change only appropriate grants; provider failure leaves a tracked repairable operation |
| BILL-08 | Annual subscribers get monthly allowance windows across month-end/leap-year boundaries; renewal/webhook replay never double-replenishes |
| BILL-09 | Ownership, suspension, expiry and revocation apply to all protected reads/writes and asynchronous result publication; archived owned work remains available |
| BILL-10 | Provider outage, DB failure before inbox commit, worker death, lease takeover and manual replay converge through reconciliation without stale writes |
| BILL-11 | Test/live customers, prices, webhook secrets and events cannot cross environments; live checkout fails closed on missing approved configuration |
| BILL-12 | Customer can view invoices, update payment method, cancel and request policy-based help without staff manually changing database fields |

## References

- [Stripe subscription webhooks and payment lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe webhook verification and delivery behavior](https://docs.stripe.com/webhooks)
- [Stripe subscriptions with Checkout](https://docs.stripe.com/payments/checkout/build-subscriptions)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management)

Pin stable SDK/API versions during implementation. Do not copy preview API
versions from documentation examples without a deliberate compatibility review.
