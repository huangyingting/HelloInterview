# 35 - MFA-gated staff account administration

**Status: bounded W10 engineering checkpoint; operated staffing, delivered
support and comprehensive privacy lifecycle are not complete.**

This checkpoint adds a fail-closed managed staff foundation in migration 26. It
does not grant any staff role automatically and does not authorize a public
launch. Apply controlled **migration 26 and the maintained queue migration**
before starting the release.

## Shipped boundary

- Verified OIDC ID-token `amr` is strictly typed. Only the explicit value
  `mfa` records MFA evidence; freshness or a combination such as `pwd` plus
  `otp` is not inferred to mean MFA.
- Ordinary managed sessions remain compatible without MFA. Staff APIs require
  an active account with verified contact, the actual current session, a
  12-hour absolute staff lifetime, 30-minute idle limit, authentication within
  ten minutes and verified MFA within ten minutes.
- Role grants are append-only events with an operator reference, 20-500
  character reason and mandatory expiry no more than 90 days away. Revocation
  is another append-only event. The latest unexpired event is authoritative.
- `support-agent` and `administrator` may perform exact contact-email lookup.
  Results contain only internal account reference, masked contact, verified
  state, account status, administration revision and active-session count.
- Only `administrator` may suspend or reactivate an ordinary managed account.
  The request supplies the current administration revision and explicit reason.
  A successful change increments both the revision and session epoch, revoking
  every existing product session.
- Self-status changes and changes to another currently staffed account are
  denied. Staff role changes remain an out-of-band reviewed operation.
- The status mutation and immutable audit event commit in one transaction.
  Audit failure rolls back the account change. Audit stores minimal actor/role/
  target references, action, reason and before/after revision, not contact
  address or private preparation content.
- The deferred `/staff` screen appears only when bootstrap reports an active
  staff role. All operations remain server-authorized. The screen uses in-page
  forms and has no modal confirmation or hidden impersonation path.

## Migration 26

Migration 26 adds:

```text
managed_sessions.mfa_at
managed_accounts.admin_revision

staff_role_events
  id, user_id, role, state, actor_ref, reason
  starts_at, ends_at, created_at

staff_audit_events
  id, actor_ref, actor_role, target_ref, action, reason
  prior_revision, result_revision, created_at
```

Role and audit rows reject updates through database triggers. A user deletion
removes role events with the account, while audit references remain minimal and
unlinked so the approved audit-retention policy can later govern them.
Published migrations 1-25 remain immutable.

## Controlled role operation

Build and migrate first. Record the reviewed operator/ticket reference in
`actor-ref`; do not use an email address or credential.

```bash
npm run build
npm run db:migrate
npm run staff:role -- granted <user-uuid> administrator <actor-ref> \
  2026-12-01T00:00:00.000Z \
  "Approved temporary administrator duty for incident ticket ABC-123."

npm run staff:role -- revoked <user-uuid> administrator <actor-ref> \
  "Duty ended and reviewed access is no longer required for ABC-123."
```

The command requires explicit managed-identity/PostgreSQL configuration, the
latest database migration and an existing managed account. It reports no
success if validation or either append-only write fails. A duplicate active
grant or duplicate revocation is rejected; an expired grant may be replaced by
a newly reviewed grant.

## API and authorization

```text
GET   /api/staff/session
GET   /api/staff/accounts?email=<exact-contact>
PATCH /api/staff/accounts/:id/status
GET   /api/staff/audit?cursor=<optional>
```

Status body:

```json
{
  "status": "suspended",
  "revision": 4,
  "reason": "Reviewed support and security reason of at least twenty characters."
}
```

The account lookup is exact and bounded to ten ambiguous matches. It does not
offer prefix/global browsing. Audit history reads at most 21 rows to return a
20-row page and a versioned cursor. Rate limits, CSRF, canonical HTTPS origin
and managed-session checks continue to apply.

## Verification evidence required per release

Automated coverage proves:

- no MFA, malformed `amr`, non-explicit MFA, stale authentication, revoked or
  expired role denies staff admission;
- the correct fresh role permits only its declared action;
- support cannot mutate account status or read administrator audit;
- self and other-staff account changes are denied;
- concurrent same-revision changes produce one commit and one stale conflict;
- account suspension increments revision/epoch and invalidates existing
  sessions;
- a forced audit insertion failure rolls back the account mutation;
- role and audit rows reject updates;
- exact lookup/audit DTOs omit contact email, names, credentials and private
  preparation data;
- ordinary members have no Staff navigation, while authorized browser
  operation is deferred, usable at mobile width and opens no dialog;
- cold Entry/Landing/Auth graph budgets remain fixed.

## Explicitly not shipped

- No impersonation, account takeover, arbitrary user search, password/token
  access or blanket private story/code visibility.
- No browser/API role grant or self-escalation. Provisioning remains a reviewed
  database-backed command until a two-person workflow is approved.
- No moderator, content or billing actions merely because those role names
  exist. Billing/entitlement mutation remains separate.
- No staff support queue, assignment, reply, email/helpdesk delivery, SLA or
  escalation operation.
- No complete customer export, asynchronous encrypted artifact, retention hold,
  deletion coordinator, processor erasure or deletion-on-restore proof.
- No approved audit/role retention period, staffed operating roster, provider
  purchase, legal/privacy approval or public-launch approval.

Continue W10 in [the roadmap](07-delivery-roadmap.md) and
[#11](https://github.com/huangyingting/HelloInterview/issues/11). This bounded
checkpoint is tracked by
[#28](https://github.com/huangyingting/HelloInterview/issues/28).
