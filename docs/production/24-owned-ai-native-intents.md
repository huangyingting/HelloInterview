# 24 - Owned AI reservation/native intents

**Status: internal W09 admission checkpoint; operation-specific provider
execution is added by [66](66-managed-ai-native-worker.md), while browser
admission remains disabled.**
This composes the [usage ledger](23-sandbox-ai-usage-ledger.md) with the maintained
queue. It does not expose an endpoint, add an AI handler, approve a provider or
grant `ai.feedback.consume`. Local grading/tutoring remains unchanged.

## Release and trust boundary

Apply controlled **migration 18 and maintained queue migration** with
`npm run db:migrate`. Published migrations 1-17 remain unchanged. Startup rejects
missing/incompatible application and queue schemas. Preserve the application and
queue together during backup/restore; drain incompatible workers before rollout.

Migration 18 adds `ai_usage_operations` and a scoped operation uniqueness
constraint. A composite foreign key binds the native operation ID, exact
`user:<owner>` scope and `ai.evaluate` kind. Another scoped foreign key binds
the same reservation and pseudonymous owner. Operation/job IDs are one-to-one;
generation is fixed at zero. User deletion can null live ownership without
changing that retained scope.

No old reservation or operation is automatically assigned a binding. A legacy
unbound operation cannot be adopted merely because its request bytes match.
This migration neither issues allowance nor changes an existing balance.

The API is trusted server-side code, not browser or staff/support authority:

```text
usage = SandboxUsage.open(database, explicitSandboxManifest)
jobs = DurableJobs.open(database)
intent = jobs.enqueueReservedAi(usage, normalizedOwnedReservationRequest)
jobs.cancelReservedAi(usage, owner, reservationId, opaqueEvidence)
```

Use the **same Database adapter object** for both modules. Their nested
transactions share its client/AsyncLocalStorage boundary, not merely a database
URL. Different adapters are rejected before mutation. The `bindJob`/`cancelJob`
domain callbacks are SQL-only internal seams; they are not SDK hooks or
alternate permission APIs. Use the maintained-job methods above.

All numerical values remain explicit immutable sandbox manifests. Fixture
limits, input references and actor evidence are synthetic, not approved product
pricing, provider terms or staff authorization.

## Admission is not dispatch

`enqueueReservedAi()` reserves the original allowance and day/month cost
ceilings, persists the native operation, sends its maintained queue job and
records the binding **in one database transaction**. A failure rolls back all
new reservation/balance/audit/operation/native-job/binding writes. A pre-existing
standalone reservation is retained unchanged if its subsequent binding fails.

The producer derives the owned native scope/key/resource/payload. Callers cannot
choose a job ID, native generation, principal, queue, retry mode or replacement
reservation. Native payload contains only the opaque reservation ID, accounting
authority and immutable request fingerprint; it contains no prompt or result.

The native operation uses `reconcile`, with **zero automatic retries**. Its
original job ID and generation are pinned. Actual native readback verifies its
queue, IDs, payload, zero retry limit and exact singleton resource key. Fresh
admission requires a real `created` job, not an invented ID or prior active
attempt. Another replica cannot observe it until admission commits.

Current verified account/epoch, current Pro, immutable policy/request, calendar
and cost counter integrity, original nonnegative queue age and captured UTC
budget deadlines are checked around actual SQL, including after native job
creation and binding. Generic operation timestamps do not replace the
reservation's original captured deadline.

An exact key/request replay returns the same reservation, operation, job ID and
generation, including after restart or cancellation. It does not call `send`
again, recreate a pruned job, reset a timestamp or refill capacity. Changed
input/revision/cost/consent/evidence conflicts. A known finished standalone
reservation cannot receive its first native binding.

## Generic provider authority remains explicitly denied

The existing generic managed `jobs.enqueue({kind: 'ai.evaluate', ...})` still
requires `ai.feedback.consume` and remains denied under current Pro policy.
The special internal producer grants **accounting admission only**.

Bound intents are additionally denied by an explicit operation-specific check
before maintained worker handler I/O, claim/heartbeat authorization and generic
publication. They stay denied even if a legacy owner path or later global
capability would normally allow AI. System principals cannot borrow ownership.
An AI worker registered against this generic path rejects/dead-letters the
intent before its handler runs, leaving accounting held for explicit cleanup.
Do not register that worker as a production provider adapter.

Standalone `markDispatched`, `markUnknown`, `complete` and `release` cannot act
on a bound intent. This prevents an accounting marker from becoming an alternate
dispatch path or capacity from being released while leaving a live native
intent. Generic `jobs:replay`, even with `providerReconciled: true`, cannot
advance a bound operation or assign another job/generation.

This checkpoint itself supplied no SDK transport or user-facing consent flow.
The later operation-specific worker in [66](66-managed-ai-native-worker.md)
retains the generic denial while adding pinned Azure execution and atomic
publication for these exact bindings. `providerEnabled` remains false at the
input-admission interface until owned Route Handlers and participant UX ship.

## Atomic known-undispatched cancellation

`cancelReservedAi()` requires the exact retained owner/reservation/native
binding and valid immutable policy/counters. It accepts only `reserved` or its
identical prior zero-cost `released` outcome, with no dispatch timestamp.
Consumed/dispatched/unknown or conflicting terminal evidence requires review.

Cancellation targets the **original intent ID**, under owner/account and
global accounting locks, with original operation/job/generation/payload
readback. It is not a worker acknowledgment: the native attempt variant only
accepts a current active lease and rejects an unclaimed queued job. The
intent-level native cancellation also handles an active/expired lease without
treating the lease's age as proof of zero provider cost.

Zero cost is justified by this release's explicit denial of every bound provider
dispatch and of standalone dispatch markers, not by elapsed time or absent
usage. A failed/cancelled/pruned native job cannot recreate permission. Native
completed state, altered payload/retry policy, changed operation or inconsistent
accounting raises an explicit hold instead.

Native cancellation, original-window unit release, both original cost releases
and first release evidence commit together. Actual queue/settlement SQL followed
by a failed readback rolls back native cancellation and accounting together.
Repeating identical cancellation evidence is idempotent; replacing it conflicts.
An identical admitted request after cancellation returns that cancelled/released
intent, never a new job. A distinct new key can make a separate eligible
reservation without minting a second window.

Restricted/deleted owners cannot publish or borrow another owner's binding.
Trusted internal cleanup can cancel known-undispatched work after restriction
or deletion without granting user access. This is not a public cancellation
endpoint, MFA/RBAC support workflow or completed privacy-deletion policy.

## History, evidence and remaining adapter

The minimized owned usage view now includes an opaque `operationId` or null.
It omits native job IDs, scope/generation/request hashes, input/evidence and cost
details, and still reports explicit truncation and `providerEnabled: false`.
Bindings, operation data, digests and audit are potentially pseudonymous private
records; no unapproved pruning or anonymity claim is introduced.

`npm run test:usage` includes actual PostgreSQL/native queue replicas/restart,
last-unit admission, exact replay, cancellation, scope/kind constraints,
generic/worker/legacy dispatch denial, deletion/restriction, compiled operation
and migration-17-to-18 preservation. Nontransactional sequence witnesses prove
native insert, binding, cancellation and settlement SQL really ran before
rollback for security/deadline/balance/payload/retry/generation failures.

The [saved-input checkpoint](25-owned-ai-input-provenance.md) supplies actual
owned saved-source/model/prompt provenance, exact UTF-8 snapshots and
transactional raw-payload retirement. Preparation remains distinct from provider
authority. Next W09 work needs reviewed provider/privacy consent and bounded
request UX, an explicit
operation-specific dispatch/publication authority, native claim/heartbeat
fencing around real SDK I/O, token/rate/spend enforcement, truthful unknown
reconciliation and owned job/allowance UI. Never enable this by adding AI to
generic Pro capabilities or replacing a denied check with a queue claim.
