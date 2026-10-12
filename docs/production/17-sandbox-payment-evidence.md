# 17 - Canonical sandbox payment and reversal evidence

**Status: fourth W08 engineering checkpoint, observation-only.** Extends the
[owned canonical ledger](16-canonical-sandbox-ledger.md) with linked
PaymentIntent, charge, refund, dispute and credit-note facts. A `settled`
funding trace means only that this bounded read satisfied the narrow sandbox
card-evidence contract. It is **not an eligible paid service interval, a
financial book of record, approved commercial policy or permission to grant
Pro**. Commerce remains `disabled`; independent W06 grants are untouched.

## Deployment and compatibility

Apply **application migration 11 and the maintained queue migration** through
the controlled `db:migrate` command before deploying this release. Published
migrations 1-10 are unchanged. Migration 11 adds
`stripe_invoice_charge_links`: account/charge/invoice uniqueness, an owned
invoice foreign key, customer correlation and the first published revision.
Links, financial facts, immutable snapshot, current state, receipt and queue
completion publish in the existing fenced transaction or all roll back.

No new environment variables, provider mutations, browser-selected payment
references or durable job kinds are added. Existing own-account/test-mode SDK
binding, hosted identity, shared account admission, fresh proof and CSRF rules
remain. The compiled `billing:worker` / `billing:reconcile` dispatch the existing
`billing.customer.snapshot` kind; success authority remains
`sandbox-ledger-observation-only`.

New snapshots use `recent-90-days-and-financial-targets-v2`. Published v1
snapshots remain readable. Old invoices without funding evidence parse as
explicit `null`, displayed as unevaluated, not retroactively settled. Retained
legacy holds remain until a successful canonical read of that invoice.

There is no downgrade migration. An older binary cannot understand new
financial payloads/events even though its original tables remain. Roll back
only to a release that understands migration 11 and these schemas, or stop
workers/traffic and use an approved restore/reconciliation procedure. Do not
drop financial history to force a downgrade.

## Read and settlement contract

The official pinned Stripe SDK/API supplies:

| Evidence | Canonical read and validation |
| --- | --- |
| Invoice payments | Complete invoice-scoped `InvoicePayment` references, then complete reverse allocations for each PaymentIntent |
| PaymentIntent | Explicit retrieval, owned customer, test mode, currency, status, amount, amount received/capturable and latest charge |
| Charges | Complete PaymentIntent-scoped charge list; explicit charge details; matching intent/customer/currency/mode; connected-account transfers refused |
| Refunds | Complete charge-scoped list; matching charge/intent/currency/customer where present; supported status and bounded amount |
| Disputes | Complete charge-scoped list; matching charge/intent/currency/mode; disputed charge requires observed dispute evidence |
| Credit notes | Complete invoice-scoped list; matching invoice/customer/currency/mode; retained amount and issued/void status |

`sandbox-card-evidence-v1` establishes `settled` only for a paid, positive-total
invoice with a paid timestamp, zero remainder and amount paid equal to total;
exactly one paid allocation of that total; exactly one succeeded PaymentIntent
with matching amount/received, zero capturable amount and only one noncanceled
allocation; and exactly one successful captured card charge matching its
latest-charge reference, with total captured equal to invoice total.

Failed charge attempts may remain recorded but cannot fund service. Incomplete
or action-required payments are not settled. Zero-value invoices, paid flags,
out-of-band `payment_record` references, direct-charge funding, multiple active
allocations and non-card methods do not satisfy this contract. Direct charges
may still be traced for review; the SDK has no supported direct-charge reverse
`InvoicePayment` list filter, so the reader does not invent one.

Final charge headers, PaymentIntent money/status/reference fields, complete
reverse allocations, invoice headers and complete invoice payment references
must agree with their earlier read. Changes or contradictory scope fail the
operation rather than publish partial success. These guards are **not an
atomic provider snapshot**: remote state can change after a read, and future
commercial authority requires its own eligibility/publication policy.

The existing **48 SDK requests per dispatch**, including account/customer
reads, remains exact. Default request timeout is three seconds with automatic
SDK retries off. Each collection is bounded to five pages/500 objects, with
duplicate IDs, empty/repeated continuation and malformed schema rejected.
Intent, charge and allocation caches are per dispatch, not process-wide;
allocation consistency rereads remain complete. Every external request passes
the maintained attempt/lease heartbeat checks. Snapshot/invoice byte limits and
safe-integer amount validation remain unchanged. Oversized histories need
partitioned reconciliation, not silent truncation or deleted evidence.

## Reversals and historical targeting

Signed charge/refund/dispute observations resolve canonical charge ->
PaymentIntent -> complete invoice allocations -> explicit historical invoices.
Retained charge links also preserve known targets. Canonical credit notes
resolve directly to their invoice. Supported signed credit families now include
`credit_note.created`, `credit_note.updated` and `credit_note.voided`, under
the existing raw signature, account/mode/version and immutable notification
checks. Neither event timestamps nor webhook status hints establish settlement.

These explicit targets extend the 90-day invoice-creation window. An unresolved
charge remains `payment-lifecycle-unverified`; no eligible invoice or service
period is invented. Absence from a recent window still never erases history.

Only **succeeded refunds** contribute to the public refunded amount.
Pending/requires-action refunds create a hold even if the charge's
`amount_refunded` counter moved. The conservative counter check requires the
succeeded sum <= counter <= succeeded + pending/requires-action sum, and counter
<= captured <= charge amount. Failed/canceled refunds remain recorded without
subtracting captured funding. Authentic operated sandbox verification of
provider counter behavior is still required; fixtures do not approve a refund
policy or establish provider production semantics.

Funding states are `unpaid`, `review-required`, `settled`,
`partially-refunded`, `refunded`, and `disputed`. Issued credits and pending
refunds retain explicit holds even when another reversal determines the
displayed state. All dispute history, including won/closed cases, remains
review-only; no automatic access restoration is implemented. Voiding a credit
can remove that adjustment hold, but never the commercial-policy hold.

Funding currency cannot change across observations. Previously captured charge
sources cannot disappear, lose captured funds or
change currency/intent/amount/method. Succeeded refunds cannot disappear or
change amount/status. Disputes cannot disappear; terminal won/lost/prevented
cases cannot reopen. Credit notes cannot disappear/change amount, and a voided
note cannot reissue, including invoices with no charge evidence. Contradictions
preserve the prior projection and require reconciliation.

## Owned HTTP/UI and privacy

`GET /api/billing` adds nullable invoice funding:
`{ state, captured, refunded, creditAdjusted }`. Amounts are labelled in the
invoice currency's **minor units**. Provider payment IDs, full SDK bodies,
client secrets, payment-method detail bodies, contacts, evidence bodies and private
receipt/credit/invoice URLs are not returned or stored in normalized facts.
Internal minimized facts retain only references needed for reconciliation.

The private billing page displays funding and adjustments beside unchanged
invoice/subscription observations, explicit operator holds, stale/incomplete
status and **no paid access**. Refresh uses the existing exact-empty-body owned
endpoint; there is no caller-selected customer, charge, amount or authority.
Every newly read invoice retains `commercial-policy-pending`.

## Evidence and next boundary

PostgreSQL/maintained-queue, official-SDK loopback and HTTPS fixtures exercise
card proof, complete pagination, refunds, disputes, credits, historical targets,
scope/currency/mode mismatch, multiple allocations, late source movement and
legacy null evidence. Nontransactional sequence witnesses prove financial-link
publication SQL ran before an expired claim rolled every write back. Compiled
maintenance requires no development loaders; actual Chromium displays settled
then partially refunded funding without Pro or provider/private details.

The subsequent [sandbox service checkpoint](18-sandbox-service-authority.md)
adds default-off versioned service-period eligibility and trusted immutable
issuing/revoking adapters. The no-grant behavior above remains the default;
strict opt-in sandbox reversals are not approved commercial policy.

Next W08 work: authentic provider lifecycle/period evidence, approved commercial
and grace/refund/dispute decisions,
restricted Portal and cancellation, partitioned history, retained financial
privacy/support operations and authentic operated recovery. Approved merchant,
prices/currency/tax/legal policies and live authorization remain gates.
No real provider accounts, cards, charges or customer data were used.
