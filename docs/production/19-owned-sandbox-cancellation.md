# 19 - Owned sandbox renewal cancellation

**Status: private test-mode engineering checkpoint, not live billing approval.**
This adds an owned, durable stop-renewal command to W08. It does not refund
payment, cancel immediately, edit prices/items, resume renewal, open a Portal,
issue a new paid interval or make account deletion production-safe.

## Release and authority

Apply controlled **migration 13** and maintained queue migration with
`npm run db:migrate` before starting this release. Published migrations 1-12 are
unchanged. Migration 13 adds `stripe_subscription_cancellations`: one immutable
intent per owned subscription, references to the customer, subscription ledger,
completed Checkout attempt and maintained operation, captured security epoch,
exact `sandbox-renewal-control-v1` policy, queued/confirmed state and coherent
confirmation time/result.

The maintained `billing.subscription.cancel` kind uses the existing singleton
queue, expiry, heartbeat, bounded retry, dead-letter and audited replay rules.
Startup rejects missing application/queue migrations. Drain incompatible old
binaries before promotion; rollback must preserve this authority and use a
compatible release. Do not remove cancellation rows, alter immutable operation
payloads, reset epochs or remove queues to downgrade.

Existing sandbox configuration remains required: managed verified accounts,
PostgreSQL, canonical HTTPS origin, own-account test credentials and the pinned
official Stripe SDK/API. Live keys and `APP_MODE=service` remain unavailable.
There is no new public purchase authority or operator flag. Removing
`STRIPE_TEST_OFFERS` stops new reservations, **not** owned cancellation,
notification ingestion or historical reconciliation.

Cancellation is independent of `STRIPE_TEST_ACCESS_POLICY`. Observation-only
mode can stop its owned test renewal without issuing grants. If the service
policy is enabled, its configuration continuity checks and source-scoped
authority remain mandatory.

## Owned request contract

```text
POST /api/billing/subscriptions/:id/cancel
Content-Type: application/json
X-CSRF-Token: current managed token

{}

202 { id: <owned cancellation UUID>, accepted: true }
```

`:id` is the opaque owned **subscription ledger UUID** returned by
`GET /api/billing`, never a Stripe subscription ID. The caller cannot select a
provider customer, Price, cancellation timestamp, immediate cancellation,
refund, arbitrary metadata or redirect. Nonempty bodies and provider IDs are
rejected.

The existing shared billing admission, recent authentication, verified active
account, CSRF and transactional security checks apply. Another owner receives
not-found, not a private financial descriptor. New requests require a fresh
complete owned customer ledger, with requested and reconciled revisions equal
and an observation less than five minutes old. A missing/dirty/stale ledger
requires an owned canonical refresh; cached browser claims are not sufficient.

The selected subscription must have its owned completed Checkout correlation.
Reservation locks owner/account, mapped customer, ledger and subscription before
creating the operation and intent atomically. Concurrent replica requests share
one intent, operation and native queued job. A duplicate unknown HTTP response
does not create a replacement key; an existing queued operation is reused.
Failed/missing/canceled operations and epoch-conflicting unknown outcomes require
operator reconciliation rather than silent replacement.

This narrow engineering surface is **not an unrestricted emergency cancellation
tool**. Missing correlations, unsupported provider configuration or an
unreconcilable ledger can hold it. Reliable operated recovery and staffed support
remain launch requirements; do not sell a promise that this private fixture
checkpoint cannot yet fulfill.

## Provider command and bounded replay

The immutable operation captures authority version, cancellation/customer/
subscription/Checkout identities, captured Price and account security epoch.
The customer resource and request digest bind it to the managed owner. SDK I/O
occurs outside SQL after durable admission.

The provider adapter performs at most **six SDK requests** per dispatch, with
maintained claim checkpoints and shutdown checks. A normal mutation uses five:
own account, owned customer, initial subscription, update, final subscription.
SDK retries remain disabled; application retry uses the original operation UUID
as the external idempotency key.

Before a write, canonical evidence must establish:

| Boundary | Requirement |
| --- | --- |
| Account/customer | Configured own account, test mode, undeleted customer and exact server-created customer metadata |
| Subscription | Exact captured subscription and customer, own customer/Checkout metadata, recognized lifecycle |
| Item/Price | Complete single quantity-one item with exact subscription and captured Price |
| Other control | No attached schedule or pending update; no custom `cancel_at` to overwrite |
| Local authority | Same mapped customer, completed Checkout, captured Price, current owner/epoch and native claim immediately before mutation |
| Deadline | Original operation age is nonnegative and strictly less than 20 hours; replay does not renew that window |

The write's heartbeat/checkpoint runs **before** the last local authority and
deadline check. A heartbeat cannot follow an earlier owner check and lend a new
lease to a prepared mutation whose security proof has since changed.

The only SDK update is:

```text
subscriptions.update(capturedSubscription, {
  cancel_at_period_end: true,
  proration_behavior: "none"
}, { idempotencyKey: originalOperationId })
```

New writes support active/past-due/unpaid/paused owned subscriptions. Trials,
incomplete subscriptions, missing control fields, paginated/multiple items,
foreign references, schedules, pending changes and custom cancellation times
fail explicitly; unsupported configuration is not overwritten by a default.
There are no invoice/payment/refund/credit mutations.

If canonical state is already nonrenewing or ended, dispatch is read-only. That
also permits recovery **after** the 20-hour mutation window when an earlier
provider write succeeded but local publication failed. Beyond that window, a
still-renewing subscription does not receive another POST.

The final canonical subscription must independently confirm the desired state:
`nonrenewing` or `ended`. A cached idempotent POST response alone is insufficient.
Late flag reversal, foreign scope, schedule or pending-update movement, outage
and cancellation failure leave publication incomplete. Confirmation records
observed current state, not proof that this operation caused every external
change.

## Atomic confirmation, access and history

After SDK reads, the adapter reacquires and revalidates owner, customer,
subscription/Checkout/Price, epoch and intent ownership. Under the maintained
completion fence, it commits together:

1. Canonical cancellation result and confirmation timestamp.
2. A dirty owned ledger revision and its maintained snapshot handoff.
3. The minimized `sandbox-renewal-control-v1` receipt and native job completion.

Lease expiry, security movement, deletion or actual SQL failure rolls all those
writes back. External success can still exist; that is an **unknown local
publication**, not permission to create a new cancellation, pretend no mutation
happened or reset its deadline.

Stopping renewal never extends or edits a grant, retires an invoice source,
refunds money or deletes owned work. The ordinary ledger read may replay the
same immutable eligible service proof, but the paid interval/audit remains
unchanged. Database-clock expiry and existing refund/dispute/credit/account
policy still determine current access. Independent support/promotion sources
remain outside this command.

The confirmed row is retained history. A later external renewal-flag change is
not silently overridden, interpreted as app-authorized resumption or converted
into another intent. The owned UI displays the earlier confirmation separately
from current canonical status and requests operator review when they disagree.
A future resume/cancel cycle needs its own explicit versioned command design;
this checkpoint deliberately has one cancellation intent per subscription.

Deleting an owner retires its existing customer correlation and fences further
user-principal dispatch/publication. It does **not** guarantee future billing is
stopped if the queued command never reached the provider. W10 paid deletion must
compose a separately authorized durable cancellation/recovery interface before
retiring authority; this endpoint is not that completed integration.

## Owned UI and maintenance

The existing private `/billing` page offers **Stop sandbox renewal** for
supported observed subscriptions, with inline consequences rather than a modal
or a hidden support-only path. Fresh proof and a current ledger are required.
Queued is explicitly not confirmation. Bounded polling observes the cancellation
operation and subsequent dirty ledger, then displays canonical nonrenewing
status and the retained confirmation.

Each owned subscription descriptor has nullable cancellation evidence:

```text
{
  id, policy: "sandbox-renewal-control-v1",
  state: queued | confirmed, processing,
  confirmedAt, result: nonrenewing | ended | null
}
```

Provider IDs, correlations, security epoch, immutable payloads and contact
details are not returned. The item period end remains a billing observation;
eligible invoice service ends and current entitlement decisions remain separate.
Failed status, stale data, unknown HTTP outcome and provider/receipt disagreement
are visible. No optimistic Free/Pro change is inferred from clicking the button.

The compiled `billing:worker` and `billing:reconcile` composition claims the new
kind alongside owned Checkout, notification and ledger work. `reconcile` still
fails nonzero for any incomplete billing operation. Use private `jobs:status`
and audited `jobs:replay` only after checking original ownership, current provider
state, security epoch and remaining mutation window. Replay never bypasses
those checks; security-invalid unknown outcomes require a future authorized
read-only recovery path, not ad hoc database repairs.

## Evidence and remaining work

The dedicated cancellation suite uses PostgreSQL replicas, real HTTPS managed
session/CSRF admission, maintained queues and the official SDK against a
synthetic loopback provider. It covers concurrent initial deduplication, strict
owned input, fresh/dirty ledger rules, default-off access, withdrawn offers,
scoped provider validation, exact five-request normal dispatch, read-only
already-stopped/late recovery, final stale flag rejection, moved local mappings/
Prices, security changes including the write-heartbeat boundary, retained deletion
fencing and compiled maintenance.

Nontransactional sequence witnesses prove reservation/confirmation SQL actually
executed before admission or native-expiry rollback. The service case verifies
unchanged grants/audits/funding, retained mock history and continued premium
content admission through the original paid interval.

The actual Chromium journey submits a real cancellation, drops its HTTP response,
retries without creating a replacement intent, observes queued versus verified
state and the refreshed canonical renewal flag, and retains Pro. It also checks
CSRF, minimized UI data and mobile layout.

Restricted Portal, resumption/recheckout, account-deletion composition, authentic
provider/test-clock evidence, approved commercial/grace/refund rules, partitioned
history, finance/privacy/support authority and operated recovery remain W08/W10
work. Public accounts, real payments and launch remain gated. No real provider
accounts, cards, charges or customer data were used.
