# Owner deletion request and cooling-off foundation

**Status:** implemented as a bounded W10 foundation. This checkpoint does not
claim completed account erasure.

## Delivered boundary

Migration 28 adds `privacy_deletions`, an owner-scoped immutable request ledger.
A fresh active managed session may create one open request with a UUID request
key. Admission atomically:

- records the database-clock request and seven-day cancellation deadline;
- changes the managed account to `deletion-pending`;
- increments account and session authority revisions;
- revokes every other Studio session;
- preserves only the requesting browser as a restricted cancellation session;
- records `deletion-requested` security evidence.

`deletion-pending` sessions cannot use product, billing, export, community-write
or staff routes. The owner can read only the deletion status, sign out, contact
support, or freshly prove a connected identity to cancel. A lost browser may
sign in again with an already connected identity, but receives the same
restricted account state rather than active product authority.

## API

```text
POST /api/privacy/deletion
GET  /api/privacy/deletion
POST /api/privacy/deletion/cancel
```

Creation accepts only:

```json
{ "requestId": "owner-supplied-uuid" }
```

Cancellation accepts the exact active request ID. Both mutations use managed
CSRF and canonical-origin checks. Creation and cancellation require
authentication from the last ten minutes. Cancellation is accepted only before
the database-clock deadline and atomically restores `active`, moves session
authority again, keeps only the proving browser, and records
`deletion-cancelled`.

The Account screen uses an inline `DELETE` confirmation, not a dialog. While
pending, the normal account/product controls are replaced by deadline, status,
fresh-proof and cancellation controls.

## Due coordinator behavior

The separate `privacy:worker` and one-pass `privacy:process` commands sweep due
requests. A due request is bound once to an owner-scoped `privacy.delete`
durable operation. The worker does **not** erase the user or publish completion.
It immutably moves the request to `blocked` with these explicit blockers:

- `billing-cancellation-unapproved`;
- `processor-erasure-unavailable`;
- `retention-policy-unapproved`;
- `backup-restore-reconciliation-unavailable`.

This terminal blocked publication is deliberate. Repeated queue sweeps cannot
duplicate work, blocked requests cannot be cancelled or reopened, and the
account remains `deletion-pending`.

## Persistence invariants

- `(user_id, id)` is the request identity.
- A partial unique index permits at most one cooling-off or blocked request per
  owner.
- `cancel_before` is exactly `requested_at + interval '7 days'`, derived from
  one PostgreSQL clock value.
- The trigger permits only timely cancellation, one due operation binding, and
  one blocked publication.
- Cancellation never revives a blocked request.
- Existing migrations 1-27 remain unchanged.
- Owner exports include deletion-request history but not durable job internals.

## Operation

```bash
npm run privacy:process
npm run privacy:worker
```

The commands require managed identity, controlled PostgreSQL, migration 28 and
the maintained queue schema. The web process does not run the coordinator.
Operators must alert on overdue cooling-off rows without an operation and on
blocked requests awaiting approved integrations.

## Verification

Automated coverage proves:

- fresh-authenticated admission and CSRF enforcement;
- peer-session revocation and restricted current-session survival;
- product/export denial while deletion is pending;
- restricted sign-in after losing the original browser;
- stale-proof rejection followed by hosted reauthentication;
- fresh cancellation and active-authority restoration;
- due operation idempotency and immutable blocked publication;
- continued presence of the owner row and explicit absence of an erasure claim;
- in-page browser request/cancellation with no dialog.

## Explicitly not delivered

No product data is physically deleted by this checkpoint. It does not provide
authentic billing cancellation, refunds, provider-account erasure, helpdesk or
email notices, legal holds, approved financial/audit retention, public-content
anonymization, object-store cleanup, backup expiry, deletion-manifest replay
after restore, processor completion evidence, or a final deletion notice.
Those authorities must be integrated and approved before a request may gain a
`completed` state.
