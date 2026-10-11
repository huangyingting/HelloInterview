# 02 - Target architecture

**Status: proposed.** Builds on the [observed baseline](01-readiness-assessment.md).
The initial target is a reliable single-region service, not a distributed
microservice platform.

**Implemented foundation (W01):** application composition, SQLite opening,
validated configuration, and HTTP process lifecycle now live in separate
`server/app.ts`, `server/database.ts`, `server/config.ts`, `server/application.ts`,
and `server/runtime.ts` modules. `server/index.ts` is the CLI entry point.
The build emits a Node.js server bundle outside the public frontend directory;
Vite is dynamically loaded only for development.

**Implemented persistence checkpoint (W02):** `server/db/` provides asynchronous
SQLite/PostgreSQL connections, controlled checksum-verified migrations,
owner-scoped learning records, atomic mutations, draft/story/reflection
revisions, and a dry-run-first legacy importer. The existing full-state response
DTO is retained as a transitional read projection, not a PostgreSQL account
blob or browser-authoritative write. See the
[implementation and cutover runbook](08-persistence-implementation.md).
Managed identity, scoped/paginated response APIs, private artifact storage,
financial facts, and durable jobs below remain later packages.

## Architecture decisions

| ADR | Recommendation | Reason / alternative / revisit trigger |
| --- | --- | --- |
| ADR-01 | Retain React/Vite and Express; extract domain modules | Avoid rewriting functional UX. SSR migration is unnecessary for accounts/billing; selectively prerender public discovery pages later |
| ADR-02 | Managed PostgreSQL as the transactional source of truth | Shared transactions, constraints, managed backups, and workers. Retaining SQLite is reasonable for offline demos, not the proposed multi-instance paid service |
| ADR-03 | Managed identity through a server-side OIDC integration | Delegate passwords, verification, recovery, MFA and social-provider maintenance. Self-hosting identity requires additional dedicated ownership |
| ADR-04 | Stripe-hosted Checkout and Customer Portal | Avoid handling card data and rebuilding billing UI. A merchant-of-record alternative must be evaluated if business jurisdiction/tax ownership makes Stripe unsuitable |
| ADR-05 | Separate billing facts from application entitlements | Payments determine eligible grants; app policy controls feature access. No provider call on every page load and no browser-owned premium flag |
| ADR-06 | PostgreSQL-backed durable jobs and transactional outbox | One durable substrate at launch. Use a maintained queue implementation with leases/retries rather than inventing one; add a separate broker only with measured need |
| ADR-07 | Private object storage for exports, media, large snapshots | Keep binary/large artifacts out of account rows; authorize before signing short-lived download URLs |
| ADR-08 | Versioned, server-owned content with public metadata projection | Paid bodies and quiz keys cannot remain in browser imports. Keep Git-based authoring first; a CMS is optional later |
| ADR-09 | Server-owned opaque sessions; no browser-stored provider tokens | Central revocation, account-status checks and same-origin API; validate identity on the backend |
| ADR-10 | No server execution of user code at launch | Keep browser examples and their limitations. A remote judge needs its own isolation architecture and independent review |

Auth0 and Stripe are reference vendor choices pending the decision register.
Do not build a universal multi-vendor abstraction. Keep small domain-facing
boundaries for identity assertions, billing reconciliation, email delivery, and
AI requests; use the selected vendors' supported SDKs inside them.

## Deployment and trust boundaries

```text
                         Internet
                             |
                     DNS / TLS / edge
                  WAF + coarse rate limits
                             |
                 same-origin routing boundary
                   /assets     /api, /auth
                      |             |
                 public CDN    Express API replicas
                               + static SPA fallback
                               + domain services
                                      |
                    +-----------------+-----------------+
                    |                 |                 |
               PostgreSQL       private objects    identity broker
               HA + PITR        exports/media      Google/GitHub/email
                    |
              job/outbox tables
                    |
              worker deployment --------------------+
              same code/release                     |
                    |                               |
              Stripe / email / AI             audit + metrics

Stripe --> HTTPS webhook --> durable event inbox --> billing worker
Email/identity events --> verified adapter --> lifecycle jobs
```

Public CDN objects contain only explicitly public assets and metadata. Private
content and user responses use `Cache-Control: private, no-store` at launch.
Do not cache them under public URLs or share personalized bootstrap responses.
Object storage is private by default; signed URLs are bearer access and have
short expiry, no indexing, and no public bucket listing.

Run at least two API replicas for paid launch, with graceful draining. Workers
can have multiple replicas, but per-resource jobs require concurrency control.
Use managed multi-zone database availability within one region. Cross-region
active-active writes, Kubernetes, Kafka, a data lake, and a vector database are
not prerequisites.

The API and worker have distinct service credentials and least-privilege access.
Only workers performing billing reconciliation need billing-write credentials;
route-side checkout creation gets the smallest supported credential scope.
Outbound AI/identity/payment hosts are configuration-controlled, not user input.

## Code organization and module ownership

Proposed boundaries, not a requirement to create empty files in advance:

```text
server/
  app.ts                 middleware and route composition
  index.ts               configuration validation and process lifecycle
  modules/
    identity/            OIDC callback, sessions, verified identity mapping
    accounts/            profile, preferences, privacy lifecycle
    billing/             checkout, portal, event inbox, reconciliation
    entitlements/        grants, capability policy, usage reservations
    content/             metadata, authorized versions, publication
    learning/            progress, quizzes, review, completion records
    practice/            attempts, mocks, stories, plans, projects
    ai/                  jobs, provider calls, evaluation provenance
    community/           posts, comments, reports, moderation
    support/             tickets, notification orchestration
    admin/               role checks and audited administrative commands
  db/                    migrations, repositories, transactions
  jobs/                  worker handlers and outbox delivery
shared/
  contracts/             safe request/response schemas and enums
  domain/                pure client-safe display/progress helpers
content/                 server/build-time authoring sources
src/                     existing UI, incrementally adapted to contracts
```

Modules call application services, not each other's HTTP endpoints. Shared
transaction contexts allow billing facts, grants, audit events and outbox rows
to commit together. Do not let every module write arbitrary user-state JSON.
Use runtime schemas for untrusted inputs and separate public DTOs from database
entities. TypeScript types alone are not request validation.

`shared/catalog.ts`, `shared/courses.ts`, and `shared/domain.ts` currently mix
browser-safe logic with answer-bearing material. Move grading, private content
and rubric internals into server-only imports. Export metadata deliberately.
Add build checks that reject private-content imports from the browser graph.

## Core data model

UUIDs identify application records; all operational times use UTC timestamps.
Use database foreign keys, unique constraints, checks, and indexes, not only
application validation. JSONB is appropriate for bounded diagrams/answers, not
for an entire user's unrelated state. Store currency amounts in integer minor
units with an explicit currency; do not assume all currencies have two decimals.

| Entity / group | Important fields and constraints | Owner |
| --- | --- | --- |
| `users` | ID, display name, account status, created/deleted timestamps, session epoch; email is not the primary identity key | Accounts |
| `user_emails` | User, normalized address, verified timestamp, primary flag; uniqueness policy accounts for pending/unverified addresses | Identity |
| `identities` | User, issuer, subject, provider, linked/last-used timestamps; unique `(issuer, subject)` | Identity |
| `sessions` | Hashed token, user, expiry, idle timestamp, auth time, assurance, session epoch; revocable | Identity |
| `user_roles` | User, role, scope, grantor, expiry, reason; no role from client input | Admin |
| `preferences`, `consents` | Time zone, notifications; consent purpose/version/time/source and withdrawal | Accounts |
| `billing_customers` | Unique user/provider/account-mode association and provider customer ID | Billing |
| `checkout_attempts` | User, approved price key, request hash, idempotency key, provider session, expiry, state | Billing |
| `subscriptions` | Provider subscription ID, user/customer, status, price, periods, cancellation state, last reconciliation | Billing |
| `invoices`, `payments`, `refunds`, `disputes` | Provider IDs, linkage, amounts/currency/status; unique external IDs; no raw card data | Billing |
| `billing_events` | Provider/account/mode/event ID unique, payload version, received/processed times, attempts/error, encrypted restricted payload | Billing |
| `entitlement_grants` | User, capability, source/type/ID, start/end, revocation, policy version; unique source grant identity | Entitlements |
| `usage_buckets`, `usage_reservations`, `usage_events` | User, feature/window, limit/consumed/reserved; request uniqueness, result/cost references | Entitlements |
| `content_items`, `content_versions` | Stable ID, type, track, publication/access policy, immutable version, review/source metadata | Content |
| `course_versions`, `course_steps` | Ordered references to immutable content versions; stable course ID and version | Content |
| `progress`, `bookmarks`, `enrollments`, `activity_events` | User-scoped unique resource keys; course-version binding; semantic learning events | Learning |
| `quiz_sessions`, `quiz_answers`, `review_items` | User, question-version order, mode, revision, finalized score; answer keys server-only | Learning |
| `attempts`, `mocks`, `mock_turns`, `stories` | User, versioned exercise, revision, status, bounded content, feedback linkage | Practice |
| `study_plans`, `plan_tasks`, `reflections` | User, schedule/time zone, pinned resources, progress references and revisions | Practice |
| `projects`, `project_versions`, `project_files` | Owner, immutable baseline, ordered revision, private object/checksum references | Practice |
| `ai_jobs`, `ai_results` | User, source/revision, quota reservation, model/prompt versions, status, provider usage/cost | AI |
| `posts`, `comments`, `votes`, `follows`, `reports` | Author/owner, visibility, moderation state, revision, unique engagement keys | Community |
| `support_tickets`, `ticket_messages`, `deliveries` | Owner/contact, status/assignee, private messages, delivery status and dedupe key | Support |
| `privacy_requests`, `audit_events`, `outbox` | Request lifecycle; actor/action/resource/reason; durable side effects | Accounts/platform |

Index every owner-scoped lookup as `(user_id, updated_at, id)` where appropriate,
plus external event IDs, job claim fields, expiry times and active-grant lookup.
Use stable cursor pagination, not client-side filtering of the full archive.
Object records include owner, content type, byte count, checksum, state and
retention metadata; an object existing in storage does not grant access.

### Authoritative and derived state

| Concern | Authority | Derived / cache |
| --- | --- | --- |
| Authentication | Validated broker identity plus active local session/account | Browser user display |
| Money / invoice status | Payment provider, reconciled into local billing facts | Account billing summary |
| Product access | Local policy applied to verified grants and account status | Bootstrap capability hints |
| Quiz correctness | Versioned server answer key | Client feedback after allowed reveal |
| Learning completion | Saved learning/practice events and pinned course rules | Dashboard summaries |
| AI result | Validated result for exact job/input revision | Current workspace preview |

Never treat browser state, checkout return parameters, client-reported test
passes, or a stale cache as authoritative billing/assessment evidence.

## API contract direction

Keep same-origin JSON APIs; a move to GraphQL/tRPC is not required. Retain useful
existing paths through migration, but stop returning the full `UserState` after
every mutation. Bootstrap should contain account/profile summary, capability
summary, unread counts, and small dashboard aggregates only.

```text
GET    /api/bootstrap
GET    /api/me
GET    /api/me/sessions
GET    /api/entitlements
GET    /api/catalog                         public metadata only
GET    /api/content/:id?version=...
POST   /api/quiz-sessions
POST   /api/quiz-sessions/:id/answers
POST   /api/quiz-sessions/:id/finish
GET    /api/attempts?cursor=...&limit=...
PATCH  /api/attempts/:id                    expectedRevision required
POST   /api/attempts/:id/evaluations         idempotency key; returns job
GET    /api/jobs/:id                        owner-scoped
POST   /api/billing/checkout
POST   /api/billing/portal
POST   /api/webhooks/stripe                 verified raw body, no cookie auth
POST   /api/privacy/exports
POST   /api/privacy/deletion
```

Example response/error shapes to standardize in runtime schemas:

```json
{
  "items": [],
  "nextCursor": null
}
```

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "This draft changed. Reload or compare your changes.",
    "requestId": "request-id"
  }
}
```

Use `401` for missing/invalid login, `403` for denied access, `404` for unknown
or other-user private resources, `409` for conflicting revision or idempotency
payload, `429` with retry/reset information for throttles/quotas, and `503` for
temporarily unavailable dependencies. Do not represent provider failure as
successful local grading. Pagination limits and payload limits are server-owned.

Browser mutations require a CSRF token and validated origin under the chosen
session policy. Webhooks use their own signature and replay protections and
must be mounted before JSON parsing changes their raw bytes.

## Consistency, jobs and failure handling

**Saving:** update a resource with `WHERE id = ? AND user_id = ? AND revision = ?`.
Increment the revision within the transaction. A zero-row update is a conflict,
not success. Apply this to ordinary attempts, stories and reflections as well
as the existing premium resources.

**Idempotency:** expensive/provider-facing creation requests carry a
user-scoped idempotency key and normalized request hash. Same key/same payload
returns the prior operation; same key/different payload returns `409`.
Uniqueness survives process restarts.

**AI job:** in one transaction verify access and revision, reserve allowance,
persist an immutable input reference, and enqueue a job. Return `202` with an
operation ID. The worker rechecks account/entitlement eligibility before
dispatch, validates output, and atomically finalizes result and quota. It
rechecks eligibility and input revision before attaching the result to an
editable record. Stale results never overwrite new work.

**Side effects:** write an outbox event in the business transaction. A worker
delivers email/provider follow-ups using idempotency keys; retries are bounded
with backoff, dead-letter state and operator replay. Delivery is at least once.
Exactly-once business effects come from constraints and state transitions, not
an assumption that jobs or webhooks only arrive once.

**Billing:** use a durable inbox, serialized customer reconciliation and fenced
worker writes as specified in [04](04-billing-and-entitlements.md). Do not hold
a SQL transaction open during slow external requests.

**Multi-tab logout/deletion:** application account state and session epoch are
checked on every private request. Jobs check current state independently of the
browser session that created them. Suspending/deleting a user blocks further
publication and provider dispatch without depending on a browser reload.

## Data migration and compatibility

The existing data directory must not be read or copied casually. Decide whether
this deployment contains any accounts to migrate, and obtain the owner's
authorization before handling those records.

1. Build explicit versioned migrations and a deterministic importer. Take an
   approved encrypted backup, record schema/app version and checksum, and prove
   restore on an isolated database.
2. Import approved users while preserving application user IDs. Mark local
   emails **unverified** regardless of syntax. Do not infer verified ownership
   from an old session or matching social email.
3. Map each `UserState` collection to its owned records. Preserve content IDs,
   quiz answer indices/order, baseline source bytes, timestamps, completion
   records and existing reports. Quarantine invalid records with a report;
   never silently drop them or normalize code whitespace.
4. Pin imported assessments to a `legacy-v1` content snapshot so later edits
   do not change past scores. Preserve existing completion as historical
   completion, not as completion of newly added requirements.
5. Retain ownership mappings for relational posts/comments/votes/follows,
   gifts and support as appropriate. Omit sample/demo accounts only under
   the approved migration policy, and reconcile orphaned records explicitly.
6. **Do not import demo plans/gifts as paid facts.** Preserve them as noncommercial
   historical metadata or approved, time-limited courtesy grants with an audit
   reason; never create billing subscriptions automatically.
7. Migrate credentials through the verified recovery/enrollment process in
   [03](03-identity-and-user-management.md). Existing sessions expire at cutover.
   Do not copy scrypt hashes into an identity vendor unless its supported import
   format has been verified and separately approved.
8. Rehearse counts, referential integrity, per-user exports, content-version
   checksums and representative report rendering. Require zero unexplained
   mismatches and a signed migration report.
9. For this small local baseline, prefer a communicated maintenance window:
   freeze writes, take the final snapshot, import, reconcile, switch routing,
   smoke-test, then reopen. Avoid dual-writing SQLite and PostgreSQL.
10. Before accepting new writes, rollback can restore routing to the unchanged
    old deployment. After reopening, never roll back to stale SQLite and lose
    new customer/payment data: use a compatible app rollback or forward repair.

During staged development, a server compatibility adapter may assemble the old
state response from normalized tables. Remove it from broad bootstrap flows
once pages use scoped queries. Do not maintain two authoritative data models.

## Capacity assumptions and growth triggers

Initial planning envelope, **not measured capacity**: 10,000 registered users,
1,000 daily active users, 100 concurrently active browsers, 50 ordinary API
requests/second at peak, and 20 queued/in-flight AI operations globally.
Provider dispatch concurrency must be bounded below its contracted rate limits.

Before launch, load-test realistic account histories and a 2x peak envelope;
measure event-loop lag, database query time/locks, connection saturation,
queue age, response size and browser performance. Heavy snapshots must not
inflate every dashboard fetch.

Add Redis only if shared rate limiting/cache pressure cannot meet targets
within the database/edge budget. Introduce a separate queue or AI service only
when measured worker load or ownership requires independent scaling. Introduce
search infrastructure only when PostgreSQL/public-content search is inadequate.
Scale decisions require measurements rather than a registered-user threshold
alone.
