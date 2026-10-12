# 08 - Persistence implementation and cutover runbook

**Status: W02 engineering checkpoint implemented, not a customer-data cutover
or production-launch approval.** SQLite is still the default local database.
PostgreSQL does not activate live commerce or managed identity.

## Storage boundaries

`server/db/connection.ts` defines an asynchronous connection/transaction
interface. PostgreSQL uses a `pg` pool with a maximum of ten connections per
process, a five-second connection timeout, and a thirty-second idle timeout.
An async-local transaction context pins every nested repository operation to
the same pooled client. Transactions commit once or roll back on failure.
No synchronous PostgreSQL adapter or event-loop blocking bridge is used.

SQLite keeps the existing `studio.sqlite` schema for compatibility. A per-instance
queue serializes asynchronous calls; `BEGIN IMMEDIATE` covers multi-step writes.
Nested repository calls participate in the existing transaction. A rejected
operation is propagated to its caller without poisoning subsequent queued work.
SQLite is for local use, not the proposed multi-replica production substrate.

Application construction owns the connection and awaits disposal. Startup
checks PostgreSQL migration history but never creates or modifies PostgreSQL
schema. The production release contains `dist-server/index.js`,
`dist-server/db/cli.js`, and the reusable `dist-server/jobs/index.js` module;
none is served as a browser asset.

## Current PostgreSQL schema

| Storage | Authority and invariant |
| --- | --- |
| `users`, `sessions` | Stable owners and opaque hashed sessions; owner/expiry indexes. Local email login is distinct from W04 `(issuer,subject)` authority; managed local-login email is null |
| `managed_accounts`, `managed_identities`, `managed_sessions`, `auth_transactions`, `identity_security_events` | Migration 4 opt-in identity/contact ownership, account status/epoch, browser-bound one-use proof, safe session metadata and application security events; provider lifecycle is incomplete |
| `user_settings` | Small scalar preferences/demo plan fields, recognition, monotonic mutation revision. Demo plans are not financial facts |
| `user_resources` | One owned row per read marker, bookmark, review item, activity day, enrollment, or watched resource; unique `(user_id, kind, resource)` and explicit order |
| `targets`, `stories`, `attempts`, `quiz_attempts` | Independent owned records; unique `(user_id, id)`, JSONB object with matching ID, bounded payload, position, revision, timestamp |
| `completion_records`, `tutor_messages` | Owned certificate/message records rather than account-blob fields |
| `mock_sessions`, `custom_quizzes`, `study_plans`, `project_workspaces` | Independently persisted premium records with existing answer/file/order semantics |
| `posts`, `votes`, `follows`, `comments`, `support`, `gifts` | Existing local workflows moved to PostgreSQL, with owner/relationship constraints and resource indexes |
| `schema_migrations` | Release version, immutable migration name/checksum, application time |
| `durable_operations`, `verified_event_inbox`, `job_operator_events` | W07 immutable operation input/idempotency, atomic verified-event delivery and replay accountability; separate maintained queue schema owns transport |
| `legacy_imports`, `legacy_state_snapshots` | Import fingerprint/count report and original `legacy-v1` JSON bytes/checksum; historical snapshots are never entitlement authority |

Record JSONB is a bounded **single-resource payload**, not a whole-account JSON
document. Child diagram nodes, mock turns, quiz answer maps, plan tasks, and
bounded project files remain within their parent record at this checkpoint.
Record payloads are limited to 2 MiB in SQL and validated against typed
collection/file limits before application writes. Private large/binary artifacts
and normalized financial/provider data belong to later packages.

Owned records reference `users` with cascading removal. Comment reply constraints
are deferred within transactions to preserve parent relationships during import.
Gift redeemer references do not clear on deletion, which would resurrect a
redeemed code; the later deletion coordinator must explicitly remove local gift
references. Support account references may detach, but this is **not** the
complete privacy-deletion policy; ticket content/email require W10 processing.

`StateRepository` reconstructs the current `UserState` response as a compatibility
projection. Routes do not accept a wholesale account replacement. A mutation
locks the owner, reads the current projection, validates the callback's result,
and applies only inserted/changed/removed resource rows. Unchanged owned records
are not rewritten. The owner lock serializes independent replica writes and
consistent reads. No transaction spans a provider request.

Full-state responses and owner-level serialization are intentionally retained
to preserve existing client workflows. Scoped/paginated history endpoints and
finer resource locks are still needed before claiming the final response-size,
throughput, and latency targets. Do not call this checkpoint a measured SLO.

## Atomic writes and editing revisions

Signup writes user, initial records, and session together. A session cookie is
issued only after commit. Password replacement, old-session revocation, and new
session creation share one transaction. Post publishing and recognition commit
together. Vote/follow toggles serialize by user. Gift redemption locks the code
and commits its one-use marker with the demo state mutation.

Premium access is checked again inside mutations, including after provider
grading. An expired plan cannot be revived by a late grading response.

| Operation | Required edit proof |
| --- | --- |
| New attempt/story/plan | Server assigns initial revision `0` |
| Existing `POST /api/attempts` | `id` and `revision`; server verifies owner, problem identity, and current revision before replacing the draft |
| Existing `POST /api/stories` | `id` and `revision`; stale replacements fail without changing saved content |
| `POST /api/study-plans/:id/reflection` | `taskId`, `note`, and parent plan `revision` |
| Mocks, custom quizzes, project workspaces | Existing required revision contracts remain, now protected by shared database transactions |
| Attempt grading | Saved snapshot must remain unchanged; successful grading also increments attempt revision |

Legacy records without a revision are treated as revision zero. New clients
send zero explicitly for such edits. Missing required revisions return `400`;
stale revisions return `409`. UI failures retain unsaved editor text. Current
messages instruct the user to reload the saved version; automatic merging is
not attempted. Explicit intentional deletion retains its existing API.

## Controlled migrations

The [W05 content checkpoint](10-content-implementation.md) adds migration 2
for immutable assessment snapshots and owned topic-session progress. The explicit
importer now validates and copies selected-owner quiz versions/progress as well;
referenced content must be byte-identical, and no authentication sessions or
demo entitlements are imported. Migration 1 remains unchanged.

The [W07 durable-job checkpoint](11-jobs-implementation.md) adds application
migration 3 and a separately maintained `<application_schema>_jobs` schema.
`db:migrate` explicitly installs both boundaries; API startup never installs
the queue. Application and queue migration transactions are separate, and a
queue installation failure exits nonzero and must be resolved before promotion.
Backups must include both schemas. Released migrations 1 and 2 are unchanged.

Use a separately authorized migration credential, not a broadly privileged API
credential. Run migrations once in the release/maintenance workflow, before
replicas start. PostgreSQL 16 is the tested baseline.

```bash
npm ci
npm run build
# Supply DATABASE_URL through a private environment or secret manager.
npm run db:migrate
npm start
```

Migrations acquire a transaction-scoped advisory lock, validate every applied
name/checksum, and apply pending versions atomically. Concurrent runners
serialize. A changed or unknown applied migration fails explicitly. Never edit
an already released SQL definition; add the next numbered migration instead.
The runtime refuses missing, changed, incomplete, or unsupported history.

Pool settings do not disable TLS verification. Use the managed provider's
verified TLS connection configuration and validate connectivity/certificates
in staging. Nothing in the local fixture is evidence of managed TLS, HA, PITR,
least-privilege deployment, or disaster recovery.

## Explicit legacy import

**Do not run this against customer data without D05 approval.** First agree
which accounts/contributions migrate and how ownership will be verified.
Existing local emails are unverified. Never merge accounts by email or turn a
demo plan into a paid subscription.

The importer is a read-only dry run unless an exact report fingerprint is
provided. Input must be an operator-approved, decrypted **maintenance backup**,
not an automatically discovered application data path. Keep the original
backup encrypted, access-restricted, and retained under the approved policy;
restrict and remove decrypted staging copies after reconciliation.

```bash
# --user repeats for each approved non-demo account UUID.
npm run db:import -- --source /approved/maintenance-backup.sqlite \
  --user approved-account-id

# Review the count/exclusion/checksum report and approve its fingerprint.
npm run db:import -- --source /approved/maintenance-backup.sqlite \
  --user approved-account-id --apply exact-dry-run-fingerprint
```

The dry run uses a consistent SQLite read transaction, verifies database
integrity/foreign keys, validates typed state, and rejects unknown fields,
duplicate IDs, incompatible relational columns, and reply relationships outside
the approved allowlist. It does not normalize away invalid source data.
Report output contains counts/checksums, not emails, source text, passwords,
or session tokens.

Applying runs one PostgreSQL transaction. It inserts selected users/resources
and contributions, reconstructs each state for canonical reconciliation, and
stores the original JSON string byte-for-byte with a checksum. Any failure rolls
back users, records, and the import marker. A replay fails rather than replacing
newer records. Existing target user/email collisions fail; no upsert/merge occurs.

Excluded authority is deliberate and visible:

- All demo accounts and unselected real accounts are excluded.
- Password hashes and sessions are not imported. Imported users cannot use
  local password login and require the later verified recovery/linking flow.
- Gifts are not imported. Every imported current state is Free with no expiry.
  Original historical plan fields survive only in the non-authoritative snapshot.
- Samples and unselected contributions are counted as excluded. Vote/follow
  relationships import only when both the account and post are selected.
- Anonymous support submissions have no approved account owner and are excluded.

Do not cut over imported users before W04 implements verified account recovery.
This checkpoint preserves their work; it does not prove their ownership.

## Rehearsal and cutover safeguards

1. Freeze writes during the approved maintenance window. Create and integrity-check
   an encrypted source backup. Record the account allowlist and business exclusions.
2. Migrate an isolated target using the intended release. Run the dry run and
   approve exact counts/checksums. Resolve every rejected field/relationship.
3. Apply, reconcile selected states/contributions, inspect rendered historical
   reports, and verify project bytes/patches. Test verified identity recovery
   before customers receive access. Record the intentionally excluded authority.
4. Switch configuration and invalidate legacy sessions. Verify fresh writes,
   restart, export, permission boundaries, provider reconciliation, and rollback
   decisions with the operated staging release.

There is no automatic reverse migration. Before PostgreSQL accepts any new
customer/payment write, operators may abandon the empty target and retain the
unchanged SQLite source. **After new authoritative writes, never point the
service back at stale SQLite.** Use forward repair or restore/reconciliation
with an explicitly approved maintenance plan.

## Engineering evidence and remaining gates

`tests/database.test.ts` creates and removes a unique schema in the explicitly
configured test database. It covers controlled migration races/history
rejection, async SQLite rollback, all owned collections/source bytes, FK and
owner isolation, unchanged-row preservation, two-pool mutation races,
two-instance signup/draft/story/gift races, restart/DTO parity, and importer
validation/reconciliation/replay/rollback.

```bash
# Use a dedicated PostgreSQL instance, never the production database.
TEST_DATABASE_URL=postgresql://fixture-user:fixture-password@127.0.0.1:5432/fixture \
  npm run test:db
```

Missing test configuration fails rather than skipping integration tests.
Existing domain, runtime-only deployment, provider-fixture, and browser
regressions remain required. Live-data migration approval, managed operations,
verified identity, billing/entitlements, private content, complete export/deletion,
and launch validation are not satisfied by this package.
