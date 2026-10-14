# Next.js, Auth.js and Prisma migration

## Status

Implementation is in progress. Commit `e56d67d` established the App Router and
Prisma foundation without changing the operated Azure 503 boundary. The
following checkpoint adds the Auth.js Google/Facebook admission policy and
database migration 38. It is not a launch or cutover:

- the current Express application remains the deployed artifact;
- the Next.js UI shell builds and serves deep links, but most `/api` routes have
  not yet moved to Route Handlers;
- health, readiness and visitor bootstrap now run as Route Handlers through a
  Prisma-backed compatibility interface that preserves nested transaction
  identity for existing domain repositories;
- Auth.js uses a short-lived JWT session only as a migration scaffold; durable
  database sessions, revocation, fresh-authentication and account security must
  be reconnected before participant access;
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

The temporary Auth.js JWT is limited to 30 minutes and is not the final session
authority. Before participant launch, the database-backed session design must:

- store only hashed browser tokens;
- bind each session to an available provider identity and account epoch;
- enforce absolute and idle expiry using PostgreSQL time;
- support current/other-session revocation;
- rotate or invalidate sessions on contact, account-status and security-cutoff
  changes;
- retain fresh-authentication and MFA evidence for sensitive actions;
- provide CSRF protection for application mutations;
- expose only minimized session/security history.

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
