# 12 - Managed identity engineering checkpoint

**Status: private-staging foundation implemented; W04 is not complete and public
accounts are not approved.** Auth0 remains a reversible reference candidate,
not a selected/provisioned tenant. No live identity, email, social credentials,
customer migration or vendor purchase was performed.

## Delivered boundary

The zero-configuration SQLite/local account experience is unchanged. Explicit
OIDC configuration instead uses PostgreSQL and a confidential hosted broker
with email, Google and GitHub connections. Browser passwords are not handled by
Studio for managed registration/login; the hosted broker owns their forms,
verification links and recovery UI.

This adapter implements the **Auth0-compatible connection/subject contract**,
not arbitrary broker interoperability. Email subjects use `auth0|`, Google
`google-oauth2|`, and GitHub `github|`. A signed assertion from an unexpected
connection is rejected. Another broker requires a reviewed adapter rather than
removing issuer/connection checks. Disable automatic broker email merging and
vendor-side identity linking: the application owns one authoritative mapping.

Managed mode deliberately disables local signup/password login, demo entry,
local password changes, demo purchases/gifts, production premium access and
external AI dispatch. Community mutations, including votes/follows and comments,
are read-only in the server and UI until operated moderation is ready. Public
free content and active verified accounts' free preparation remain available.
These are explicit availability gates, not pretend successful provider handlers.
`APP_MODE=service` still fails startup.

## Configuration and rollout

Use private operator-managed configuration, never frontend environment variables.
Partial or unsupported `OIDC_` settings fail startup without echoing their values.

| Setting | Contract |
| --- | --- |
| `DATABASE_URL` | Dedicated migrated PostgreSQL deployment; SQLite is not an identity-service substitute |
| `PUBLIC_ORIGIN` | Exact canonical HTTPS application origin |
| `COOKIE_SECURE` | `true`; trusted TLS termination and host preservation must actually be configured |
| `TRUST_PROXY` | Only actual proxy IPs/CIDRs; no arbitrary forwarded-origin authority |
| `OIDC_ISSUER` | HTTPS broker origin with trailing `/`; no credentials, non-root path, query or fragment |
| `OIDC_CLIENT_ID` | Registered confidential web client identifier |
| `OIDC_CLIENT_SECRET` | Private server secret, never an ID-token signing key |
| `OIDC_EMAIL_CONNECTION` | Optional connection name; default `Username-Password-Authentication` |
| `OIDC_GOOGLE_CONNECTION` | Optional connection name; default `google-oauth2` |
| `OIDC_GITHUB_CONNECTION` | Optional connection name; default `github` |
| `OIDC_LEGACY_LINK_UNTIL` | Optional explicit UTC deadline within the next 30 days; omitted means no legacy credential transition |
| `OIDC_MANAGEMENT_ORIGIN` | Optional explicit HTTPS tenant Management API origin; can differ from a custom-domain OIDC issuer |
| `OIDC_MANAGEMENT_CLIENT_ID` | Separate confidential machine client with only `read:users` permission |
| `OIDC_MANAGEMENT_CLIENT_SECRET` | Private machine-client secret; distinct client, never browser configuration |
| `OIDC_PASSWORD_HOOK_SECRET` | Private 32-byte lowercase hexadecimal HMAC key shared only with the approved password Action |

The four lifecycle settings are all-or-nothing. Omitting them preserves the
initial private identity checkpoint without password-event integration;
supplying a partial group fails startup. Never enable public accounts in that
incomplete configuration. Application readiness does not certify that an
identity worker or a tenant Action is operating.
Once security cutoffs/tombstones have been learned, the runtime refuses startup
without lifecycle configuration. Removing settings or switching to local mode
is not a way to discard persisted security authority.

Register exactly `PUBLIC_ORIGIN/auth/callback` as an authorization-code **GET**
callback. Request only `openid profile email`; configure GitHub's upstream
connection for identity/email, never repository access. Require RS256 ID tokens,
PKCE S256 and real broker verification semantics. Select a sandbox/private
tenant only after D01 approval; review connections, email delivery, privacy
region, pricing, subject stability and recovery behavior before provisioning.

Build, apply migrations **4 through 6** and the new `identity-reconcile` queue
with `npm run db:migrate`, then deploy matching
runtime/frontend/manifest/lockfile artifacts. Released migrations 1-5 are
unchanged. Selecting OIDC does not automatically import data or enable service
mode. Do not switch back to local/demo mode as an identity-provider outage
fallback: that is a different authority model.
Older binaries do not pass the migration-6 version check. Rollback requires a
forward fix or an explicitly approved consistent restore and security
reconciliation, not dropping cutoffs/tombstones or editing released migrations.

## Authorization transaction and assertion verification

`openid-client@6.8.8` performs discovery, authorization-code exchange, expected
state/nonce, PKCE, issuer/audience/authorized-party and time validation. The
adapter explicitly enables **non-repudiation checks** and pins RS256: the SDK's
TLS token-response validation alone does not guarantee signature checking.
Required discovered authorization/token/JWKS URLs must remain at the configured
HTTPS issuer, without credentials/query/fragment.

Discovery is lazy, cached per process and retried after failure. Broker network
requests have a ten-second bound and observe shutdown. Existing local sessions
do not require a broker request on every bootstrap. Provider outage is an
explicit error, never a local/demo login fallback. JWKS caching/refresh belongs
to the maintained SDK; providers must prepublish rollover keys with an overlap.
Unannounced/unknown keys fail closed during SDK refresh cooldown rather than
bypassing signature verification.

Each authorization transaction stores a hashed random state, hashed browser
binding, nonce, PKCE verifier, purpose, initiating owner/session proof, fixed
return destination and ten-minute deadline. The opaque browser binding cookie
is Secure/HttpOnly/host-only/Lax. At most eight live transactions per binding
are admitted; expired rows are pruned on new admission.

The callback atomically deletes exactly the matching live browser-bound
transaction **before** exchange. Replay, expiry, missing/tossed binding cookies
and concurrent callbacks cannot create another session. Exchange failure
consumes the attempt; the user starts again. Linking/re-authentication also
rechecks the initiating session after provider proof under the owner lock.
Provider tokens are discarded, never saved to database/localStorage or exposed
through bootstrap/export.

Only `/account`, `/dashboard`, `/pricing` and `/premium/studio` are accepted
return destinations. Browser errors redirect to the Auth page with bounded
codes and explicit restart/support guidance. Auth responses are private/no-store
with `Referrer-Policy: no-referrer`; diagnostics include request ID and safe
failure code, not callback parameters, raw tokens or provider exceptions.

## Account and contact authority

`(issuer,subject)` uniquely maps to an internal UUID. An advisory lock plus SQL
unique constraint serializes mapping creation across replicas. Email matching,
including a verified social email and a legacy email, **never merges owners**.
Internal managed rows keep the deprecated local-login `users.email` null;
actual nullable contact data belongs to `managed_accounts`/`managed_identities`.
No synthetic email address is invented, and unverified addresses do not reserve
registration/recovery authority.

For compatibility, the existing `User.email` string DTO is empty when no contact
was provided; `User.identity.status/verified` and the nullable security-method
emails carry explicit verification state. The UI labels the missing address.

Missing/private or unverified email yields `pending-verification`: minimal
profile/security/help/sign-out plus public free content, not preparation
exports, product mutations, premium or provider consumption. A fresh signed
verified primary assertion, or explicit linking of a separately verified
method, activates the same owner.

The account records an owned **contact source identity**. A later private-email
GitHub login does not erase a separately proved Google/email contact. Changing
the primary signed contact/verification invalidates older sessions through an
epoch change. Account status is read from PostgreSQL, not an old token.
Suspended/deletion-pending accounts cannot mutate product state or get a new
product session; their complete resolution/privacy journeys remain W10.

## Sessions, browser mutations and fresh proof

| Boundary | Shipped policy |
| --- | --- |
| Session cookie | `__Host-studio_session`, 256 random bits, Secure/HttpOnly/Lax, host-only, path `/` |
| Database credential | SHA-256 hash only, opaque public session UUID, identity/epoch and time metadata |
| Expiry | 30 days absolute; seven days idle; current database clock |
| Sensitive actions | Signed `auth_time` within ten minutes for linking, unlinking, session revocation and preparation export |
| Broker step-up | `prompt=login`, `max_age=0`, validated signed authentication time |
| Ordinary login | Broker SSO authentication may be at most one day old; that does not become fresh proof automatically |
| Browser mutations | Same-origin guard plus required `X-CSRF-Token`, host-only HttpOnly nonce cookie and authenticated-session hash binding |
| Session cap | 50 retained sessions per owner; new issuance prunes oldest excess/expired sessions |
| Sign-out | Revoke current Studio token and pending browser proofs; no unexpected global social-provider logout |

Local Strict cookies are not weakened; managed mode ignores their authority.
Duplicate cookie names fail validation. Bootstrap exposes only the CSRF nonce,
not a session/provider credential. Client requests attach it to every mutation,
including bodyless DELETE. Stale/missing security tokens fail explicitly without
automatic write retry.

Sign-in/step-up rotates the current browser token without deleting unrelated
devices. Account security lists owner-scoped methods, safe session timestamps,
current markers and recent application security events. A user can revoke one
owned session or all others; foreign IDs return 404. Linking preserves owner
and work, demands two fresh proofs and rejects already-owned identities.
Unlinking requires another verified method, cannot remove the current proof
method, and revokes associated sessions. Removing the contact source switches
only to the freshly authenticated verified remaining method and revokes others.

Owned state/quiz mutations and preparation export recheck current account,
epoch, expiry and session under transaction locks. Provider preparation stays
outside SQL transactions. Owned durable operations now refuse non-active
managed owners at enqueue, before worker preparation and during locked
finalization; a suspended operation cannot publish a result. System operations
still require their feature handler's explicit eligibility policy.

## Shared authentication admission

Managed authentication no longer uses the process-local limiter. Migration 5
stores atomic PostgreSQL admission buckets shared by every application replica
and preserved through restart. The established **30 attempts per 15 minutes**
budget applies across sign-in/callback, legacy proof and security mutations for
each verified request network address. Linking, step-up and session/method
revocation also share an account-security budget. Legacy credential proof adds
the same budget for the normalized submitted email, including nonexistent
accounts, so changing IPs does not reset targeted guessing protection.

Addresses are canonicalized, including mapped IPv4 and equivalent IPv6 forms.
Only the configured trusted edge can supply forwarded address authority; it
must overwrite client-supplied forwarding headers. Missing/invalid network
addresses cannot start authentication. Database errors do not trigger a
memory-only or demo fallback. Existing locally valid sessions and ordinary
reads do not depend on successful new-authentication admission.

Buckets store domain-separated HMAC fingerprints, bounded counters and window
times, never plaintext IPs/emails, cookies or passwords. The private OIDC client
secret derives the internal fingerprint key; all replicas must use the same
secret. Secret rotation intentionally starts new admission windows. These
fingerprints remain **pseudonymous security data**, not anonymous data.
Windows expire using the PostgreSQL clock; admission lazily deletes expired
rows across scopes. Quiet-period physical deletion and approved retention
still require operated maintenance in W12.

The 31st concurrent attempt is denied atomically with a bounded `Retry-After`;
excess counters saturate rather than overflow. Browser flows show rate-limit
guidance; JSON mutations return explicit 429. No automatic write/exchange retry
is introduced. This does not replace broker-native credential/recovery limits,
bot challenges, public support/community controls or operational monitoring.

## Explicit legacy transition

The deadline-gated transition proves an existing **PostgreSQL local** password
first, then a fresh verified broker identity. A short-lived credential
fingerprint prevents completing a transition after the old password changes.
Under one transaction it attaches the new subject to the original UUID,
preserves preparation records, retires the old credential/local email,
revokes legacy sessions, records an audit event and clears demo premium fields.
No demo plan becomes a subscription.

This is not an automatic account merge or customer-data importer. Already
mapped identities/collisions stop safely. The SQLite importer still excludes
passwords/sessions and requires D05 owner approval. Credential-free imported
accounts need the remaining approved isolated legacy verifier or support
proof flow; matching email is not recovery. No existing SQLite/customer data
was read or migrated for this checkpoint.

## Password and canonical security lifecycle

Migration 6 records issuer/subject security cutoffs and canonical versions,
an owner-wide authentication cutoff, method availability, and the stored fresh
requirement for browser transactions. Security authority survives an unmapped
subject or removed mapping deliberately: an old SSO assertion cannot create a
new owner simply because its previous mapping disappeared. These records are
pseudonymous personal security data, not anonymous telemetry; their approved
retention/deletion policy remains W10/W12.

### Authenticated immediate revocation

The original reference
[`server/identity/auth0-password-action.cjs`](../../server/identity/auth0-password-action.cjs)
implements the Auth0-compatible `onExecutePostChangePassword` contract. It is
**not installed in a live tenant**. An approved operator must configure its
private `STUDIO_OIDC_ISSUER`, `STUDIO_PASSWORD_EVENT_URL` and
`STUDIO_PASSWORD_HOOK_SECRET` secrets and deploy/rehearse it in the correct
database connection. The destination is exactly
`PUBLIC_ORIGIN/webhooks/identity/password-change`; its secret matches
`OIDC_PASSWORD_HOOK_SECRET`. The issuer must exactly match `OIDC_ISSUER`.

The Action sends only a version, UUID event ID, issuer, database subject,
`password-changed` kind and millisecond observation time. It signs
`X-Studio-Timestamp + "." + exact JSON body bytes` with HMAC-SHA256, uses a
five-second timeout, refuses redirects, and requires the application's explicit
`{accepted:true, duplicate:boolean}` acknowledgement. No email, password,
profile or provider token is sent. The hook accepts at most 4 KiB of uncompressed
JSON and a delivery timestamp within five minutes; malformed signatures,
foreign issuers, social-password claims and conflicting replay bodies fail
explicitly. Webhook success and parser/error responses are private/no-store.

Under the shared subject/account locks, one transaction persists the verified
inbox event, immutable reconciliation operation and maintained-queue outbox,
advances the subject cutoff, increments the owner epoch and revokes **all Studio
sessions and owned pending browser proofs** across linked methods. Concurrent
replicas/replays cause one effect; an audit/storage failure rolls everything
back and does not acknowledge delivery. Unknown-subject cutoffs are persisted
before mapping. Final login binding rechecks authority under the same locks, so
a callback passing its initial precheck cannot race a committed reset into a
replacement session.
Final binding also checks the target owner's cutoff when adding a previously
unmapped method; a fresh initiating session does not make an older second
proof acceptable. Method removal follows subject-before-owner lock ordering,
so reconciliation cannot observe a mapping removed underneath its owner lock.

The Action's observation time is a conservative revocation fence, not a claim
to reproduce the exact upstream reset time. A delayed accepted notification can
require even a subsequently authenticated Studio session to sign in again.
Signed `auth_time` must be later than both subject and owner cutoffs; second-level
broker timestamps may require starting again after the cutoff's second.
The browser's bounded security-change/restart path requests `prompt=login` and
`max_age=0`; this fresh requirement is stored and checked, not trusted from a
callback parameter. No accounts or preparation records are merged or removed.

Auth0's post-change-password trigger is **asynchronous and non-blocking**:
delivery failure does not prevent the upstream password change. It concerns
database-connection passwords, not Google/GitHub upstream password changes.
Do not infer guaranteed retries or complete Management API update coverage;
the approved tenant/runtime/event shape and every advertised recovery path
still require actual rehearsal.

### Canonical facts and missed-event recovery

The maintained OIDC SDK performs a separate machine client-credentials grant
for the explicit Management origin's `/api/v2/` audience and `read:users` scope.
Returned additional scopes are refused. Machine tokens are bounded and cached
only in process memory. The read-only profile request projects just `user_id`,
`updated_at`, `last_password_reset`, `blocked`, `email`, `email_verified`.
Transport is fixed-origin, no-follow, ten-second bounded, shutdown-aware and
limited to a 16 KiB profile response.

`updated_at` orders canonical snapshots; **it is not a password-reset proxy**.
`last_password_reset` supplies the canonical password cutoff. Contact,
verification and availability changes conservatively revoke older authority.
A blocked method becomes unavailable; an authenticated profile 404 records a
sticky deletion tombstone. Older snapshots cannot clear newer security facts,
and a later profile cannot resurrect a terminally deleted subject. 401/403,
429, 5xx, redirects, malformed/oversized bodies and network errors never become
deletion, clean facts or a demo fallback.

Before binding a verified OIDC proof, the callback reads canonical facts
outside SQL, commits learned security facts independently, then rechecks current
authority during final binding. A rejected stale/contact-mismatched assertion
cannot roll back the already learned contact change or session revocation.
Separately verified contact ownership is preserved, and staff suspension or
deletion state is never automatically reinstated. Existing locally valid
sessions do not call the broker on every ordinary read; a provider outage blocks
new authority but leaves unrelated valid sessions usable.

The web process opens the hook/producer service but **does not start a worker**.
An operator must run and supervise the compiled maintenance process separately:

```bash
npm run identity:reconcile
npm run identity:worker
npm run jobs:status
```

These use the same private lifecycle configuration and migrated PostgreSQL.
The one-pass command enqueues a paginated, minute-keyed idempotent sweep and
consumes available claims. It exits nonzero if deferred, active or failed
identity operations remain; an empty ready queue is not reported as completed
reconciliation. The continuous worker sweeps every minute and claims only
`identity.reconcile` through the maintained queue. Provider work stays outside
SQL; subject/owner locks precede operation locks, and security mutation,
canonical receipt and queue completion commit together with attempt/generation/
expiry fencing. A lease expiring inside the transaction rolls back security
publication as well.

SIGTERM/SIGINT cancel provider work, return an unfinished claim to the maintained
retry policy and close queue resources before the database. Provider or
infrastructure failure exits nonzero for an operator's supervisor/alerting;
it does not print success or silently switch authority. Inspect retry/dead-letter
backlog, worker health and last successful canonical receipts; use the existing
audited replay command after resolving the cause. Sweep capacity, provider rate
limits, restart policy, reconciliation latency and retention need approved
deployment sizing/alerts. One minute is the enqueue cadence, **not** a promised
reset-to-revocation SLA.

Provider reference contracts:
[post-change-password](https://auth0.com/docs/customize/actions/explore-triggers/post-change-password),
[production Management credentials](https://auth0.com/docs/secure/tokens/access-tokens/management-api-access-tokens/get-management-api-access-tokens-for-production),
[read user by ID](https://auth0.com/docs/api/management/v2/users/get-users-by-id).

## Evidence and remaining W04 gates

`tests/identity.test.ts` exercises maintained-SDK signatures, issuer/audience/
nonce/time/algorithm/connection rejection, planned JWKS rollover, browser-bound
one-use callbacks, concurrent replicas/subject creation, no email merging,
missing-email activation/relogin, CSRF/Origin/cookie isolation, fresh linking,
collision/unlink protection, owner-scoped sessions, expiry/epoch/status,
provider failure, paired legacy proof, cascading authority deletion and
suspended durable-result publication.

`tests/identity-browser.test.ts` uses **real HTTPS application and broker
servers**, actual 303 redirects and Chromium's Secure/HttpOnly/Lax cookies.
It covers profile CSRF, linking/unlinking, private-email recovery, mobile layout,
restricted-account screens, safe errors and disabled gifts/community/comment
forms, plus password-event revocation, rejected old SSO and fresh recovery
preserving the owner/profile. Ephemeral test certificates use
OpenSSL; private keys are deleted with each owned fixture. No global TLS
validation/DNS changes or redirect-interception substitute is used.

`tests/identity-runtime.test.ts` checks the compiled release with runtime-only
dependencies, a trusted fixture HTTPS gateway and actual default SDK transport,
then restarts the process and verifies owned identity/session/admission continuity.
It executes the runtime-only reconciliation CLI, checks non-success on an
active backlog, and runs the actual compiled worker through retry, missed-reset
revocation, receipt completion and graceful shutdown. It also rejects removal
of lifecycle configuration after persisted security authority exists.
These are synthetic engineering evidence, not proof of live delivery/consent.

`tests/identity-limits.test.ts` verifies the exact 30-request threshold through
80 concurrent attempts on separate PostgreSQL pools, restart continuity,
scope/address isolation, expiration/pruning, canonical network aliases,
replica HTTP enforcement, cross-IP legacy/security budgets, unthrottled sign-out
and unavailable shared storage.

`tests/identity-lifecycle.test.ts` covers authenticated exact-byte delivery,
replica/concurrent replay, conflicting payloads, unknown-subject cutoffs,
transactional rollback, precheck/final-binding races, real maintained claims,
blocked/deleted/stale canonical facts, contact-change persistence and lease
expiry before and during result publication. `tests/identity-contract.test.ts`
checks projected read-only requests, bounded/malformed/outage/redirect/stream
failures and the original Action's signatures, destination rules and explicit
acknowledgement.

**Still required before any public account beta:** approved tenant/connection
verification semantics, hosted registration/verification/recovery delivery
rehearsal, actual Action delivery and canonical-fact semantics, operated
reconciliation/alerts, approved isolated SQLite transition,
approved broker-native abuse/recovery controls, security-change notifications,
consent/terms and policy versions, privacy/support resolution, MFA/RBAC for staff, plus W06
production authorization and W13 integrated lifecycle/recovery evidence.
The default local/demo limiter remains process-local; managed authentication
uses the shared admission boundary above. Hosted recovery alone does **not**
invalidate Studio sessions after a password reset: the optional authenticated
hook and independently operated reconciler are required. This private
engineering checkpoint must not be marketed as complete live recovery.
