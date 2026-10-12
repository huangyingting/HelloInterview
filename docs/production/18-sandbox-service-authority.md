# 18 - Versioned sandbox service authority

**Status: default-off private engineering checkpoint, not commercial approval.**
This extends W08's owned Checkout, canonical ledger and card-funding evidence
with a trusted W06 issuing/revoking adapter. It permits synthetic test-service
access only when an operator explicitly selects the versioned policy. It does
not enable live keys, real purchases, external AI, Portal, staff grant tools,
public accounts or `APP_MODE=service`.

## Configuration and controlled rollout

Keep the existing managed identity, PostgreSQL, HTTPS, own-account Stripe test
keys and notification configuration. Without the following setting, billing
remains observation-only: even completed sessions and settled invoices issue no
grants, revocations or service-evidence rows.

```dotenv
STRIPE_TEST_ACCESS_POLICY=sandbox-card-service-v1
```

Only that exact value is accepted. Empty values, booleans, entitlement policy
names, live settings and unknown versions are configuration errors. This is a
sandbox evidence policy, distinct from the `pro-v1` capability policy it issues.
The existing test monthly/annual offer mapping remains an explicit operator
configuration, not an approved commercial price list.

Apply controlled **migration 12** with `npm run db:migrate` before starting this
release; published migrations 1-11 remain unchanged. It adds
`stripe_invoice_service_evidence`, uniquely scoped to the owned account/invoice
and source key, with an owned customer reference, revision, exact policy version
and a bounded 8 KiB payload. The strict payload carries state, immutable interval,
proof fingerprint and minimized service-review reasons, not a second mutable
subscription entitlement.

Drain old binaries before enabling the policy. Compatible replicas must use the
same account and policy version. Once any service evidence exists, including a
held evaluation, startup rejects removing the policy or changing its account.
Compatible replicas also recheck continuity under owner/customer locks, during
publication and owned ledger reads: a replica opened before opt-in cannot keep
silently publishing observation-only results after service authority appears.
This is not a claim that older released binaries have those new checks.

Removing `STRIPE_TEST_OFFERS` stops new Checkout reservations while preserving
historical offer/quote reconciliation and reversal handling. It does **not**
disable the service policy or invalidate previously captured offers. Restore a
compatible release with the same authority settings if application rollback is
needed; do not delete grants, tombstones or service evidence, change migration
checksums, or downgrade to a binary that cannot preserve authority. A destructive
restore is not an ordinary rollout fallback and requires an approved recovery
procedure.

## Eligible service evidence

`server/billing/service-policy.ts` evaluates normalized canonical facts, never
browser parameters, return URLs, notification status, email or current mutable
offer settings. New issuance requires every condition below.

| Boundary | Required evidence |
| --- | --- |
| Ownership | Mapped managed owner/customer, completed owned Checkout attempt, and exact subscription/attempt correlation |
| Subscription | One quantity-one item, supported already-paid lifecycle, no item/subscription review hold; no trial or incomplete subscription |
| Captured quote | Checkout's captured USD Price, monthly/annual offer and positive unit amount; exact item/line/invoice agreement |
| Invoice | Paid, positive total, no remaining amount, paid timestamp, `subscription_create` or `subscription_cycle`, and `charge_automatically` |
| Funding | Shared narrow card predicate: one paid invoice allocation, one succeeded PaymentIntent, one linked succeeded captured card charge, exact currency/amount/allocation/latest-charge relationships |
| Service line | Exactly one nonprorated quantity-one line with exact subscription-item, Price, currency and amount |
| Calendar | Supported original UTC anchor, no custom anchor configuration, finite calendar interval, and latest invoice/item period agreement |
| Review | No conflicting invoice holds, duplicate live subscriptions, unresolved financial target, pending refund or other unsupported service evidence |

A persisted `settled` label alone is insufficient: the adapter rechecks the
underlying funding relationships. A pending or requires-action refund prevents
new issuance. Ineligible evidence is explicitly **held** with reasons; it is
not replaced by a permissive duration, a current catalog price or a Pro default.
Legacy missing anchor, billing reason, collection method or item ID remains
unknown and held until a complete canonical read establishes it.

Already-paid intervals can remain eligible when a subscription becomes
nonrenewing, canceled, past due, unpaid or paused. Those labels do not extend
access, promise a new renewal, create a trial or establish a grace period. A
historical invoice can have a different interval from the subscription's current
item; the latest invoice must agree with that item.

### Calendar and exclusive interval

The pinned SDK documents invoice-line endpoints as inclusive. Canonical line
facts preserve those seconds unchanged. This explicit sandbox policy translates
the interval to half-open milliseconds:

```text
startsAt = line.periodStart * 1000
endsAt   = (line.periodEnd + 1) * 1000
startsAt <= databaseNow < endsAt
```

The calendar end must equal the next UTC month/year boundary under the original
billing anchor's day and time. Month-end clamping preserves that original day:
January 31 -> February 28 -> March 31, not March 28. Leap annual anchors similarly
return to February 29 when possible. Custom anchor settings, unexplained period
movement, arbitrary fixed-day durations and intervals over 400 days are held.
The latest subscription item's reported end must equal the translated exclusive
end; disagreement is not rounded into success.

These SDK-contract and synthetic-fixture checks are **not authentic operated
provider verification**. Capture actual test-account line/item boundaries,
renewals, leap/month-end anchors and late-payment behavior before approving any
production interval policy. If actual provider semantics disagree, design a new
version with explicit compatibility rather than silently modifying existing
authority.

## Immutable source adapter and transaction

`server/billing/service.ts` calls the existing internal `Entitlements` domain,
not an HTTP grant endpoint. Each invoice has a stable billing source:

```text
stripe-test-v1:<sha256(accountId + ":" + invoiceId)>
```

The immutable proof fingerprints policy, invoice, subscription, Checkout,
captured offer/Price, line/item, currency/amount, paid time, service interval and
funding intent/charge IDs. Those private identities and the proof are not exposed
through the owned billing DTO. Exact replay preserves grant ID, request hash and
first audit; changing an already-issued proof or interval is a terminal
reconciliation failure, never an in-place extension. Independently verified
renewal invoices get independent sources.

Canonical service publication runs inside the existing owner/customer,
ledger-revision and maintained-claim fencing. Financial rows/links, service
evidence, grant or revocation, audit, snapshot, receipt and queue completion
commit together or roll back. SDK I/O remains outside SQL. Policy-enabled reads
add complete final line and subscription/item rereads to existing final invoice,
PaymentIntent, allocation and charge guards. The exact 48 SDK-request, page,
object, payload and lease bounds remain; exceeding them requires reconciliation,
not truncated success.

A known dirty revision whose provider consistency read fails can finish as
explicitly superseded and enqueue the latest generation. A genuine
non-superseded inconsistency still fails. No stale generation publishes grants.
Foreign source owners/tombstones, retired owners, deletion during publication
and expired native claims cannot lend authority or commit a partial result.
Suspension/contact restrictions continue to override all grants.

## Strict sandbox reversal policy

This intentionally conservative policy is an engineering rehearsal, **not**
approval of the commercial refund/dispute design in document 04.

| Canonical fact | Sandbox source behavior |
| --- | --- |
| Successful positive partial or full refund | Terminally revoke only that invoice source |
| Any dispute history, including later won/closed | Terminally revoke only that invoice source |
| Issued credit adjustment | Terminally revoke only that invoice source |
| Pending/requires-action refund | Hold new issuance; do not retire an already-funded grant |
| Failed/canceled refund | Retain evidence; it does not count as a succeeded refund |
| Dispute won or credit voided after retirement | Preserve terminal tombstone; never restore that source |
| Adjustment before initial issuance | Record a terminal source tombstone without needing a grant |
| Natural exclusive expiry | Stop new paid work under database-clock policy; retain grant/audit and owned archives |

Reversals precede eligibility so an unsupported line cannot hide a canonical
adjustment. Other invoice sources, independent support/promotion grants and
owned saved work are untouched. Unsupported later observations preserve
previously issued immutable evidence with visible review reasons rather than
inventing a new interval. Refund/dispute/credit scope and terminal-history
guards from document 17 remain in force.

No grace, prorated partial-refund preservation, risk restoration, tax adjustment,
account-wide billing suspension or manual credit authority is inferred. Those
require approved commercial policy and separate versioned implementation.

## Owned API, UI and maintenance

Existing authenticated owned endpoints remain the interface:
`GET /api/billing`, `POST /api/billing/reconcile` and owned Checkout refresh.
No caller selects a provider customer, invoice, source, amount or interval.
`accessAuthority` distinguishes `none` from `sandbox-card-service-v1`; ledger
authority similarly distinguishes observation-only from the sandbox policy.
Each retained invoice has nullable service evidence:

```text
{ policy, state: held | granted | revoked, startsAt, endsAt, reviewReasons }
```

A historical **granted** label is source history, not current Pro authority:
scheduled/expired/revoked grants and account restrictions are evaluated by the
existing current entitlement service. Default-mode UI continues to say no paid
access; opt-in UI labels expiring test access and terminal adjustments explicitly.

After a new ledger observation, the billing screen refreshes shared bootstrap
permissions before displaying the new result. It waits out any pre-observation
in-flight bootstrap and requests fresh permissions rather than treating a stale
Free/Pro response as the new observation. Refresh failures remain visible.
Server authorization is independent of these hints; premium APIs deny new work
immediately after retirement, while owned archives remain readable/exportable.
There is still no arbitrary revocation push channel for another idle page.

`npm run billing:reconcile` and `npm run billing:worker` use the compiled maintained
queue composition. Completed ledger receipts and reconciliation diagnostics
identify the selected sandbox policy when applicable. Commercial review holds
remain explicit, including `commercial-policy-pending`; sandbox access is not
evidence that live eligibility or operating policy was approved.

## Evidence and remaining boundary

`npm run test:billing` includes the dedicated service suite against an isolated
PostgreSQL fixture and official-SDK loopback server. It covers default-off
behavior, monthly/annual ownership and replay, unsupported/corrected evidence,
immutable period/proof movement, scoped reversals and pre-issuance tombstones,
renewal/promotion independence, running-replica configuration drift, restrictions,
real exclusive expiry, dirty-generation convergence and compiled maintenance.
Native lease/deletion tests use nontransactional sequence witnesses to prove
actual service/grant/audit SQL ran before all publication writes rolled back.

The actual HTTPS Chromium journey holds a real pre-grant bootstrap response,
publishes eligible service, releases the stale response and verifies Pro without
a reload. It then reconciles a partial refund and observes Free. The backend
route case additionally verifies denied new premium content/mock admission and
retains the owner's existing mock archive. Existing observation-only billing
journeys remain separate regression cases.

The subsequent [owned cancellation checkpoint](19-owned-sandbox-cancellation.md)
adds durable sandbox stop-renewal requests without shortening existing paid
intervals or revoking their source.

Next W08 boundaries are authentic provider lifecycle/period evidence, approved
commercial/grace/refund/dispute policy, restricted Portal/resumption, partitioned
history, retained financial privacy/support and operated recovery. W09 AI
reservations/budgets, W10 staff/privacy controls, W12 reviewed offers/content and
W13 operated launch evidence remain required. No real provider accounts, cards,
charges or customer data were used.
