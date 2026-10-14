# 09 - Platform implementation and release runbook

**Status: canonical Azure ingress, exact-artifact guest image, PostgreSQL/queue
authority and cost budget are operated; the application remains disabled.**
Authentic identity secrets, approved participant policy values and human
acceptance still require evidence. No backup service was provisioned.

The canonical hostname and Caddy ingress are operated in
[checkpoint 58](58-canonical-https-ingress.md). The exact-artifact image,
database and disabled process units are installed by
[checkpoint 59](59-azure-guest-runtime-foundation.md); the conservative USD 200
budget is operated by [checkpoint 60](60-private-beta-cost-control.md).
Application startup remains blocked on authentic service configuration.

## Approved invite-only beta target

The [private-beta decision](56-approved-private-beta-boundary.md) selects the
existing running Azure `WebStack` VM in Southeast Asia, guest-OS PostgreSQL, a
USD 200 monthly application ceiling and `@huangyingting` as the deployment,
on-call and support owner. Azure management-plane verification confirmed only
the VM name, running state and region; it did not inspect guest data, addresses
or credentials.

This is a single-host beta exception, not the managed HA/PITR target described
for public or paid service. No formal RPO/RTO applies, so the beta promises no
availability, recovery time or maximum data preservation. The VM and guest
database remain one failure domain, and testers must be warned that data may be
reset or lost.

## Shipped boundaries

| Surface | Implementation |
| --- | --- |
| CI | `.github/workflows/ci.yml`: main/PR verification, read-only repository permissions, pinned actions, PostgreSQL fixture, compiled artifacts |
| Runtime image | Multi-stage, digest-pinned Node 24 Debian slim image; production dependencies only; non-root UID 1000 |
| Build context | `.dockerignore` source allowlist with explicit credential/environment/key exclusions |
| Private staging | `compose.staging.yml`: persisted PostgreSQL, one-shot controlled migrations, API startup gate, loopback-only published port |
| Configuration | Immutable `APP_MODE`, canonical `PUBLIC_ORIGIN`, proxy IP/CIDR allowlist, exact request-log boolean |
| Process checks | `/api/health` liveness; `/api/ready` database-backed readiness; graceful drain refuses new work before disposal |
| Request evidence | Server-generated `X-Request-ID`; JSON route-template/status/duration records without submitted/private values |
| Recovery rehearsal | Isolated encrypted PostgreSQL dump, integrity/tamper checks, restored schema, fresh recovery runtime, owned-state equality |
| Azure guest foundation | Exact CI artifact image, dedicated migration/runtime database roles, 37 migrations, queue schema and disabled systemd units |
| Cost control | Conservative USD 200 monthly shared-resource-group budget with staged actual/forecast owner notifications |
| Participant policy | Required public controller/contact/age/retention/deletion DTO plus fixed no-durability warning |

`NODE_ENV=production` selects compiled static serving. `APP_MODE=service` is now
available only for the approved invite-only beta composition: PostgreSQL,
canonical HTTPS/secure cookies, explicit proxy trust, request telemetry, complete
managed identity/password lifecycle and a private invite list. It rejects
legacy migration, billing and external AI configuration, and now also requires
the approved participant-policy contract from
[checkpoint 61](61-participant-policy-runtime.md). The
[service-mode runbook](57-invite-only-service-runtime.md) defines the exact
boundary. This does not configure the real tenant or application process, and must not be
weakened to expose a demonstration account/plan endpoint.

## CI and release artifacts

CI runs on pushes to `main` and pull requests. Dependencies install from the
lockfile. The build type-checks and emits browser/server artifacts. Unit,
PostgreSQL, application-lifecycle, runtime-only installation, and synthetic
provider suites run before the browser suite. CI installs Playwright-managed
Chromium; local runs continue to use Chrome unless overridden.

Docker verification follows browser verification. It builds task-owned images,
checks non-root and read-only operation, exercises persistence/restart, and
creates a uniquely named isolated compose project for migration and restore.
Fixtures use generated credentials and original synthetic preparation data,
not customer databases or live identity/payment/AI accounts.

Successful runs upload `dist/`, `dist-server/`, `package.json`, and
`package-lock.json` together under an artifact named with the commit SHA.
Artifacts do not include `.env`, credentials, source databases, node_modules,
or private user exports. Failure-only browser diagnostics contain synthetic
test data and expire after three days; compiled artifacts expire after seven.
Do not place production customer traces into the CI artifact mechanism.

GitHub Actions are pinned to verified official release commits, not movable
major-version tags. Node and PostgreSQL container bases are digest-pinned.
Update these pins deliberately and rerun the lifecycle/recovery matrix; do not
treat a pin as proof that vulnerabilities are absent. Registry signing,
attestations, scanning policy, immutable production image publication, branch
protection, and environment reviewers remain operated deployment work.

## Runtime image

```bash
docker build -t interview-studio:staging .
```

The build stage installs the locked development dependencies and compiles.
The runtime dependency stage prunes development packages. The final image
copies only runtime packages, manifests, public browser assets, and compiled
server/migration commands. It does not contain `tsx`, TypeScript, Vite, esbuild,
the original source directories, or environment/credential files.

The image starts Node directly so process signals reach the HTTP runtime.
UID 1000 owns `/app/data`; mount persistent writable storage there only when
using local SQLite. PostgreSQL mode does not require a writable application
directory. A read-only root filesystem, `/tmp` tmpfs, dropped capabilities,
and no-new-privileges are verified by the container fixture.

Container health invokes the database-backed readiness endpoint. The internal
listener binds to `0.0.0.0` for container routing; publishing/ingress controls
must restrict exposure. Do not mistake the internal listener address for
permission to open a public service.

## Private PostgreSQL staging

Supply a private `POSTGRES_PASSWORD` and a matching percent-encoded
`DATABASE_URL` whose host is `database`, port is `5432`, and database/user are
`studio`. Never commit the environment or put credentials into CI artifacts.

```bash
docker compose -f compose.staging.yml up -d --build --wait
docker compose -f compose.staging.yml ps
```

`STUDIO_IMAGE` optionally identifies the chosen image (default
`interview-studio:staging`); `STUDIO_PORT` defaults to 3000. The API is published
only on `127.0.0.1`. For isolated tests, port zero requests an ephemeral host
port. Docker may allocate a new ephemeral port on restart; resolve it with
`docker compose ... port api 3000` instead of assuming it stays constant.

The database has no host-published port. Its named volume persists across normal
stops. Database health gates the migration service; successful migration completion
gates the API. API startup still independently verifies migration history.
An incompatible migration fails rather than booting with a guessed schema.

**The compose database is a staging fixture, not managed HA/PITR infrastructure.**
Its initialization role is privileged. The final managed deployment requires
separate least-privilege API, worker, migration, backup, and administrative roles.
Repeated container restarts are not a database recovery strategy.

Do not use `down --volumes` on a database you intend to retain. That option is
used only by uniquely owned disposable recovery fixtures. Never prune shared
Docker resources as part of application deployment.

## Canonical origin and trusted proxy

For the approved private HTTPS ingress:

```dotenv
PUBLIC_ORIGIN=https://interview.genisisiq.com
COOKIE_SECURE=true
TRUST_PROXY=127.0.0.1/32
```

The application must bind to `127.0.0.1:10006`; Caddy is the only trusted peer.
Proxy trust accepts explicit IPs or non-global CIDRs only.
Booleans, hop counts, global `/0`, malformed addresses/prefixes, and hostnames
are rejected. Restrict trust to the smallest actual proxy network.

The ingress must terminate trusted HTTPS, preserve the canonical `Host`, and
overwrite forwarded protocol headers from clients. Block direct public access
to the API network. Forwarded protocol is honored only from configured peers.
Requests with the wrong canonical origin return `421`; mismatched write origins
return `403`. Host/scheme/default ports are normalized without accepting embedded
credentials or paths.

HTTPS public origins require secure cookies; secure cookies with an explicitly
HTTP public origin are rejected. Top-level health/readiness GETs remain usable
over the internal HTTP network for the orchestrator; they disclose no account
data. Initial public TLS and a one-day HSTS policy are operated at the canonical
origin. Observed certificate renewal, longer HSTS, WAF rules and the full
CSP/code-sandbox policy still require the operated edge/launch assessment.

## Liveness, readiness and draining

`GET /api/health` returns `{ "status": "ok" }` while the process is alive.
`GET /api/ready` verifies database access and returns
`{ "status": "ready", "mode": "local" }`. A database outage returns `503`;
it does not masquerade as a ready response.

Graceful shutdown marks the application draining before stopping the listener.
New work and readiness probes fail with `503`, while requests already admitted
may finish and save results within the existing ten-second grace period.
Disposal then aborts provider work and awaits connection cleanup. A stalled
provider cannot hold shutdown open indefinitely.

Use readiness for traffic admission and liveness for detecting a dead process.
Do not continuously restart healthy processes solely because the database has
a temporary outage. The managed orchestrator's rollout/disruption policy must
allow enough draining time and maintain the intended replica availability.

## Privacy-safe telemetry

Every request receives a server-generated UUID in `X-Request-ID`. Caller-supplied
IDs are not trusted. Request completion records include event name, ID, method,
matched route **template**, HTTP status, and elapsed milliseconds. Unmatched
routes are grouped instead of logging arbitrary path/query text. Closed
unfinished responses use an observational `499` status in the log.

Request bodies, cookies, authorization headers, emails, query strings, raw
provider messages, and preparation source text are not logged. Unexpected
request/readiness failures emit only the request ID and error class. Controlled
HTTP errors remain explicit responses; there is no success-shaped readiness
fallback. API responses are private/no-store; bootstrap retains its existing
no-store contract.

`LOG_REQUESTS` is exactly `true` or `false`, defaulting to true for compiled
production serving and false for development. Fixtures may disable completion
logs while testing the separate unexpected-error path. The final operated
service needs centralized restricted log storage, approved retention, alerts,
service/release correlation, measured latency/error dashboards, and worker/
provider metrics. This stdout boundary does not implement those services.

## Release promotion and rollback

1. Select the exact successful CI commit/artifact. Build or retrieve the matching
   immutable runtime image; do not combine browser/server outputs from different
   revisions. Inject approved environment/secrets outside the build context.
2. Approve and run migrations with the migration role once, then start internal
   staging. Check readiness, state isolation/save/restart, origin/proxy handling,
   and the enabled provider lifecycle matrix.
3. Verify backup/recovery and the release's backward/forward compatibility
   decision before accepting customer writes. Require environment approval
   for public traffic or live provider configuration.
4. Promote the same artifact/image, drain old replicas, verify application/
   provider reconciliation, and record the release/rollback decision.

There is no auto-deploy job or reviewed Azure IaC yet. D04/D06 now identify the
private-beta provider, region, VM, budget, owner and canonical Caddy ingress,
but secret injection, guest database composition, cost alerts and application
deployment evidence remain open.
Do not add a generic SSH deployment with unknown credentials as a substitute.

Rollback is constrained by database history. A runtime that does not support
the applied history refuses startup. Use an explicitly compatible release or
forward repair; never edit old migration checksums or point at stale SQLite
after PostgreSQL accepts new authoritative writes.

## Recovery evidence and unsatisfied requirements

`tests/container.test.ts` rehearses a consistent `pg_dump -Fc` of an isolated
staging database after saving owned preparation data. It encrypts the dump in
memory using AES-256-GCM with generated key/nonce, rejects tampered ciphertext,
decrypts and restores into a **different database**, then starts a fresh runtime
against the restored schema and compares the exact bootstrap/owned-state DTO.
All test images, containers, projects/volumes, and credentials are isolated and
removed after the test.

```bash
npm run test:container
```

This is an automated recovery **rehearsal**, not a backup service. It does not
persist customer backups, escrow keys, operate object storage/retention, schedule
dumps, collect WAL, or demonstrate multi-zone/PITR recovery. It is not evidence
of the proposed RPO <= 15 minutes, RTO <= 4 hours, or 99.9% availability.

Before operated customer recovery, approve and provision encrypted backup/
key storage, least-privilege roles, WAL/PITR where required, monitoring and
restore ownership. Rehearse the actual managed target, media/object integrity,
deletion replay, and post-restore identity/billing reconciliation. Privacy and
financial restoration rules depend on W04/W08/W10 and remain launch gates.
