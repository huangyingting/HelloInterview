# 16 - Canonical owned sandbox billing ledger

**Status: third W08 engineering checkpoint, observation-only.** This follows
[owned Checkout](15-owned-sandbox-checkout.md). It records owned subscription,
invoice, service-line and invoice-payment-reference observations using the
pinned official SDK. It is **not payment attestation, a financial book of
record, a billing entitlement adapter, cancellation or live commerce**.

## Deploy and operate

Apply **application migration 10 and the maintained queue migration** with the
controlled `db:migrate` command before starting this release. Published
migrations 1-9 are unchanged. No new environment variables or customer-facing
provider configuration are introduced. Existing own-account sandbox binding,
managed identity, canonical HTTPS origin and secret rules still apply.

The new singleton queue is `billing-customer-snapshot`, durable kind
`billing.customer.snapshot`. The compiled `billing:worker` and
`billing:reconcile` commands dispatch it after customer, Checkout, refresh and
notification work. A pass with any incomplete billing operation fails nonzero.
The worker scans at most 100 mapped customers once a minute, requesting reads
after five minutes or for unlinked observed events; pending/failed work is not
silently replaced. A one-shot pass performs its repair sweep only once, rather
than continuously adding its own next batch.
Successful canonical processing is not financial or entitlement approval.
Owned ledger output identifies `sandbox-ledger-observation-only`; receipts
contain counts/revision/review-required, not provider bodies. A pass reports
`billing.ledger.review-required` with a customer count when retained facts have
business holds. Diagnostics contain no provider customer IDs or private URLs.

An approved supervisor, private queue diagnostics, retention, alerting and
explicit operator replay are still required. Replay cannot remove a tombstone,
change a captured customer/account, or authorize a provider mutation. A failed,
cancelled or missing current read is not silently replaced by a browser refresh.

## Owned model

| Table | Responsibility |
| --- | --- |
| `stripe_customer_ledger_state` | Requested/reconciled safe-integer revisions, current operation pointer, last complete normalized snapshot and observation time |
| `stripe_ledger_notification_links` | Permanent verified account/event-to-owned-customer handoff and dirty revision |
| `stripe_owned_subscription_ledger` | Stable local opaque IDs, provider account/subscription uniqueness and latest normalized facts |
| `stripe_owned_invoice_ledger` | Stable local opaque IDs, provider account/invoice uniqueness, immutable creation time, latest normalized lines/payment references |
| `stripe_customer_ledger_snapshots` | Append-only application observations, operation/revision uniqueness and canonical fingerprint |

Owner/account -> mapped customer -> reconciliation state -> durable operation
is the publication lock order. SDK reads run outside SQL transactions. User
identity comes only from the previously reserved customer mapping; email,
invoice contact information, signed-event metadata and browser claims cannot
establish ownership.

Customer mapping and completed owned Checkout enqueue read work inside the
parent's fenced completion transaction. A canonical notification acquires the
mapped owner/customer locks before event completion and hands off to the
customer ledger atomically with its minimized observation. Unmapped events
remain durable. Mapping and repair sweeps link previously observed events using
the verified account/customer ID; they do not match by email.

Notifications increment a dirty revision while a read is pending. A stale
immutable operation completes explicitly as superseded and atomically queues
the newest requested revision, without publishing its old snapshot. It does
not endlessly retry that obsolete revision. Fresh user reads coalesce only
while created/active/retrying. Completed reads allow a new request.

Mapped suspended owners can continue **system-authority financial reads**;
that does not restore account sessions, product permissions or grants. Owner
deletion retires the mapping and fences publication, including a final check
inside actual completion SQL. Existing minimized financial observations remain
unowned retained records; this is not an approved retention/deletion policy or
provider cancellation workflow.

## Canonical read scope and limits

Every dispatch verifies the configured SDK/API account and canonical test-mode
customer metadata. It then reads all-status customer subscriptions, all items,
recent invoices and complete lines/payment-reference pages.

The invoice scope is **90 days by invoice creation time, plus explicit
targets**: subscription latest invoices and invoice IDs from linked canonical
notifications, including pre-mapping/older notifications. Known local and
Checkout subscription IDs absent from a list get explicit canonical retrieval.
Scope version is `recent-90-days-and-known-targets-v1`.

Absence from this window is **never deletion, cancellation, reversal or
nonpayment proof**. Old rows are retained. Retained invoice/subscription holds
remain visible even when no longer in the recent snapshot. Paid/void invoices
and canceled/incomplete-expired subscriptions cannot reopen from another
snapshot. Contradictory immutable ownership or invoice creation time blocks
publication.

Limits are intentionally explicit, not truncated success:

- At most **48 SDK requests**, including account/customer reads, per dispatch.
  The default official SDK request timeout is three seconds; automatic retries
  are off. A single reader cannot reserve unbounded API work.
- At most **five pages/500 objects** per collection. Empty continuation,
  repeated IDs/cursors, unknown schemas/modes, foreign references or budget
  exhaustion hold the operation without publishing partial facts.
- At most 500 captured Checkout intents, known subscriptions and explicit
  historical invoice targets. Larger histories need a future partitioned,
  resumable reader; operators must not delete evidence to bypass these limits.
- Snapshot payloads are at most 256 KiB, individual subscriptions 16 KiB and
  invoices 128 KiB. All integer amounts/revisions are range checked.

Each SDK request is preceded by a current generation/attempt/lease assertion,
a pinned pg-boss **attempt-fenced `touch`**, and another lease assertion.
Heartbeat refresh does not revive an expired claim or extend its absolute
five-minute expiry. Claim, ownership and revision are rechecked for publication;
records, immutable snapshot, latest state, receipt and queue completion commit
or roll back together.

The pinned API places current periods on **subscription items**, invoice
subscription ownership under `parent.subscription_details.subscription`, and
payment references under `InvoicePayment.payment`. Its official SDK returns
`quantity_decimal` as a branded Decimal object; normalization uses its lossless
string representation, not floating-point conversion. SDK line period ends
are preserved **inclusive** as reported. No entitlement interval is inferred.

## Financial holds, not grants

The normalized invoice contains amounts, currency, status/paid timestamp,
complete line IDs/prices/periods/quantities/proration, and invoice-payment
reference IDs/types/status/allocated-amount hints. Charge, PaymentIntent and
payment-record references are **not retrieved or attested by this reader**.
An invoice marked paid, zero-value invoice, external payment record, active
subscription, trial or metadata correlation cannot grant Pro.

Explicit holds include unexpected subscriptions/prices, incomplete owned
Checkout reconciliation, duplicate nonterminal subscriptions, unsupported
trials, uncorrelated invoices, adjustments and payment attestation pending.
Charge/refund/dispute notifications dirty the customer and record
`payment-lifecycle-unverified`; this checkpoint does not resolve those objects
to older invoices or evaluate their financial effect.

Every paid invoice/payment hint remains held for a later payment/service-period
attestor. Independent W06 support/promotion/engineering grants are untouched.
Commerce remains `disabled`; no billing grant is issued or revoked.

## HTTP and browser contract

`GET /api/billing` adds `ledger`, null before its state exists. An active
verified owner receives stable **local opaque record IDs**, status, cancellation
flag, reported single-item period end, invoice amounts/currency/paid timestamp,
observation time, queue status, stale flag and explicit holds. No provider IDs,
payment references, addresses, contact data, hosted invoice URLs, confirmation
secrets, raw metadata or raw SDK bodies are returned.

History displays at most 20 subscriptions and 20 invoices; `historyTruncated`
explicitly marks additional retained records. Invoice amounts are labelled in
currency minor units, not assumed to be dollars or cents. Unsuccessful/new/
older observations are labelled stale or incomplete rather than presented as
new payment confirmation.

`POST /api/billing/reconcile` accepts **exactly an empty JSON object**, returns
`202 { accepted: true }`, and resolves the customer from the authenticated
owner. Existing browser CSRF, ten-minute hosted proof and shared account billing
admission apply. There is no client-selected customer, invoice, time window,
price, amount, account, mode or authority.

The private billing page displays this separate canonical ledger, inline review
states and a fresh-proof refresh action. Polling remains bounded. Neither
subscription active/canceled nor invoice paid alters the product access badge.

## Evidence and remaining work

PostgreSQL, maintained queues, HTTPS owner/CSRF flows and official-SDK synthetic
loopback fixtures cover complete pagination, the exact 48-read threshold,
foreign/drifting schemas, targeted old invoices, pre-mapping handoff, dirty
generation convergence, historical preservation, terminal fences, suspended
financial reads and deletion. Nontransactional sequence witnesses prove actual
publication SQL executed before lease/deletion rollback. Compiled maintenance
processes the extra durable child; actual Chromium displays paid/cancellation
observations with no Pro or private provider/contact details.

W08 remains in progress: canonical charge/PaymentIntent/refund/dispute and
credit-note attestations; eligible paid service-period policy; immutable billing
grants and revocations; approved grace/refund/dispute policy; restricted Portal
and cancellation; partitioned large-history reconciliation; financial retention
and privacy/support operations; authentic operated sandbox and live approval.
No real provider accounts, cards, charges or customers were used.
