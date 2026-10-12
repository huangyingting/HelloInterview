# 23 - Owned sandbox AI usage ledger

**Status: internal W09 engineering foundation, not enabled managed AI.**
This supplies PostgreSQL allowance/cost reservations and settlement, independently
of provider purchase, pricing, public consent, queue dispatch and customer UI.
No endpoint, provider handler, operator grant/reconciliation CLI or new commercial
allowance is enabled. Managed `ai.feedback.consume` and maintained managed AI
jobs remain denied; local synchronous AI and the local study helper are unchanged.

## Release and trusted boundary

Apply controlled **migration 17 and maintained queue migration** with
`npm run db:migrate`. Migrations 1-16 remain unchanged. Startup continues to
reject missing/incompatible application and maintained queue schemas. Drain
incompatible binaries and preserve authority with a compatible rollback.

`server/usage` is a **trusted internal domain**, like the entitlement issuing
boundary, not a public API. Its compiled module is
`dist-server/usage/index.js`, with runtime dependencies only.

Open it explicitly with a validated `sandbox-ai-usage-v1` manifest. No numerical
limits are defaulted or read from browser data. The manifest captures monthly
units, tutor/feedback/mock/project weights, daily/monthly USD-micro cost ceilings,
owner/global in-flight limits and maximum queue age. It is canonicalized and
fingerprinted once; changed limits under the same version conflict rather than
resetting balances. Opening this module does not confer AI permission.

Limits in fixtures are synthetic test inputs. The proposed 100-unit allowance
and 1/2/2/5 weights in the feature specification remain unapproved planning
values. Provider rates, privacy/retention, monetary stop thresholds and product
allowances need approval before an issuing/dispatching adapter is exposed.

Migration 17 stores:

- Immutable policy manifests and request fingerprints.
- Owned service-continuity lineages and original calendar anchors.
- Half-open monthly allowance windows with reserved/consumed counters.
- Deployment-wide UTC daily/monthly cost budgets.
- Owned exact-input/consent reservations with captured epoch, ceilings and state.
- Exact day/month links and immutable transition evidence.

Composite foreign keys bind windows, reservations and audit to the same
pseudonymous owner. Checks enforce finite positive limits, coherent terminal/
dispatch timestamps, nonnegative balances and no capacity excess. Partial null
settlement cannot pass a PostgreSQL CHECK through SQL UNKNOWN.

## Original-calendar windows and overlapping sources

Reservation uses current verified active managed account facts and database time.
Current nonrevoked `pro-v1` service is required; read-only, future, expired or
revoked-only access cannot reserve or publish. Eligibility here is accounting
eligibility, not `ai.feedback.consume` authorization.

All retained Pro grant intervals determine continuity, including revoked and
expired originals. Connected intervals reuse an existing lineage and its first
anchor. Overlapping replacement/recheckout, a duplicate source, or revival under
a different independently issued source cannot create another allowance merely
because the old source was revoked. Grants, revocation, entitlement audit and
licensed archives are not changed.

The sandbox policy conservatively treats **touching** endpoints as continuous
as well, preserving monthly invoice renewal and the original January-31 anchor.
It does not distinguish an adjacent new subscription from a renewal by guessing
from opaque grant keys. A genuine time gap creates a separate lineage. This
conservative engineering rule is not approval of the final commercial source/
subscription anchor policy.

Each boundary is recalculated from the original UTC calendar anchor, including
hour/minute/second/millisecond, and clamped to that month's final day. February
does not permanently move the anchor to the 28th, and no fixed 30-day interval
or browser wall clock is used.

An existing lineage anchor is never moved or its consumed balance cleared.
Backfilled intervals that join two already distinct lineages require operator
review, not a guessed merge or third allowance. Service before an established
future anchor likewise fails explicitly. A published policy change needs a
separately reviewed version/migration; this release cannot rewrite a running
window under a new manifest.

## Reservation and state contract

`reserve()` accepts only an internal normalized request:

```text
owner / immutable UUID key / exact current authEpoch
kind: tutor | feedback | mock | project
opaque inputRef / inputRevision / SHA-256 inputHash
positive bounded costCeilingMicros
consent: sandbox-ai-usage-v1 / acknowledged: true
opaque actor and bounded nonprivate reason evidence
```

Dates, units and limits come from the domain, not the request. The caller must
derive the input reference/revision/hash and worst-case cost from authorized
saved input and an approved bounded model request. This domain does not validate
a workspace revision, tokenize a prompt, verify provider billing or present
provider/privacy disclosure. Its consent tag records a sandbox accounting
acknowledgment, not acceptance of real-provider terms.

Owner/account locking precedes a deployment-wide PostgreSQL advisory lock, then
lineage/window/budget/record reads. This serializes replica admission and budget
changes without holding a transaction across SDK I/O. The global serialization
is an intentionally conservative engineering boundary, not load-tested scale.

Reservation, both budget links, unit/cost increments and first evidence commit
together. The exact same key/request returns the same original reservation.
Changed input, revision, cost, kind or consent/evidence conflicts. A failed
admission leaves no reservation, balance, window or audit side effects.

```text
reserved -> dispatched -> consumed
                   \--> unknown -> consumed
reserved -----------------------> released
dispatched / unknown ------------> released (explicit reconciled cost)
```

`markDispatched()` is a one-way durable accounting marker. Current epoch/Pro,
policy, captured balances, nonnegative queue age strictly below the manifest
limit, and unexpired captured UTC budgets are checked before/after actual SQL.
A marker is **not permission to call a provider** and not a maintained job claim.
The later adapter must bind admission to its native operation/claim and recheck
every dispatch fence. An existing marker cannot be used to repeat SDK I/O.

Owner and global concurrency include `dispatched` and `unknown`, even after a
generic TTL, account restriction or deletion. An elapsed lease does not prove
that a provider did nothing. Unknown observations preserve their first evidence;
another process/pool sees the same held units, costs and slot.

No implicit dispatch against yesterday's budget is allowed, even for a one-
millisecond-old request. An undispatched request crossing its captured day/month
or queue deadline needs explicit release, not a silently moved capacity claim.

## Atomic settlement, costs and publication

`complete()` accepts a bounded actual cost and result fingerprint plus a **SQL-
only publication callback**. Domain publication, unit consumption, both cost
settlements and final evidence commit in one shared database transaction.
Current epoch/Pro are checked before publication, after publication and after
actual settlement SQL; expiry/security movement rolls everything back.

An identical completed result is returned without running publication again.
Changed result/cost/evidence cannot overwrite the first settlement. The caller
must additionally verify the input revision and result quality, ownership and
native claim; those obligations are not replaced by an accounting receipt.

User units and provider costs are different ledgers:

- Usable confirmed publication consumes the original reserved user units once.
- A known undispatched cancellation can release units/costs at zero cost.
- Dispatched/unknown release requires explicit `reconciled: true`, bounded known
  cost and opaque evidence. Elapsed time or missing usage is not zero-cost proof.
- Known unsuccessful/stale results can release user units while retaining
  provider cost in both original shared budgets.

A result completing after monthly reset settles its **admission** allowance and
cost budgets, not the new month's remaining units. Current Pro is still required
to publish; saved work is preserved if access ends. Costs above the captured
ceiling are an explicit reconciliation hold, never silent undercounting or
permission to exceed a budget. Overrun accounting/alerts and provider-cost
attestation remain later adapter/operations work.

Every accounting operation verifies counter totals against retained children,
calendar bounds against the original lineage and exact UTC budget links.
Missing links, altered dates or drifting counters raise an explicit error rather
than an invented zero/remaining balance.

## Deletion, history and privacy

Deleting an owner nulls live user references without releasing ambiguous units/
costs. Old requests, lineages and audit cannot be adopted by another owner.
No late result can publish to an absent/replacement account. Trusted internal
reconciliation can still record the known abandoned provider cost, without
granting the deleted owner access.

The bounded internal owned view contains kind/state/units and the original
allowance window totals, with `providerEnabled: false` and explicit history
truncation. Input references/revisions/hashes, request/evidence payloads, actors,
source keys and provider cost details are not returned.

No raw prompt/result/provider credentials are stored by this domain. Digests,
opaque references, owner IDs and reasons are still potentially pseudonymous
private data, not automatically anonymous. Never put private input into actor/
reason fields. Approved purpose, retention, paid deletion and staff/support
reconciliation authority remain W10/legal gates; no unapproved pruning occurs.

## Verification and next adapter

`npm run test:usage` requires a dedicated `TEST_DATABASE_URL`. Actual PostgreSQL,
HTTPS managed owners and replicas cover immutable manifests/requests, weighted
last-unit races, independent sources, a real saved premium mock, original-anchor
continuity, source gaps/ambiguous backfill, budgets, owner/global concurrency,
unknown holds, old-window settlement, strict queue/UTC boundaries and scoped
deletion/reconciliation.

Nontransactional sequence witnesses prove actual admission/result SQL executed
before security/expiry rollback. Database null/capacity constraints, minimized
history and explicit drift errors are exercised. Actual migration-16 identity/
grant rows and checksums survive repeat migration 17. The compiled module works
without development loaders, and runtime-only release evidence imports it.

Next W09 work must bind reservations **atomically to native jobs**, add reviewed
provider consent and request UX, bounded prompts/output/token/rate/cost policy,
private model/prompt/input provenance, kill switches/circuit breakers, result
quality and immutable input checks, native claim/heartbeat fencing, truthful
unknown-outcome reconciliation and owned allowance/job UI.

Do not enable managed AI merely by adding it to `proCapabilities` or bypassing
the existing maintained-job permission check. This checkpoint makes no provider
request and satisfies none of those remaining dispatch/operating approvals.
