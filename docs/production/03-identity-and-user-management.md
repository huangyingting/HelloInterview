# 03 - Identity, accounts and user management

**Status: feature specification with W04 implementation in progress.** Addresses GAP-01, GAP-02 and GAP-10.
Architecture and storage conventions are defined in [02](02-target-architecture.md).
The [identity engineering runbook](12-identity-implementation.md) records shipped
opt-in authentication/session/linking boundaries and explicitly incomplete
provider lifecycle, recovery, migration and launch gates.

## Product scope

Launch with Google, GitHub, and verified email/password through a managed
identity broker. Auth0 is the reference candidate; validate pricing, regional
hosting, linking, MFA, export/deletion APIs and email customization before
selection. Do not assume every feature is included in a free vendor plan.

Use hosted authentication in a same-tab redirect. Keep account management
task-focused: Profile, Sign-in and security, Subscription, Notifications, and
Privacy. Do not expose provider configuration, token management, or identity
implementation details to ordinary users.

Apple login, passkeys, passwordless email login, enterprise SSO and team
provisioning are later decisions. Staff MFA is mandatory at initial public
launch; offering optional member MFA is desirable but not a blocker if the
selected broker cannot safely support it within scope.

## Personas, states and permissions

Separate three concepts:

- **Authentication:** who signed in and with what assurance.
- **Account status / roles:** what actions the person is allowed to perform.
- **Entitlements:** which product capabilities the person may consume.

A paid subscription is not a staff role. A staff role is not automatic paid
access to somebody else's content or private preparation records.

| State | Allowed behavior | Transition |
| --- | --- | --- |
| Visitor | Public catalog/previews, pricing, legal pages, registration, protected recovery form | Starts authentication |
| Pending verification | Own minimal profile, verification resend, sign out, help; public content | Proves email ownership |
| Active Free | Private learning, saved work and free capabilities | Buys Pro or receives approved grant |
| Active Pro | Free behavior plus current entitlements/quotas | Entitlement change, not an account-status change |
| Restricted | Specific community or abuse restrictions; unrelated paid features preserved when safe | Moderator/admin action with reason and expiry |
| Suspended | No new product mutations/provider dispatch; dedicated support/privacy/billing-resolution routes after re-authentication | Authorized review/reinstatement |
| Deletion pending | Product sessions revoked; narrowly scoped deletion-status/cancellation flow only | Cooling-off cancellation or deletion execution |
| Deleted | No product login/access; legally retained records are separated from active profile | Terminal; later signup is a new account |

Email verification precedes community posting, checkout, gifts, and external AI
use. Do not let unverified addresses receive private exports or billing receipts
on another person's behalf.

## Registration and onboarding

### Email/password

1. The user chooses email registration and is redirected to the broker. Password
   handling, password policy, breached-password checks, bot defense and email
   verification belong to the broker.
2. A validated callback identifies `(issuer, subject)`. Create an internal UUID
   once, transactionally, and record verified status from trusted identity
   evidence. An unverified account has only pending-verification capabilities.
3. Verification links are short-lived, single-use and target-bound. The broker
   owns their lifecycle; the app reflects success only after trusted
   verification evidence or a fresh validated identity assertion.
4. On completion, collect display name, optional role/level and preparation goal,
   and preferred time zone. Interview date and employer target are optional.
   Keep initial onboarding short and skippable except required terms/age gates.
5. Record terms/privacy versions accepted and timestamp. Marketing consent is
   separate, optional and unchecked by default. Do not equate acceptance of
   terms with consent for unrelated tracking.
6. Resume the allowlisted internal destination the user originally requested,
   including a premium feature or pricing page. Never accept arbitrary return URLs.

Preserve typed goals/work through ordinary sign-in transitions without putting
private answers into redirect URLs. Expired verification or an interrupted
browser session has a resend/restart path, not a duplicate-account path.

### Social registration and login

```text
Browser -> app /auth/login?provider=google|github
App -> broker authorization endpoint: code + PKCE, state, nonce
Broker -> selected social provider -> broker
Broker -> app callback with one-use authorization code
App -> broker token endpoint + validated OIDC identity
App -> internal identity mapping -> active account checks
App -> new opaque session cookie -> safe internal destination
```

Use a supported OIDC library for issuer discovery, JWKS rotation, signature,
algorithm, audience, issuer, expiry and nonce validation. Store short-lived
state/nonce/PKCE transaction material server-side, bind it to the initiating
browser, and consume it once. Reject unsolicited, expired or replayed callbacks.

Request only identity/profile/email scopes. A GitHub login is **not permission
to read repositories**; do not request repository scopes for authentication.
GitHub's ordinary user login is OAuth rather than a Google-style user OIDC
assertion; the broker provides the app-facing OIDC identity contract.

Provider subject identifiers, not display names or email strings, identify
accounts. A missing/private GitHub email requires a separate verified contact
email flow. Treat `email_verified` only according to the broker/connection's
documented semantics. Do not invent an address or silently treat email
availability as ownership proof.

Provider consent denial, provider outage, blocked cookies, missing email,
duplicate identity and invalid callback each get a clear, recoverable error.
Do not fall back to a local demo account or create paid access.

## Safe linking and duplicate accounts

**Never automatically merge users because their emails match**, even when one
connection supplies a verified email. A local historical email was never
verified, and an email can change ownership.

Recommended launch boundary: map multiple broker identities to one internal
user through an explicit application-owned linking flow. Do not also enable
automatic broker merging. If vendor-native linking is adopted instead, replace
this design with one authoritative mapping strategy and prove primary-subject
stability; do not operate both independently.

Linking flow:

1. Require a current session and recent re-authentication to the existing
   account. Start a link-specific, short-lived transaction bound to that user.
2. Authenticate the second identity through the broker. Require fresh proof,
   rather than trusting a typed email or a saved social profile.
3. Verify the new `(issuer, subject)` is not already linked to another internal
   account. Attach it in a transaction with a unique constraint.
4. Notify existing verified contact channels, audit the change, and rotate the
   current session. Do not duplicate progress, entitlements or billing customers.

If the second identity already belongs to another account, stop and show
recovery/support options. Automatic merging of two populated users is out of
scope: it can combine subscriptions, private drafts and deletion histories.
A later assisted merge requires proof of both accounts, conflict resolution,
billing review, a dry-run report and an audit trail.

Unlinking requires recent authentication and at least one other usable verified
sign-in method. Revoke associated tokens/sessions as supported, notify the user,
and make loss of a provider account recoverable. Never allow the last sign-in
method to be removed.

## Recovery, email changes and credential changes

| Journey | Required behavior |
| --- | --- |
| Forgot password | Generic response regardless of account existence; broker-controlled one-use reset link; per-account/IP throttling and delivery status without revealing account enumeration |
| Social-only user requests reset | Safe generic acknowledgement; route to the linked provider or verified alternate method, not an unapproved new password identity |
| Successful password reset | Revoke app sessions using a verified broker event or equivalent supported invalidation mechanism; do not assume browser logout revokes every local session |
| Password change | Recent broker re-authentication; managed credential update; revoke other app sessions and rotate current session |
| Email change | Re-authenticate, verify new address before replacing primary contact, notify old address, enforce collision policy, retain audited change metadata |
| Lost all sign-in methods | Support-mediated identity recovery with documented proof requirements and escalation; never a staff-created password or email-match override |
| Identity-provider outage | Existing locally valid sessions can continue until policy expiry, unless revoked/suspended; new login and sensitive re-auth actions fail explicitly |

Require identity-vendor support for session revocation signals or a documented
equivalent before selection. Verified password/security events increment a
local `session_epoch`; sessions with an older epoch are invalid. Reconciliation
handles missed events. Critical account status is not trusted solely from an
old identity token.

An unverified registration must not permanently reserve an address or prevent
the verified owner from recovering/registering. Define canonicalization
conservatively: trim address whitespace and normalize domain case; do not strip
plus tags or dots across all providers. Keep the original deliverable address.

## Sessions and browser security

Proposed member session policy: 30-day absolute lifetime, seven-day idle expiry,
and fresh authentication within ten minutes for linking/unlinking, email
changes, deletion, exports and sensitive billing actions. Staff sessions:
12-hour absolute lifetime, 30-minute idle expiry, MFA, and recent step-up for
privileged changes. Tune only after UX and risk review.

Use a random opaque token in a `Secure`, `HttpOnly`, host-only cookie with
`Path=/`; a `__Host-` prefix is appropriate in HTTPS production. Store only its
hash and session metadata. No provider access/refresh tokens in localStorage.

For a top-level authorization-code GET callback, `SameSite=Lax` is the proposed
policy so broker redirects can complete. This intentionally differs from the
current Strict local cookie. Pair it with CSRF tokens for every browser
mutation and a strict origin policy; do not weaken all cookies merely to fix a
callback. If the broker requires `form_post`, explicitly design its separate
transaction-cookie/CSRF behavior instead of assuming Lax will work.

Configure Express proxy trust only for known infrastructure and use a configured
canonical origin. Do not trust arbitrary forwarded host/protocol headers.
Enable HTTPS redirect and HSTS at the edge after verifying domain coverage.

Account security page:

- Current/other sessions with creation/last-use, approximate device and clearly
  qualified location where legally appropriate; no raw token display.
- Revoke one session or all others; logout revokes the current local session.
- Connected identities, verified contact status, and recent security changes.
- Clear distinction between signing out of Studio and signing out of a social
  provider; do not unexpectedly log the user out of all Google/GitHub services.

## Staff user management

The [owned support checkpoint](26-owned-support-receipts.md) provides narrowly
scoped member receipts/history and shared support-write admission. The
[staff administration checkpoint](35-mfa-staff-account-administration.md)
adds verified OIDC MFA evidence, expiring append-only role grants, exact masked
account lookup, revision-fenced suspension/reactivation, session revocation and
immutable minimal audit. It adds no impersonation, external support delivery,
private preparation access, role-management UI or completed privacy
export/deletion.

| Role | Permitted actions | Explicit exclusions |
| --- | --- | --- |
| Member | Own profile, preparation data, subscriptions and contributions | Other users' private records |
| Support agent | Masked account lookup, tickets, plan/entitlement reason, delivery status, trigger recovery message | Passwords, tokens, arbitrary private stories/code, role grants, direct ledger edits |
| Moderator | Report queue, public content hide/restore, scoped community restrictions and appeals | Billing actions and private preparation records |
| Content editor/reviewer | Draft/review/publish approved curriculum according to editorial role | User accounts, billing, private submissions |
| Billing operator | Reconcile billing, initiate policy-approved refund, view relevant invoices | Arbitrary role escalation or reading practice content |
| Administrator | Time-bounded role assignments, account suspension, approved courtesy grants, operational replay | Invisible impersonation, password access, bypass of audit |

Require MFA and explicit role provisioning for every staff account. Role grants,
account restrictions, refunds, entitlement adjustments, identity recovery and
replays require a reason and audit event. Destructive/high-value operations
require a second approval according to finance/security thresholds approved
before launch.

The implemented role CLI is deliberately out-of-band and supports only
time-bounded grants or append-only revocations. No role is granted by default.
The first checkpoint exposes account lookup to support agents and
administrators, but account suspension/reactivation only to administrators.
Other declared roles have no account-administration authority yet. Staff cannot
change their own status or another active staff account through this surface.

Do not build impersonation for launch. A user can intentionally attach a
specific report to a ticket; that gives scoped, logged support access to that
artifact, not blanket access to the account. Administrators should use
application commands, not manually edit subscription or JSON-state rows.

## Data portability, retention and deletion

The existing `/api/export` is incomplete as a comprehensive privacy export:
it covers user/state but not every relational contribution/support record.

New exports are asynchronous, re-authenticated and owner-scoped. Include
profile, identities without secrets, preferences/consents, learning history,
drafts, stories, plans, project snapshots, quiz reports, own public
contributions/comments, follows/votes, support history, and customer-visible
billing history where permitted. Exclude other users' data, internal restricted
moderation notes, credentials, hashes and provider secrets. Explain omissions.

Generate encrypted private artifacts with a 24-hour download link and delete
the export object after seven days. Notify only a verified address. The download
endpoint checks ownership before signing; audit access without logging contents.

Proposed deletion lifecycle, subject to market/legal review:

1. Re-authenticate, show exactly what is deleted/retained and how billing is
   affected, then record a request and notify the verified contact.
2. Immediately revoke product sessions, stop new jobs and prevent renewal.
   A billing cancellation job is retried/escalated until confirmed; deletion
   cannot be marked complete while future charges remain possible.
3. Allow a seven-day cooling-off period with fresh authentication through a
   restricted cancellation flow. This does not automatically resume canceled
   billing or restore revoked payment authorization.
4. Delete/anonymize active product data within 30 days of request, unless an
   applicable rule requires a shorter deadline or a documented legal hold.
   Remove identity-broker records, source snapshots, exports, AI data and
   analytics identifiers in the approved processor scope.
5. Delete private drafts/stories/code. For public posts, follow the disclosed
   choice of deletion or content anonymization; remove identifiable quotations
   and attachments where required. Do not leave stable account IDs in public DTOs.
6. Retain only legally necessary financial/audit records for the approved
   jurisdiction-specific period, with access restricted and linkage minimized.
   Backups expire on their documented schedule; replay a deletion manifest on
   any restore so deleted users do not silently return.
7. Record completion evidence and notify the requestor through the approved
   final-notice channel. Failed processor deletion remains an open tracked task,
   not a success-shaped response.

Refund eligibility is a separate policy; account deletion must not falsely
promise a refund or silently continue a recurring charge.

## Existing-account migration

Do not trust legacy local email addresses as verified identities. If no
owner-approved data migration is needed, start a clean production tenant and
retain the old app privately for export.

For approved migration, let a user prove both the legacy account and a new
verified identity in a dedicated transition flow. Preserve the internal UUID
and saved data. Email-only recovery is not sufficient to claim an old account
whose email ownership was never verified. Users unable to prove both sides
need the documented recovery process, not automatic email matching.

Keep any transition-only legacy credential verifier isolated, rate-limited,
audited and time-limited; remove it and securely retire retained credential
material after migration. Never expose the old demo-signup or plan-activation
routes in the production tenant.

## Proposed endpoints

| Endpoint | Contract / authorization |
| --- | --- |
| `GET /auth/login`, `GET /auth/callback` | Allowlisted provider/destination; SDK validation and one-use auth transaction |
| `POST /api/logout` | CSRF-protected local session revocation |
| `GET/PATCH /api/me` | Own profile; allowlisted writable fields only |
| `GET /api/me/sessions`, `DELETE /api/me/sessions/:id` | Owner checks; current-session and all-other-session cases |
| `POST /api/me/identities/link` | Recent authentication; starts link-specific transaction |
| `DELETE /api/me/identities/:id` | Recent authentication; at least one remaining usable method |
| `POST /api/me/email-change` | Fresh authentication; new-address verification workflow |
| `POST /api/privacy/exports`, `POST /api/privacy/deletion` | Fresh authentication, durable request ID, explicit status |
| `GET /api/privacy/requests/:id` | Request owner or narrowly scoped staff role |
| `GET /api/admin/users`, `POST /api/admin/users/:id/actions` | Staff permission, paginated/minimized data, typed action and audit reason |

## Acceptance scenarios

| ID | Observable outcome |
| --- | --- |
| IAM-01 | Email registration cannot post, buy or invoke external AI until verified; repeated callback/resend creates no duplicate user |
| IAM-02 | Google and GitHub login restore the same linked account on return; provider denial/missing email is recoverable |
| IAM-03 | Same-email social and legacy accounts do not auto-merge; linking proves both accounts and enforces uniqueness |
| IAM-04 | Expired/replayed callback, wrong state/nonce/audience/issuer, unsafe return URL and forged mutation are rejected |
| IAM-05 | Reset/change revokes other app sessions; lost broker events are detected by the invalidation/reconciliation mechanism |
| IAM-06 | A user cannot remove their last sign-in method or revoke another user's session; suspended users cannot enqueue new jobs |
| IAM-07 | Support/moderator roles cannot read private stories/code, grant roles or directly alter paid access; privileged changes leave an audit event |
| IAM-08 | Export is complete by the documented scope, private, expiring, and excludes other users and secrets |
| IAM-09 | Deletion blocks new work, confirms cancellation, completes processor cleanup and survives a backup-restore exercise |
| IAM-10 | Production startup fails closed if demo routes, insecure cookie settings or unsupported broker configuration would be active |

## References

- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Auth0 account-linking model and precautions](https://auth0.com/docs/manage-users/user-accounts/user-account-linking)

These describe provider/protocol behavior, not proof that a selected integration
or subscription plan meets all requirements above.
