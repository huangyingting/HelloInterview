# Next.js, Auth.js and Prisma migration

## Status

Implementation is in progress. The migration checkpoints have established the
App Router, Prisma foundation, Auth.js social admission, service bootstrap,
public content/community reads, durable account security, privacy lifecycle and
owned support APIs without changing the operated Azure 503 boundary. This is
not a launch or cutover:

- the current Express application remains the deployed artifact;
- the Next.js UI shell builds and serves deep links, but authenticated writes
  and most owner/staff APIs have not yet moved to Route Handlers;
- health, readiness and visitor bootstrap now run as Route Handlers through a
  Prisma-backed compatibility interface that preserves nested transaction
  identity for existing domain repositories;
- Auth.js now issues only hashed, identity-bound managed database sessions with
  PostgreSQL-clock absolute/idle expiry, account epochs and security cutoffs;
  bootstrap-bound application CSRF, fresh reauthentication, profile updates,
  session revocation and sign-in-method removal now use Route Handlers;
- one-use, fresh-session-bound Google/Facebook linking is now explicit and
  never merges accounts by email;
- durable privacy export request/history/download and deletion
  status/request/cancel now preserve fresh-session and atomic account-state
  transitions through Route Handlers;
- owned support save/history now remains available to valid pending,
  suspended and deletion-pending sessions without granting product-write or
  staff authority;
- active-account progress, course enrollment/video completion, quiz sessions,
  quiz reports, direct quiz submission, interview targets and revision-fenced
  behavioral stories, practice drafts, local-rubric feedback, mock interviews,
  custom quizzes, study plans, project workspaces and local tutor conversations
  now use session-bound Route Handlers and the Prisma transaction authority;
- community reports, owner appeals, personal mutes and two-way blocks,
  restriction status and restriction appeals now use managed Auth.js sessions,
  CSRF, account-scoped admission limits and the existing PostgreSQL lock/CAS
  domains;
- post creation, exact desired-state votes and follows, durable comment
  submissions, direct compatibility comments and revision-fenced owner
  editing/deletion now use Route Handlers and the same transaction adapter;
- Auth.js staff sessions can now read role, exact-account, immutable-audit,
  support, moderation, appeal and restriction queues through a shared
  fresh-sign-in and recent-MFA authority;
- anonymous managed support remains fail-closed until trusted edge address
  handling can restore network-scoped abuse protection;
- staff mutations, managed-AI feedback and the remaining administrative and
  commercial surfaces still block participant access;
- Caddy must continue returning the hardened unavailable response.

## Final architecture

The completed repository will contain one Next.js App Router application plus
separately invoked worker and migration entrypoints from the same source tree.
There will be no Vite entrypoint, Express application, React Router dependency,
compatibility proxy, SQLite service mode or old compiled server runtime.

| Concern | Final owner |
| --- | --- |
| HTML, metadata, navigation and screens | Next.js App Router and React Server/Client Components |
| Browser authentication | NextAuth/Auth.js Route Handlers |
| Google/Facebook admission and linking | Studio identity domain services called by Auth.js callbacks |
| API and webhook transport | Next.js Route Handlers |
| Relational access | Prisma Client, with reviewed parameterized raw SQL for PostgreSQL-only invariants |
| Schema history | Existing checksum-verified numbered SQL migrations |
| Durable workers | Separate bounded Node entrypoints using the same Prisma transaction authority |
| Release artifact | Next.js standalone server, static assets, Prisma runtime and compiled worker/CLI entrypoints |

Next.js is the web runtime, not a reason to move business rules into page
components or provider callbacks. Route Handlers translate HTTP into typed
domain requests. Identity, billing, usage, privacy, support, community and job
modules retain their transaction and authorization boundaries.

## Frontend migration

The App Router foundation now supplies:

- `app/layout.tsx` for metadata, viewport and the shared stylesheet;
- `app/[[...studio]]/page.tsx` for direct/deep-link delivery during screen
  migration;
- a Next navigation boundary replacing all runtime React Router imports;
- standalone output and an isolated Next.js TypeScript configuration;
- `src/screens`, avoiding accidental activation of the legacy Pages Router.

The catch-all route is transitional. Screens should move to native App Router
segments where a server boundary, metadata, loading state or route-specific data
fetch provides value. Opaque community identifiers, query strings, focus
recovery and direct browser navigation must remain exact.

Vite temporarily aliases the navigation boundary back to React Router so the
pre-cutover release continues to build. That alias, `src/main.tsx`,
`index.html`, `vite.config.ts` and all React Router dependencies are mandatory
deletions before migration completion.

## Auth.js identity policy

Auth.js owns OAuth protocol transport. Studio remains the authority for invite
admission, account state, identity collisions, linking, session revocation,
fresh authentication and staff/security policy.

### Required private settings

| Setting | Requirement |
| --- | --- |
| `NEXTAUTH_URL` | Canonical HTTPS origin, or loopback HTTP only for local verification |
| `NEXTAUTH_SECRET` | 32-4096 non-whitespace characters |
| `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth confidential-client credentials |
| `AUTH_FACEBOOK_CLIENT_ID` / `AUTH_FACEBOOK_CLIENT_SECRET` | Facebook OAuth application credentials |
| `AUTH_INVITED_EMAILS` | One to 200 distinct invited email addresses |
| `DATABASE_URL` | Migrated PostgreSQL database |

Invitation addresses are normalized once and retained in configuration only as
HMAC-SHA-256 fingerprints keyed by `NEXTAUTH_SECRET`. Configuration errors name
the setting and rule without echoing submitted values.

### Provider rules

Google can create an account only when the ID-token profile contains a verified
email and that exact normalized email is invited. Email equality never merges
accounts.

Facebook cannot create a new account because its profile does not provide the
same reliable verified-email claim. A Facebook subject may authenticate only
after it has been explicitly linked from an existing verified Studio account.
The link flow must lock the account and provider subject, require a fresh Google
session, reject cross-account collisions and preserve at least one verified
contact method.

Both providers use the immutable `(issuer, subject)` identity key. Suspended
accounts are denied. Deletion-pending accounts may authenticate only for the
bounded recovery/deletion workflow. Provider access or refresh tokens are not
stored because the product does not call Google or Facebook APIs after login.

Migration 38 adds `facebook` to the existing provider constraints without
rewriting released migration history. Historical email/GitHub values remain
temporarily readable for safe transition; the final cleanup migration may
remove them only after an explicit zero-row/owner-approved data check.

## Prisma data authority

`prisma/schema.prisma` is introspected from a disposable PostgreSQL database
after applying the complete checksum-controlled migration history. Prisma
Migrate and `db push` are prohibited for this repository. Schema changes must
still append a numbered SQL migration, then re-introspect and review the Prisma
diff.

The schema currently represents all application tables. Several compound
relations require explicit logical uniqueness annotations because Prisma does
not infer that a compound key is unique when one member is already a primary or
unique key. Those annotations are client metadata only; numbered SQL migrations
remain the database truth.

Ordinary owner-scoped reads and writes should use generated Prisma models.
Parameterized `$queryRaw`/`$executeRaw` is required for:

- advisory locks and exact lock ordering;
- `FOR UPDATE` authority checks;
- PostgreSQL clock decisions;
- conditional `RETURNING` and compare-and-swap operations;
- transaction-coupled pg-boss commands;
- database features not represented by Prisma, including check constraints,
  deferred foreign keys and expression indexes.

All nested domain operations must receive the same Prisma transaction client.
Provider calls remain outside SQL transactions. A worker may publish or complete
a durable job only through the same transaction client used for its business
mutation.

The pg-boss schema remains a controlled migration concern executed through the
PostgreSQL driver because its installation is multi-statement SQL. Runtime
pg-boss commands use the Prisma-backed `Database.executeSql` transaction client;
the adapter casts pg-boss UUID comparisons and `to_regclass` reads to types
Prisma can deserialize without weakening parameterization.

## Route migration

Routes migrate by domain, not by adding a permanent catch-all proxy:

1. bootstrap, CSRF/session and account identity;
2. owned learning state and protected content;
3. community reads and writes;
4. support, privacy and staff administration;
5. AI usage/native jobs and premium tools;
6. billing callbacks, checkout and account billing views;
7. health, metrics and operational endpoints.

Each domain move includes body-size limits, schema validation, cache policy,
cookie/header behavior, request-address handling, abort propagation, error
mapping and parity tests. Webhooks preserve exact raw bytes. File delivery keeps
content disposition, MIME, range/cache and private authorization semantics.

Express registration code is deleted only after every route in that domain has
an accepted Route Handler. No Next.js rewrite or proxy may remain at final
cutover.

## Session and request security

Auth.js now uses Studio's existing managed database-session authority rather
than JWT browser sessions. The delivered adapter:

- stores only hashed browser tokens;
- binds each session to an available provider identity and account epoch;
- enforces absolute and idle expiry using PostgreSQL time;
- invalidates reads after account-epoch, identity-availability or
  security-cutoff changes;
- records authentication time while retaining a separate MFA evidence field;
- caps active sessions and deletes exact hashed sessions on sign-out;
- refreshes authentication time only after the exact provider identity is
  admitted again for the current owner;
- issues session-bound double-submit CSRF proof through bootstrap and enforces
  it on migrated account mutations;
- exposes minimized security history, exact session revocation, other-session
  revocation and guarded sign-in-method removal;
- links Google or Facebook only through a one-use database action bound to the
  current fresh owner session and exact provider subject.

Owned support now uses the same exact Prisma-backed `Database` adapter for
session authority and support transactions. Its Route Handlers preserve UUID
idempotency keys, exact payload hashes, owner-bound cursors, session-bound CSRF,
account-scoped abuse limits and `Retry-After`. Valid managed sessions retain
owned support authority while pending, suspended or deletion-pending, but this
does not grant product mutation or staff access.

Owned learning mutations now assert an active managed session before and after
the transaction, require session-bound CSRF, preserve entitlement checks for
premium progress, and record bounded daily activity with the saved state.
Quiz creation, answer fencing, completion, version-pinned reports, course
enrollment and video progress all use the same Prisma-backed adapter. State
record writes explicitly bind JSON as `jsonb`, avoiding driver-dependent
implicit casts. Interview targets enforce bounded calendar dates, while
behavioral story replacements use the saved per-record revision and reject
stale editors without overwriting newer text. Practice drafts also preserve
revision fencing, diagram bounds, problem immutability and premium capability
checks. Transparent local-rubric evaluation is migrated and idempotently grants
recognition only on the first completion. External managed-AI feedback remains
disabled until its provider and usage-ledger boundary moves together. Premium
mock interviews, custom quizzes and study plans now preserve entitlement
checks before and after mutation, revision fencing, version-pinned questions
and local-rubric provenance without granting client authority over access.
Project workspaces preserve immutable task snapshots, protected path and size
bounds, original file baselines, patch generation, revision fencing and
user-reported verification provenance; local review never claims server-side
execution.
The tutor remains explicitly retrieval-based and labels every response as
local, not AI. It searches only lessons the account may access, fences premium
matches with entitlement checks in the same Prisma transaction and retains at
most 100 messages.
Community safety controls retain UUID idempotency, immutable evidence,
non-punitive spam triage, exact-revision appeals, bounded private histories and
two-way interaction boundaries. Network-scoped admission remains fail-closed
until the trusted Caddy address contract is explicit; migrated mutations apply
the shared account-scoped limiter instead of trusting forwarded addresses.
Contribution routes preserve opaque identifiers, participation restrictions,
anonymous question attribution, mute and block visibility, immutable comment
submission receipts, owner-only revisions, tombstone deletion and atomic
recognition updates.
Staff read authority requires an active verified account, a session created
within 12 hours, activity within 30 minutes, sign-in and MFA within 10 minutes,
an unexpired role grant and account-scoped admission. Auth.js does not yet
provide the MFA enrollment/challenge flow, so this remains fail-closed unless a
session already has reviewed MFA evidence.

Before participant launch, the remaining security surfaces must:

- apply the shared CSRF/session authority to every remaining application
  mutation;
- establish explicit trusted-proxy address handling before restoring
  network-scoped identity and anonymous-support rate limits.

Next.js proxy trust must be an explicit IP/CIDR allowlist compatible with the
Caddy-to-loopback topology. Forwarded headers from untrusted peers cannot
determine secure-cookie, origin, callback or rate-limit identity.

## Build, deployment and cutover

The final CI artifact must include:

- `.next/standalone`, `.next/static` and public assets;
- the generated Prisma Client engines required by the target architecture;
- separately compiled migration, preflight and worker entrypoints;
- only allowlisted private media and no source environment files.

Container and systemd definitions will run the standalone Next.js server on
`127.0.0.1:10006`; workers remain separate services. The launch preflight must
validate Auth.js settings, all migration checksums, Prisma connectivity,
maintained queue policy and the participant policy without starting an HTTP
listener or mutating database rows.

Cutover is allowed only when:

- repository searches find no Vite, Express, React Router, Auth0/OIDC broker,
  compatibility proxy, SQLite service runtime or obsolete artifact references;
- all API/provider/browser/database/container tests pass against the exact
  release SHA;
- Google registration and login, Facebook linking/login, collision, replay,
  denial and revocation are verified with authentic provider applications;
- standalone artifact inspection and parallel Azure smoke tests pass;
- rollback preserves the hardened 503 and never falls back to demo authority.

Google and Facebook client credentials are needed for authentic-provider
acceptance, not for completing the remaining code migration.
