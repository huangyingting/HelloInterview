# 14 - Sandbox billing notification foundation

**Status: first W08 engineering checkpoint, not a payment integration or launch
approval.** This document covers authenticated sandbox notifications and
read-only canonical reconciliation. The later
[owned checkout checkpoint](15-owned-sandbox-checkout.md) adds customer and
hosted test-session creation in separate owned workflows. The notification
processor itself cannot create payments or issue/revoke entitlements. The later
[canonical ledger checkpoint](16-canonical-sandbox-ledger.md) records owned
subscription/invoice/line/payment-reference observations, not attested payments.
There is still no Portal, refund workflow or production commerce.

## Versions and configuration

The official `stripe` Node SDK is pinned to **23.0.0**, with API
**`2026-09-30.endive`**. Its generated types and implementation were checked,
including own-account retrieval, invoice parent/subscription references, and
the absence of a `livemode` field on refunds. This checkpoint supports v1
snapshot events, not v2 thin events, Connect, organization contexts or arbitrary
older event schemas. An SDK/API mismatch fails rather than guessing fields.

Configuration is optional, immutable and all-or-nothing:

| Private setting | Requirement |
| --- | --- |
| `STRIPE_TEST_ACCOUNT_ID` | Explicit own-account `acct_` identifier |
| `STRIPE_TEST_SECRET_KEY` | `rk_test_` or `sk_test_` key; live keys are refused |
| `STRIPE_TEST_WEBHOOK_SECRET` | Signing secret for the own-account snapshot destination |

Managed identity, PostgreSQL and a canonical HTTPS origin are prerequisites.
Unknown `STRIPE_` settings are refused. There is no configurable provider proxy,
live-mode switch, commercially approved offer or public issuing endpoint.
The optional `STRIPE_TEST_OFFERS` and worker mutation permissions belong to the
separate owned checkpoint. Prefer a restricted
test key granting only the account/event/object reads used by this processor. No secrets,
provider account or webhook destination were provisioned by this change.

Migration 8 introduced this boundary. The current canonical-ledger release
requires **migration 10** plus maintained queue migration before replicas.
Startup never migrates; published migrations 1-9 are unchanged. Stored notification
evidence makes removal of billing configuration or changing its provider account
a startup error; restoration requires the matching configuration, not demo
commerce or a silently disabled processor.
The first accepted event atomically binds a singleton reference account;
concurrently opened producers cannot race first acceptance into different
accounts. The reference binding is evidence scope, not a member/customer mapping.

## Raw ingestion and durable acceptance

`POST /api/webhooks/stripe` is registered before `express.json()` and before
managed browser session/CSRF middleware. Canonical-origin, drain and private
request-telemetry controls still apply. No cookie or member CSRF token is needed
for the webhook; other browser mutations retain their existing protections.

The raw request is limited to 256 KiB. Compression is refused. The official
SDK verifies the exact bytes and signing header with a 300-second tolerance;
the application also refuses future-dated or multiple timestamp values.
Authenticated envelopes must match sandbox mode, the pinned snapshot API and
the expected object family. Connected-account/organization events are refused.
JSON depth/node/prototype limits remain enforced by the shared job codec.

In one PostgreSQL transaction, acceptance commits:

1. An immutable system-principal durable operation with a stable event key.
2. The existing verified inbox and maintained queue outbox.
3. A `stripe_event_notifications` record with a minimized notification.

Only then does the endpoint return `200 { accepted: true, duplicate: false }`.
An identical replay, including JSON whitespace/key-order changes, returns the
duplicate response. Changed immutable event evidence conflicts. SQL/storage
failure returns a retriable non-2xx response and rolls back all three surfaces.
Acknowledgement means **notification accepted**, never payment processed.

The own-account signing secret is the destination binding for direct events,
which do not themselves carry an account ID. This is not claimed as independent
cryptographic proof of the configured account ID. Before canonical observation,
the processor retrieves the authenticated SDK account and verifies that ID.
Approved destination/key/account binding and rotation still require an operated
sandbox rehearsal.

## Evidence and privacy boundary

The inbox/job/notification retain only account/event/object references, event
type, API/mode, event creation time, classification and a canonical snapshot
fingerprint. Delivery counters are not immutable event identity. The full
webhook object, email, metadata, addresses, payment-method fields, signing
header, keys and provider tokens are not persisted or logged.

Migration 8 does not attach evidence to a member. Email and arbitrary provider
metadata cannot establish ownership. There is no customer mapping or member
billing DTO in migration 8; migration 9 adds those separate owned surfaces.
Notification financial references remain private operational data.
Financial/privacy retention and
deletion rules must be approved before real-customer use; no scheduled cleanup
silently removes unresolved evidence.

## Read-only canonical processing

Supported notifications cover Checkout completion/async outcome/expiry,
subscription creation/update/deletion, invoice paid/failure/action/finalization
failure, charge refunds, refund creation/update/failure and dispute
creation/update/closure. Unknown valid snapshot types are durably classified,
completed as `ignored`, and emit a payload-free unsupported-type diagnostic.

For a supported notification, the worker:

1. Retrieves its own authenticated account and verifies the configured ID.
2. Retrieves the immutable event and verifies its minimized identity and
   object fingerprint against accepted evidence.
3. Retrieves the current billing object using the official typed SDK.
4. Checks object ID/type and sandbox mode. Refund/dispute charge references,
   when present, are fetched and checked; conflicting customer references fail.
5. Projects only bounded references, status, currency, amounts and a paid hint.
6. Publishes that observation, receipt and maintained queue completion in one
   short transaction under the current claim/generation.

Provider reads occur outside the publication transaction. Request timeouts are
bounded and SDK automatic retries are disabled; the maintained queue owns
retries. Shutdown is checked around reads. Missing objects, permission failures,
outages, mismatched event/account/object/mode and lost claims never become
successful or deleted financial facts.

These are **per-notification observations**, not a customer ledger, ordered
projection or entitlement authority. Events for one customer may observe
different instants, and no `event.created` ordering resolves that. Jobs are
keyed per event at this stage. The later canonical ledger establishes owned
mappings and dirty-revision-fenced customer observations, not commercial write
authority. A signed `invoice.paid`, current `active` status,
nonzero amount, zero-dollar invoice, Checkout return URL or this observation's
`paid` hint is not sufficient proof of an eligible paid service interval.

## Worker operation

The web process is a producer only. Operate the compiled worker separately:

```bash
npm run billing:worker
```

A bounded pass processes available accepted notifications:

```bash
npm run billing:reconcile
```

It exits nonzero if deferred, active or failed billing operations remain.
Successful output explicitly identifies `notification-evidence-only` authority.
The newer worker also processes owned customer/session intents, bounded open
session sweeps and canonical owned ledger reads/repair sweeps. Combined output
can identify `sandbox-ledger-observation-only`; payment/service-period attestation
remains separate work. It exits explicitly on processing failure; supervising it,
backoff/restarts and alerting remain operator responsibilities.

Existing `jobs:status` and audited `jobs:replay` expose maintained queue state
and terminal replay. Do not manipulate private SDK objects or database rows as
an alternative grant/refund workflow. The inbox/operation ID remains stable
across retries and replay generations. Establish alert owners for pending age,
failed/dead-letter operations, unsupported types and provider permission/API
drift before operating an approved sandbox.

## Verification and remaining W08 work

The automated contract suite uses synthetic HTTPS application replicas, actual
PostgreSQL/maintained queues, official SDK signatures and a loopback HTTP
provider fixture. It verifies exact raw bytes, replay/conflicts, mode/schema/
context rejection, input limits, unchanged browser CSRF, actual SQL acceptance
rollback, every supported object family, current-versus-event status, minimized
storage, provider failures and actual publication rollback across claim expiry.
Compiled maintenance tests exercise active-backlog failure and reconciliation.
Runtime-only release coverage loads the compiled billing entry with the official
production dependency and no development tooling.

No real Stripe account, card, payment, refund, tenant or customer was involved.
The remaining implementation order is:

1. Extend the shipped canonical subscription/invoice/payment-reference
   observations with complete payment/charge/refund/dispute attestation.
2. Restricted Portal and security-invalid unknown-outcome recovery, with
   operated lifecycle evidence rather than only synthetic SDK fixtures.
3. Verified invoice/payment/service-period ledger and atomic W06 source grants,
   terminal refund revocations, scoped dispute holds and approved fixed grace.
4. Missing-event sweeps/drift repair, notification deduplication, operated
   sandbox lifecycle/crash/recovery/browser evidence and financial retention.
5. Approved vendor/merchant/market/price/tax/refund/privacy decisions, staff/
   support authority and explicit live launch approval.

Sources: [official SDK v23.0.0](https://github.com/stripe/stripe-node/tree/v23.0.0),
[pinned API declaration](https://github.com/stripe/stripe-node/blob/v23.0.0/src/apiVersion.ts),
[Stripe webhook guidance](https://docs.stripe.com/webhooks),
[own-account retrieval](https://docs.stripe.com/api/accounts/retrieve),
[invoice object](https://docs.stripe.com/api/invoices/object), and
[refund object](https://docs.stripe.com/api/refunds/object). Refer to
[the complete billing specification](04-billing-and-entitlements.md) for the
future commercial lifecycle; this checkpoint does not satisfy those launch gates.
