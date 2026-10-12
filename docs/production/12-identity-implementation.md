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

Register exactly `PUBLIC_ORIGIN/auth/callback` as an authorization-code **GET**
callback. Request only `openid profile email`; configure GitHub's upstream
connection for identity/email, never repository access. Require RS256 ID tokens,
PKCE S256 and real broker verification semantics. Select a sandbox/private
tenant only after D01 approval; review connections, email delivery, privacy
region, pricing, subject stability and recovery behavior before provisioning.

Build, apply migration **4** with `npm run db:migrate`, then deploy matching
runtime/frontend/manifest/lockfile artifacts. Released migrations 1-3 are
unchanged. Selecting OIDC does not automatically import data or enable service
mode. Do not switch back to local/demo mode as an identity-provider outage
fallback: that is a different authority model.

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
restricted-account screens, safe errors,
disabled gifts/community/comment forms. Ephemeral test certificates use
OpenSSL; private keys are deleted with each owned fixture. No global TLS
validation/DNS changes or redirect-interception substitute is used.

`tests/identity-runtime.test.ts` checks the compiled release with runtime-only
dependencies, a trusted fixture HTTPS gateway and actual default SDK transport,
then restarts the process and verifies owned identity/session continuity.
These are synthetic engineering evidence, not proof of live delivery/consent.

**Still required before any public account beta:** approved tenant/connection
verification semantics, hosted registration/verification/recovery delivery
rehearsal, password/security-event signature verification and session-epoch
invalidation, missed-event reconciliation, approved isolated SQLite transition,
shared multi-replica abuse limits, security-change notifications, consent/terms
and policy versions, privacy/support resolution, MFA/RBAC for staff, plus W06
production authorization and W13 integrated lifecycle/recovery evidence.
The existing per-process authentication limiter is not a distributed abuse
control. Hosted recovery alone does **not** invalidate Studio sessions after a
password reset; this checkpoint must not be marketed as complete recovery.
