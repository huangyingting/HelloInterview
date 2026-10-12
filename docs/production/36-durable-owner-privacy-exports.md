# 36 - Durable comprehensive owner privacy exports

**Status: bounded W10 engineering checkpoint; approved retention, processor
erasure, external delivery and account deletion are not complete.**

Migration 27 replaces the managed account's synchronous preparation-only
download with an owner-scoped durable export lifecycle. Apply controlled
**migration 27 and the maintained queue migration** before starting this
release. Run an explicit privacy worker; the web process does not silently
perform private background work.

## Shipped boundary

- An active verified managed account must confirm its identity within ten
  minutes before requesting or downloading an export.
- `POST /api/privacy/exports` accepts only a UUID request ID. The UUID binds one
  owner, one `privacy.process` durable operation and one export row; exact
  same-owner replay is idempotent and another owner receives an independent
  owner-scoped request even if it supplies the same UUID.
- `GET /api/privacy/exports` returns at most ten owner-only statuses:
  `requested`, `processing`, `ready`, `failed` or `expired`.
- `GET /api/privacy/exports/:id/download` rechecks fresh owner authority and
  artifact SHA256/byte length before returning JSON.
- The worker locks current owner authority through the durable-job completion
  transaction. Suspension, deletion, session epoch movement or loss of the
  current account before publication prevents a ready artifact.
- Ready artifacts are inaccessible after 24 hours. The operated privacy worker
  sweeps expired rows and erases artifact bytes/integrity values while retaining
  minimal request/ready/expiry status metadata. No bearer URL, email
  notification or external object store is fabricated.
- The managed Account screen uses in-page request, refresh, status and download
  controls. No modal workflow or automatic download is used.

The old `GET /api/export` remains only for local SQLite accounts. Managed
requests receive `410` and must use the durable privacy workflow.

## Export contents

The versioned `interview-studio-owner-export-v1` artifact contains:

- profile, managed-account state, connected identity metadata, non-secret
  session metadata, security events and the owner's own staff-role history;
- complete saved preparation state, versioned assessment sessions and any
  owned legacy state snapshot;
- current access view, owned grant history and minimized entitlement events;
- owned AI usage windows/reservations/events and still-owned private input
  snapshots;
- owned posts, comments, revisions, votes, follows and minimal comment
  submission receipts;
- owned support request bodies and contact addresses;
- customer-visible sandbox checkout, subscription, invoice, cancellation and
  resumption history.

The artifact excludes session tokens, CSRF hashes, password material, provider
credentials, hosted checkout/Portal URLs, internal job IDs/hashes, entitlement
source keys, operator references and all other users' records. Billing history
is explicitly labeled sandbox evidence rather than proof of live payment.

## Migration 27

`privacy_exports` stores the owner, durable operation, state, timestamps,
bounded JSON artifact, byte count and SHA256. A database trigger permits only
one `requested` to `ready` transition and one post-deadline `ready` to
`expired` erasure; ready artifacts cannot be replaced or erased early.
Account deletion cascades its artifact rows. The durable operation remains
retired evidence without owner authority under the existing operation policy.
Published migrations 1-26 remain immutable.

## Operation

```bash
npm run build
npm run db:migrate
npm run privacy:process
```

`privacy:process` drains currently queued export work and exits only when no
unfinished privacy operation remains. Operated deployments may instead run:

```bash
npm run privacy:worker
```

The long-running worker supports SIGTERM/SIGINT drain. Failure reports no
success-shaped artifact; inspect the existing private queue diagnostics before
requesting or reviewing replay. Generic job replay remains governed by the
durable-operation runbook.

## API

```text
POST /api/privacy/exports
GET  /api/privacy/exports
GET  /api/privacy/exports/:id/download
```

Request body:

```json
{ "requestId": "92fd84de-e107-4d1f-bf01-9e949e98cb19" }
```

Example status:

```json
{
  "id": "92fd84de-e107-4d1f-bf01-9e949e98cb19",
  "status": "ready",
  "requestedAt": "2026-10-13T00:00:00.000Z",
  "readyAt": "2026-10-13T00:00:01.000Z",
  "expiresAt": "2026-10-14T00:00:01.000Z",
  "bytes": 18244,
  "sha256": "..."
}
```

Canonical-origin, CSRF, no-store, active-account and current-session controls
remain shared with managed APIs. Status reads do not disclose artifact content.

## Verification required per release

Automated evidence covers fresh-auth and CSRF admission, exact request replay,
cross-owner denial, worker publication, artifact immutability/integrity,
24-hour expiry, restriction before claim, comprehensive domain fixtures,
exclusion of bearer/security/worker internals, migration compatibility,
runtime-only compiled CLI, in-page browser behavior and fixed Entry/Landing/
Auth graph budgets.

## Explicitly not shipped

- No approved seven-day/object retention policy; the implemented artifact
  lifetime is a 24-hour product boundary, not legal approval.
- No encrypted external object storage, signed bearer link, verified-email
  delivery, download notification or delivery SLA.
- No account deletion request, cooling-off period, legal hold, processor
  erasure, backup deletion manifest or deletion-on-restore reconciliation.
- No paid-account deletion/cancellation completion and no public-launch
  approval.

Continue W10 in [the roadmap](07-delivery-roadmap.md) and
[#11](https://github.com/huangyingting/HelloInterview/issues/11). This bounded
checkpoint is tracked by
[#29](https://github.com/huangyingting/HelloInterview/issues/29).
