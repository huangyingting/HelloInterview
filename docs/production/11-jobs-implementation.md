# 11 - Durable jobs, inbox and transactional delivery

**Status: W07 engineering foundation, not live provider delivery.** PostgreSQL
jobs, input idempotency, transactional enqueue/finalization, leased workers and
audited maintenance are available. Existing local synchronous workflows remain
unchanged. No email, payment, identity, privacy or AI handler is enabled by this
checkpoint, and `APP_MODE=service` remains disabled.

## Implementation boundary

The architecture's ADR-06 requires a maintained PostgreSQL queue rather than
an application-invented scheduler. This implementation pins `pg-boss` to
`12.37.1`; its durable queue supplies claims, retries, heartbeat recovery,
singleton resource concurrency and dead lettering. The application adds the
business boundaries that a queue alone does not supply:

- Stable operation IDs and principal/kind/key uniqueness, including after
  queue retention, process restart and operator replay.
- Canonical, bounded, immutable request bytes and a checked request hash.
- One database transaction for business writes and queue insertion, and one
  transaction for business result writes and attempt-fenced completion.
- A verified-event inbox with payload-conflict detection and durable enqueue.
- New queue IDs and monotonically increasing operation generations on replay.
- Safe diagnostic codes, private inputs and bounded maintenance responses.

`server/jobs/` contains the implementation. The build includes
`dist-server/jobs/index.js`, a runtime-only module exporting `DurableJobs`,
`postgresConnection`, errors and the migration helper. Future worker composition
can use the same release as the API. There is deliberately no empty worker daemon
or pretend successful provider handler.

SQLite does not emulate this production queue. Calling its job boundary fails
explicitly; existing local/demo requests continue using their established
synchronous behavior until the corresponding feature package adopts jobs.

## Storage and migration

Application migration **3, `durable-operation-boundaries`**, adds:

| Storage | Authority |
| --- | --- |
| `durable_operations` | Original operation ID, principal scope, optional owner, kind, unique request key/hash, resource, canonical payload, retry mode, current queue ID/generation and completed receipt |
| `verified_event_inbox` | Unique source/event ID, canonical payload/hash, immutable operation association and receive time |
| `job_operator_events` | Replay actor/reason, previous/next queue IDs, generation and explicit provider-reconciliation acknowledgement |

The queue uses a **separate schema**, `<application_schema>_jobs`, derived from
`current_schema()`. For the default application schema this is `public_jobs`.
The application schema must be a lowercase identifier of at most 45 characters.
Fixtures own and remove their distinct application and queue schemas.

`npm run db:migrate` now applies application migrations and then installs/upgrades
the pinned queue schema and queue definitions. Application migrations remain one
checksum-verified transaction. Queue installation uses the library's own
advisory-locked migration transactions; these are **not one cross-system atomic
migration**. An installation failure exits nonzero, prevents the staging
migration gate from admitting the API, and can be retried explicitly.

Released migrations 1 and 2 are unchanged. The application's API startup does
not install a queue. Queue clients use `migrate:false` and `createSchema:false`,
and reject missing/incompatible schema or queue policy rather than repairing it.
An API using only current synchronous features need not open a queue client.
Worker-enabled feature readiness must check its queue dependency.

Use the separately authorized maintenance credential for installation. Runtime
roles need queue/application data and function access, not schema creation.
Managed provider roles, deployment automation, permissions and operating owners
still require W03's external approval gates.

`Database.executeSql` is the shared native-parameter adapter: unlike the
application's `prepare()` placeholder conversion, it preserves PostgreSQL `$n`,
arrays, JSON, dates and dollar-quoted SQL. Its queries participate in the
existing transaction context. Queue sends and completions explicitly receive
that same adapter; they must not use an unrelated pool.

## Enqueue and idempotency

`DurableJobs.enqueue()` requires:

| Field | Contract |
| --- | --- |
| `principal` | Trusted server-selected `user` account ID or `system` namespace; not browser-selected authority |
| `kind` | `billing.reconcile`, `notification.deliver`, `ai.evaluate`, or `privacy.process` |
| `key` | Opaque request idempotency key, scoped to principal and kind |
| `resource` | Stable resource serialization key; include environment and customer/workspace/account identity as appropriate |
| `payload` | Plain JSON object containing the feature's immutable input/reference, not credentials or unnecessary private data |
| `retryMode` | Explicit `idempotent` or `reconcile`; there is no implicit safe-retry assumption |

IDs/namespaces/resources are bounded opaque ASCII identifiers; request keys
are at most 160 characters. Payloads are at most **262,144 UTF-8 bytes**, with
24-level/16,384-node complexity bounds. Non-JSON values, cycles, custom
prototypes and dangerous prototype-related keys fail explicitly. Object key
order is normalized; strings and source whitespace are preserved. Unsafe keys
are rejected before validation rather than silently dropped by a parser.
Completed receipts are bounded to **16,384 bytes**.

Within a caller's business transaction, enqueue reserves an operation and
inserts its queue job. A thrown business error rolls both back. Queue payloads
contain only the operation ID and generation; workers load and hash-check the
saved input. Same principal/kind/key and same normalized request returns the
original operation. A changed kind-scoped request returns `409`. A different
principal has an independent key namespace.

The stable provider idempotency key is the **operation ID**, not a worker attempt,
random queue ID or replay generation. The original operation remains the
deduplication authority after completion and queue cleanup. A missing transport
job is reported as `missing`, never fabricated as completed or automatically
resent with a fresh provider key.

`ownedStatus()` queries ownership before returning a minimal status/receipt.
Foreign operation IDs return `404`. No generic public job creation/status
endpoint is exposed yet; W08-W10 must add feature-specific authorization and
response contracts.

Migration 4 adds managed account status. Owned-user operations now require an
existing active account at enqueue, before worker preparation and at fenced
finalization. Finalization locks owner/account before the operation, preserving
the common owner-first lock order and preventing suspended/pending owners from
publishing. Unmanaged local fixture accounts retain their previous eligibility;
system operations still need explicit feature-handler eligibility. This is not
replacement authorization for grants, quotas, consent or staff privilege.

## Verified events and outbox

`ingestVerifiedEvent()` is an **internal post-verification interface**, not a
signature verifier. The future provider adapter must verify the original raw
body, endpoint secret, merchant/tenant/environment and event schema before
calling it. It must not acknowledge a webhook before this transaction commits.

The source namespace is server-selected and includes provider/environment.
Unique `(source,eventId)` and normalized payload bytes fence duplicates.
Repeated identical events return the existing operation. Reusing an event ID
with different payload or operation input fails with `409`. Inbox bytes and
queue insertion commit together; failed ingestion can be retried without an
acknowledged-but-undeliverable event.

An enqueue in a business transaction is the **transactional outbox**: the
operation owns its payload and the queue owns durable delivery. There is no
second loosely coordinated process-local delivery list. A saved support ticket
is still only saved, not externally delivered, until W10 connects a real handler.

Do not import queue jobs, verified provider events or operator authority from
legacy SQLite backups. The existing explicit importer continues to copy only
its approved learning/account projection and authored assessment snapshots.

## Claims, retries and business finalization

Each feature queue uses the library's `singleton` policy. A hash of
`kind:resource` allows at most one active job for that resource across replicas,
while unrelated resources proceed. The key does not depend on the enqueueing
principal, so a user request and a provider event for one customer serialize.
This is **not FIFO ordering**; billing must reconcile canonical provider state,
not replay event deltas in arrival order.

Workers use `DurableJobs.open(db, true)` and `startWorkers(handlers)`. Starting
an empty handler set, starting twice, or using a producer-only client fails.
The queue supplies bounded polling, heartbeat and maintenance. Enabled workers
register their instance in the library's private operational registry.

The handler has two phases:

1. Prepare outside any SQL transaction. Recheck eligibility, perform bounded
   provider work with the supplied abort signal and stable operation key, and
   validate the provider result. Return a short database mutation function.
2. Finalize inside the shared transaction. Lock the operation, validate its
   generation/current queue ID, current active attempt, database-clock deadline
   and current heartbeat, execute the mutation, recheck the claim, complete
   **that fetched attempt**, and save the completion receipt.

If completion affected no current attempt, the whole business transaction rolls
back. A killed/replaced worker cannot complete/fail a newer attempt or publish
its old result. An operator replay also changes the operation generation and
queue ID, preventing an older generation from settling a replacement even if
the library retry counter restarts.

The framework blocks dispatch and completion of user-scoped work whose owner
has been deleted. Account suspension/verification, entitlements, source
revisions, quota settlement and domain lock ordering remain the **feature
handler's** responsibility. They must be checked before dispatch and again
before publication; successful provider work is not authorization to publish.
Never do slow provider calls inside the returned database mutation.

| Queue behavior | Shipped bound |
| --- | --- |
| Attempt expiration | 300 seconds |
| Expected heartbeat | 30 seconds; current heartbeat is reread before finalization |
| Supervisor/monitor interval | 10 seconds |
| Safe automatic retries | Three retries after the original attempt |
| Retry delay | Five-second exponential backoff with jitter, capped at 300 seconds |
| Unreconciled external side effects | Zero automatic retries |
| Queued transport retention | 14 days |
| Terminal transport retention | Seven days |
| Worker drain | Stop new admission; allow active work up to ten seconds, then abort/fail its attempt |

`idempotent` is appropriate only after the handler establishes safe repetition,
for example a provider with a durable request key/result lookup or a canonical
read. External AI and other providers without that contract need `reconcile`.
After an unknown outcome, do not blindly resubmit; preserve the original
operation and resolve its provider fact first.

`TerminalJobFailure` routes ineligible/invalid/reconciliation-required work to
dead letter without exhausting ordinary retries. Other failures retain only
safe diagnostic codes; raw exception messages, provider bodies, credentials and
user inputs are not copied into queue output or logs. Feature observability must
add controlled, privacy-reviewed diagnostics rather than restoring raw errors.

## Operator inspection and replay

Use the compiled maintenance tools with a privileged, approved database
maintenance environment:

```bash
npm run jobs:status
npm run jobs:replay -- <operation-id> \
  --actor <operator-id> \
  --reason "Document the incident and checked provider outcome"
```

For `reconcile` operations, replay additionally requires
`--provider-reconciled`. This flag records an operator acknowledgement; it is
**not** an automated verification of provider state.

Inspection returns at most 50 recent operation metadata rows and aggregate
dead-letter counts/oldest ready age/capture time, not inputs or provider bodies.
The pinned queue's job-search API has no pagination, so the application does
not use an unfiltered job-list call for operator output. Queue statistics have
the library's up-to-one-minute refresh cache even with a forced reading; use
the reported capture time rather than assuming an instantaneous count.

Replay allows only `failed`, `cancelled` or explicitly `missing` operations.
Active, retrying, queued and completed operations cannot be replayed. A reason
and actor are mandatory. The operation ID and input hash stay unchanged; a
new queue ID and generation, enqueue and audit row commit together. The old
generation's dead-letter shadow is removed through the maintained queue API
in that transaction; the operation and audit history remain.

These commands trust the existing database-maintenance permission boundary.
`--actor` is an accountability identifier, **not** authenticated staff RBAC.
No staff HTTP replay endpoint exists. W10 must add recent authentication,
MFA/roles, auditable authorization and approval requirements before exposing
operational actions in the product.

Transport retention does not delete the idempotency record. Completed receipts
remain readable after queue cleanup; missing pending transport is visible and
can be recovered with an audited new generation. Automatic retention/erasure
of operation inputs, inboxes and audits requires the W10/W12 approved policy.
Do not admit real personal/financial data before those policies and deletion
replay are wired.

## Recovery and validation

Use `npm run test:jobs` with an explicitly dedicated `TEST_DATABASE_URL`.
The fixture suite covers:

- Exact payload byte/complexity thresholds and dangerous-key rejection.
- Missing schema/policy refusal, concurrent installation and explicit repair.
- Native PostgreSQL parameters and caller-transaction enqueue rollback.
- Concurrent idempotency, ownership, immutable completion and restart.
- Duplicate/conflicting event ingestion and inbox/outbox rollback.
- Cross-replica resource exclusion and independent-resource progress.
- Result rollback, old-attempt rejection, and actual expired-deadline rollback.
- Zero-retry unknown outcomes, acknowledged/audited replay and old generations.
- Missing transport diagnostics, real polling/draining and safe failures.
- **Actual worker process death after loopback provider success:** replacement
  retries the original stable key; the synthetic provider applies one external
  effect and the application commits one business effect.
- Runtime-only compiled migration/status/replay/module execution.

The container restore drill now includes a queued owned operation. The full
encrypted PostgreSQL dump includes both the application and queue schemas.
After restoration into an isolated runtime, the same idempotent request returns
the same queued operation; claiming/finalizing it commits one owned business
change and receipt. App-only backups that omit the queue schema are insufficient.

For an actual restore, keep dispatch stopped until deletion-manifest replay and
identity/billing/provider reconciliation finish. Restored pending jobs may
already have succeeded externally after the backup point. Idempotent provider
keys and reconciliation, not the restored queue alone, protect those effects.

## Remaining integration and launch gates

- W04/W06 account status, verified authority and entitlement policies.
- W08 signed webhook adapter, canonical billing handlers and repair tooling.
- W09 exact quota reservation/settlement, consent/budget and uncertain AI outcomes.
- W10 real delivery/support, privacy workflows, staff authorization and erasure.
- A concrete worker entry point/container composition when real handlers exist;
  this checkpoint ships a reusable worker module, not enabled provider jobs.
- Approved retention, managed queue permissions, alerts/dashboards, load targets
  and provider sandbox evidence. Synthetic success is not live-service approval.

References: [pg-boss constructor and database adapter](https://pgboss.io/api/constructor),
[jobs and attempt fencing](https://pgboss.io/api/jobs),
[worker lifecycle](https://pgboss.io/api/workers) and
[queue policies](https://pgboss.io/api/queues). The installed release's types/API
are authoritative; newer documentation can describe unreleased options.
