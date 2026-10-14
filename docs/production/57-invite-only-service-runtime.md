# 57 - Invite-only service runtime

**Status: fail-closed W03/W04 engineering checkpoint; authentic Auth0, Azure
guest deployment and participant admission are not yet operated.**

This checkpoint implements
[#50](https://github.com/huangyingting/HelloInterview/issues/50). It makes the
approved private-beta authority representable as `APP_MODE=service` without
turning the local demo into a customer service or treating a configured OIDC
issuer as an invitation system.

## Service-mode startup contract

`APP_MODE=service` starts only when all of the following are true:

- `NODE_ENV=production`;
- a migrated PostgreSQL `DATABASE_URL` is configured;
- `PUBLIC_ORIGIN` is canonical HTTPS and `COOKIE_SECURE=true`;
- `TRUST_PROXY` identifies at least one explicit ingress address or private
  network;
- request telemetry remains enabled with `LOG_REQUESTS=true`;
- managed OIDC email, Google and GitHub configuration is complete;
- the separate read-only Management API client and signed password-event
  lifecycle are complete;
- `OIDC_INVITED_EMAILS` contains 1 to 200 distinct approved addresses; and
- legacy account migration, Stripe sandbox/live configuration and OpenAI/Azure
  OpenAI configuration are absent.

This is intentionally narrower than the reusable local/staging adapters.
`APP_MODE=local` can still exercise managed identity, sandbox billing and
synthetic providers independently. Service mode instead encodes the approved
clean-data, free, no-managed-AI beta and refuses contradictory authority.

The application still needs an HTTP reverse proxy because Node does not
terminate the approved public certificate. The trusted proxy must overwrite
forwarded protocol/address headers and block direct public access to the
application listener. A successful configuration parse proves only internal
consistency; it does not prove DNS, certificate renewal, NSG/firewall rules or
secret-file permissions on `WebStack`.

## Private invitation configuration

`OIDC_INVITED_EMAILS` is a comma-separated operator secret, for example:

```dotenv
OIDC_INVITED_EMAILS=first.tester@example.com,second.tester@example.com
```

Do not commit this value, publish it in issue comments or put it in a frontend
environment variable. It contains participant personal data. Configuration
normalizes addresses to lowercase, rejects malformed/empty/duplicate values,
caps the list at 200, and stores only client-secret-keyed SHA-256 HMACs in the
immutable runtime configuration. Raw invite values are not returned in
bootstrap, logs, errors or database invitation records.

The invite check runs under the existing subject lock before a new `users`,
state, managed-account or session row is created. A brand-new owner requires a
broker-verified contact address whose HMAC is in the configured list.
Unverified/private-email identities and verified nonmembers redirect to a
bounded `invite` result; diagnostics contain only that safe code.

The allowlist controls **new owner creation**, not every later authentication.
An existing mapped identity continues to sign in after the operator changes the
list, and an authenticated owner may link another verified method without that
method appearing separately in the list. This avoids turning a deployment
configuration change into account deletion or recovery loss.

Email coincidence still never merges accounts. The list is not a one-time
token ledger and does not prevent an invited person from attempting multiple
provider identities with the same verified address. The private Auth0 tenant
must keep public signup disabled or otherwise restrict connections, and the
operator must monitor the small cohort. A durable invitation object, expiry,
single-use acceptance and staff invitation UI belong to any broader beta.

## Product authority retained

When service mode is valid:

- local signup, local passwords, demo accounts, plans and gifts remain absent;
- managed AI dispatch is unavailable and provider secrets are rejected;
- checkout/subscriptions remain unavailable and Stripe settings are rejected;
- managed community reads remain available while all contribution mutations
  stay denied;
- premium access can only come from existing server-side entitlement authority,
  not a demo purchase;
- lifecycle password events and reconciliation remain required; and
- readiness reports `mode: "service"` so smoke checks can distinguish the
  private service from local mode.

The browser exposes no invitation list or fingerprint. The sign-in page may
tell the current browser that its verified address was not admitted, but does
not reveal which addresses are approved.

## Deployment sequence

1. Create a private operator environment file outside the source tree with the
   exact service settings and restrictive filesystem ownership/mode.
2. Apply the current numbered PostgreSQL migrations with the migration command;
   do not edit released migrations or import local/demo data.
3. Start the exact verified release image and the identity reconciliation
   worker using the same service configuration.
4. Keep the application listener private. Terminate HTTPS at the reviewed edge,
   set the exact proxy allowlist, and check canonical-origin rejection from both
   trusted and untrusted paths.
5. Verify readiness reports service mode, bootstrap reports AI/commerce
   disabled and community read-only, an uninvited synthetic account is denied,
   and one explicitly approved tester can complete verification, reset,
   sign-in, sign-out and recovery.
6. Record the participant notice, release SHA, image/artifact digest, operator,
   invite count (not addresses), smoke results and rollback decision.

Never copy a production environment into CI or an issue. Rotation of the OIDC
client secret recomputes invitation HMACs at restart from the private raw list;
all replicas must receive the same current configuration.

## Acceptance and remaining gates

Automated acceptance covers configuration contradictions, immutable
non-reversible invite fingerprints, no-row denial for an uninvited identity,
continued existing-owner access and the compiled service runtime's capability
boundary. It uses synthetic PostgreSQL/OIDC fixtures and does not contact a
real participant or vendor.

Before external testers are invited, W03/W04 still require:

- a real private Auth0 tenant and reviewed plan/region;
- exact callback/logout URLs and email/Google/GitHub connection configuration;
- authentic verification and reset delivery plus password-event/reconciliation
  evidence;
- the private `WebStack` environment, TLS/proxy/NSG and secret-injection review;
- participant-facing controller, age, retention/deletion and no-durability
  notice;
- guest PostgreSQL startup/capacity/role checks and clean reset procedure;
- scoped cost monitoring; and
- recorded invite-cohort smoke and support evidence.

Configuration acceptance must not be described as authentic identity recovery
or deployed beta acceptance.
