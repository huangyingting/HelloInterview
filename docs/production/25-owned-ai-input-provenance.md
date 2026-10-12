# 25 - Owned AI saved-input provenance

**Status: internal W09 input-admission checkpoint, not enabled provider AI.**
This extends the [usage ledger](23-sandbox-ai-usage-ledger.md) and
[native intents](24-owned-ai-native-intents.md) with actual owned saved-input
snapshots. It supplies no public endpoint, provider transport or worker handler.
Managed external AI remains disabled; local grading and tutoring are unchanged.

## Release and trust boundary

Apply controlled **migration 19 and maintained queue migration** using
`npm run db:migrate` before starting replicas. Published migrations 1-18 remain
unchanged. Startup rejects missing/incompatible application schemas. Preserve
application tables, private snapshots and the maintained queue together during
backup/restore; use the configured application schema/search path for maintenance
and restore into that same controlled schema.

Migration 19 adds `ai_input_policies` and `ai_input_snapshots`. It creates neither
an input snapshot for an older reservation nor new allowance, funding, native
authority or provider consent. Existing saved work, account/entitlement records,
usage counters, operations and bindings are preserved.

The interface is **trusted internal server code**, not browser-supplied
authority or staff/support permission:

```text
usage = SandboxUsage.open(database, explicitAccountingManifest)
inputs = SandboxInputs.open(database, explicitInputManifest)
jobs = DurableJobs.open(database)
intent = inputs.enqueue(usage, jobs, ownedSourceRequest, trustedCostCeilingMicros)
prepared = inputs.prepare(usage, jobs, owner, intent.operationId)
jobs.cancelReservedAi(usage, owner, intent.reservationId, opaqueEvidence)
```

All three modules must share the **same Database adapter object**, not just a
URL, so nested SQL uses the same transaction/client. No SDK or other network
operation may run inside these admission transactions.

The strict source request contains owner, original security epoch, unique key,
kind, saved source ID, expected revision, sandbox-accounting acknowledgment and
opaque evidence. It accepts no input body/reference/hash, prompt/model, native
job ID or price. The separate positive finite integer cost ceiling is a trusted
server argument, not client authority; this checkpoint does **not** calculate or
attest provider pricing.

The `sandbox-ai-usage-v1` acknowledgment is accounting consent only. Neither it,
an owned snapshot nor a prepared envelope establishes reviewed provider/privacy
consent. Never put learner input, contact information or credentials in actor/
reason evidence or native job metadata.

## Explicit immutable model and prompt manifest

`SandboxInputs.open()` requires an explicit `sandbox-ai-input-v1` manifest:

- Model ID and revision.
- Tutor/feedback/mock/project prompt versions and actual trusted prompt text.
- An integer `maxInputBytes`, between 1,000 and 131,072 inclusive.

There are no numerical/model/prompt/provider defaults. The policy is stored as
canonical bytes with a SHA-256 fingerprint. Another replica must supply identical
bytes; changing an existing policy ID's model, prompt or bound raises a conflict.
Prompt fingerprints are derived from actual text, not a caller-supplied digest.
Policy changes need a separately reviewed version/migration and cannot reinterpret
retained snapshots.

The private envelope separates trusted model/prompt fields from untrusted
learner `data`. It captures source kind/ID, actual saved revision, full normalized
source-record hash and applicable content version. This is provenance, not a
claim that untrusted input cannot contain prompt injection.

## Actual source preparation

Preparation locks the current verified active owner/account and original epoch,
checks the relevant current Pro capability, and reads only the selected owned
saved record. Existing `userStateSchema` validates that record without copying
the user's unrelated state or profile.

| Kind | Owned source | Exact prepared context and rejected substitutions |
| --- | --- | --- |
| Feedback | `attempts` | Saved explanation/code/diagram and safe current exercise brief; requires meaningful saved work and excludes keyword/solution/worked-answer material |
| Mock | `mock_sessions` | Exact saved current question/draft/turn and bounded prior responses; rejects completed/inconsistent turns and does not copy old grading |
| Project | `project_workspaces` | Original saved AI-coding brief/version, real shared `projectPatch`, explanation and user-reported verification; rejects unpinned legacy briefs, unsupported paths and absent baseline/content |
| Tutor | `tutor_messages` | A meaningful saved **user** question only; rejects assistant messages and cannot fabricate unsaved lesson context |

Project brief bytes must match the original saved content-version hash. Current
catalog content cannot replace that archived project task. Feedback/mock use safe
practice projections without grading keywords, worked cases or solutions and
capture their exact projected content hash. Their content is not represented as
an originally pinned exercise if the older source did not store one.

Project verification is explicitly `user-reported-not-server-executed`; neither
this module nor an AI model runs tests. Source path validation and patch generation
reuse the existing supported-file and diff helpers.

The full selected-record hash catches changed work even when its numeric revision
stays unchanged, including tutor records whose stored revision is zero. Older
captured work cannot overwrite newer work by reusing a revision number.

## Exact bytes and atomic admission

The complete canonical JSON envelope, including model/prompt/provenance fields,
is measured in **actual UTF-8 bytes**. Exactly N bytes is accepted at a captured
N-byte limit; N+1 is rejected with 413. No truncation, alternative source or
success-shaped fallback occurs. This byte bound is **not** tokenization, a
provider context-window guarantee, output control or a monetary/rate ceiling.

Fresh admission derives a new opaque `snapshot:<UUID>` input reference and actual
input hash, then commits these together:

1. Original-calendar allowance and UTC day/month cost reservations.
2. Pinned maintained operation/native job/generation and binding.
3. Owned immutable command, provenance metadata and bounded private snapshot.

Failures roll back all new snapshot, accounting, audit, operation, binding and
native job writes. After actual snapshot SQL, the domain rechecks private bytes,
selected source, policy, account/epoch, Pro, original held accounting, native
context and original queue/budget deadlines. It checks current access and original
deadlines again after final native readback. A transaction's extra preparation
time cannot extend the original queue window.

Exact replay returns the original snapshot/reservation/operation references.
It does not recapture edited input, reset timestamps, refill capacity, resend a
job or replace a cancelled intent. Changed source/revision/cost/evidence/
acknowledgment conflicts. An older unbound reservation cannot be adopted under a
new snapshot key.

`prepare()` additionally requires the original owned snapshot, live private bytes,
original epoch/current Pro, held reservation/counters, unchanged full source,
original deadlines and actual available native intent. Missing, cancelled,
retired, stale or corrupted input produces an explicit failure and leaves capacity
held for reviewed cancellation/reconciliation.

Both methods return `providerEnabled: false`. A prepared envelope is **not** a
native claim, provider dispatch token or result-publication authority.

## Private payload lifecycle

Only the private snapshot table stores copied learner input. Native jobs retain
opaque accounting references and fingerprints, not prompts, code or results.
Scoped reservation foreign keys prevent another owner from adopting a snapshot.
Database constraints bound raw bytes and require live ownership/private payload
to be present or retired together, avoiding nullable-check `UNKNOWN` loopholes.

Deleting the owner retires all its raw snapshots before the user foreign key is
nulled. Deleting a saved attempt/mock/project/tutor source retires matching
snapshots in the same transaction. The new trigger functions pin their migration
search path; qualified source maintenance cannot redirect scrubbing to another
schema. A rolled-back deletion restores both source and raw snapshot.

Retirement clears the raw payload and live user reference. It does **not** release
units/cost/concurrency, cancel the native job, erase immutable bookkeeping or
assign authority to a replacement owner. Existing explicit known-undispatched
native cancellation remains the cleanup mechanism, including after owner
restriction/deletion.

Retained owner/source references, hashes, manifests, operation metadata and
evidence are pseudonymous private data, not anonymous records. This checkpoint
does not approve retention periods, erase encrypted backups, establish staff
MFA/RBAC, resolve paid-user deletion, or complete a GDPR/privacy request.

## Evidence and remaining work

`npm run test:usage` uses actual PostgreSQL, maintained native jobs and real saved
source APIs for all four kinds. It exercises replica replay/last-unit races,
foreign/stale/assistant/legacy/path rejection, exact UTF-8 N/N-1 thresholds,
same-revision source edits, cancellation/missing native state, scoped SQL
constraints and transactional source/owner retirement. Nontransactional sequence
witnesses prove actual snapshot/native/accounting SQL ran before rollback for
source/policy/epoch/payload/deletion/deadline/native corruption.

Actual migration-18 data/checksums survive repeated migration 19 without invented
snapshots. The compiled input module works without development loaders.
Existing integrated backend, managed-browser, local/demo and encrypted container
recovery suites remain the release checks.

Next W09 work still requires reviewed provider/privacy consent and request UX,
approved models/rates and tokenizer/output/rate/spend enforcement, operation-
specific native dispatch/publication authority, claim/heartbeat fencing around
SDK I/O, truthful unknown reconciliation, kill switches/circuit breakers and
owned job/allowance UI. Never enable this by adding AI to generic Pro capabilities
or treating accounting consent, a prepared envelope or a queue claim as provider
permission.
