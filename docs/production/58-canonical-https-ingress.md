# 58 - Canonical HTTPS ingress

**Status: operated W03 ingress checkpoint; the application runtime and private
beta are not yet deployed or open.**

This checkpoint implements
[#51](https://github.com/huangyingting/HelloInterview/issues/51) for the approved
canonical origin:

```text
https://interview.genisisiq.com
```

## Verified topology

Public DNS resolves the exact hostname to the existing Azure Southeast Asia
`WebStack` VM. The address and subscription/resource identifiers are not
published in repository or issue evidence. Azure effective network policy
admits public HTTP/HTTPS while denying the reserved application port and
PostgreSQL from the public Internet.

The Ubuntu 24.04 guest already operates Caddy 2.11.7 for sibling sites.
`deploy/azure-vm/interview.caddy` adds the Interview Studio site through the
existing `/etc/caddy/sites/*.caddy` import. Caddy obtains and renews the public
certificate and redirects HTTP to HTTPS.

## Edge contract

The site proxies only to:

```text
127.0.0.1:10006
```

The address is loopback and the port is not admitted by Azure public ingress.
The future application service must use:

```dotenv
NODE_ENV=production
APP_MODE=service
HOST=127.0.0.1
PORT=10006
PUBLIC_ORIGIN=https://interview.genisisiq.com
COOKIE_SECURE=true
TRUST_PROXY=127.0.0.1/32
```

All other service-mode identity, invite, telemetry and disabled-provider
requirements in [57](57-invite-only-service-runtime.md) still apply. Caddy is
the only trusted HTTP peer, so it must overwrite forwarded headers and the
application listener must never bind publicly.

The edge advertises gzip/zstd, removes the Caddy `Server` header, adds
`nosniff`, same-origin referrer policy and a bounded one-day HSTS policy. The
short initial HSTS age permits rollback while the private beta is still closed;
increase it only after repeated certificate-renewal and application-operation
evidence.

## Honest unavailable behavior

The service runtime is intentionally absent until authentic Auth0, private
secrets, PostgreSQL roles and participant policy facts are configured. An
upstream dial failure therefore returns:

```text
HTTP 503
Interview Studio private beta is not available.
```

It must not fall through to the generic VM page, a sibling application or
Interview Studio local/demo mode. The fallback contains no host, network,
database, identity or release details.

## Installation and rollback

Install the exact reviewed file as
`/etc/caddy/sites/interview.caddy`, owned by root and mode `0644`.

1. Preserve any prior file privately on the guest.
2. Write the new file atomically.
3. Run `caddy validate --config /etc/caddy/Caddyfile`.
4. Reload, do not restart, the existing Caddy service.
5. Verify HTTP redirects to the exact HTTPS origin.
6. Verify the certificate hostname/trust/dates, security headers and explicit
   503 fallback while port 10006 is closed.
7. After the application is ready on loopback, verify health/readiness directly
   and then the public origin; never change the edge to local mode.

Rollback restores the previous site file (or removes this new file), validates
the complete shared Caddy configuration and reloads Caddy. Do not modify sibling
site files or the global ACME account while rolling back Interview Studio.

## Remaining gates

This checkpoint proves DNS alignment, TLS termination, redirect behavior,
private upstream selection and an honest unavailable response. It does not
prove:

- the application or identity worker is installed;
- Auth0 callbacks, verification/reset delivery or lifecycle secrets;
- application/database environment-file ownership;
- a dedicated PostgreSQL database and least-privilege roles;
- guest PostgreSQL private-network policy for other VM workloads;
- participant privacy/age/retention notice;
- cost alerting, application telemetry escalation or on-call rehearsal; or
- invite-cohort smoke and rollback.

The URL is published as the canonical endpoint, but the beta remains closed
until those gates are recorded.
