# 43 - Reviewed expiring community account restrictions

**Status: implemented W11 engineering checkpoint, with exact in-app appeals
delivered separately by
[runbook 44](44-exact-community-restriction-appeals.md); not automated
enforcement, permanent/global suspension, external notification, approved abuse
policy or retention, staffed moderation, managed community writing or
public-launch approval.**

This checkpoint implements
[#36](https://github.com/huangyingting/HelloInterview/issues/36) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It adds
narrow, reversible restrictions derived from one exact reviewed report without
changing global account status or exposing the restricted account identifier.

## Scope and member contract

Only two scopes exist:

- `participation`: the reported author cannot create or edit posts/comments or
  add votes/follows;
- `reporting`: the report owner cannot submit new reports.

The server resolves the subject from the report. Clients never submit or receive
that account ID. Neither scope blocks public reads, owned deletion, existing
report/appeal status, owner appeals, personal mutes, support, privacy, billing,
learning, identity management or sign-out.

```text
GET /api/community/restrictions
```

The member response contains only current unexpired scope, revision, start,
expiry and update timestamps. It omits the source report, contribution,
moderator, internal reason and account identifiers. **My moderation status**
shows this same minimized state and the capabilities that remain available.

## Staff contract

```text
POST /api/staff/community/reports/:id/restrictions
{
  "reportRevision": 2,
  "targetRevision": 1,
  "subject": "author" | "reporter",
  "scope": "participation" | "reporting",
  "durationHours": 24 | 168 | 720,
  "reason": "<20-500 characters>"
}

GET /api/staff/community/restrictions

PATCH /api/staff/community/restrictions/:id
{
  "action": "extend" | "lift",
  "revision": 3,
  "durationHours": 720,
  "reason": "<20-500 characters>"
}
```

`author` is valid only with `participation`; `reporter` is valid only with
`reporting`. Issuance requires a non-dismissed exact report and current
moderation-target revision. Moderators must own the report assignment;
administrators may take reviewed action without assignment. Staff cannot
restrict themselves or another currently authorized staff account.

Staff admission retains the existing active-account, verified-contact, explicit
MFA, 12-hour session, 30-minute use and ten-minute authentication/MFA freshness
requirements. An unexpired `moderator` or `administrator` role is required.

The active queue returns the source contribution needed for review but no
restricted account ID or prior internal reason. Only the latest restricting
moderator or an administrator can extend or lift a restriction. Extensions
must move the expiry later; a stale revision changes nothing.

## Migration 34

Migration 34 adds:

- `community_restrictions`: nullable retained subject ownership, exact source
  report, one narrow scope, active/lifted/expired state, monotonic revision,
  start/expiry and timestamps;
- `community_restriction_events`: immutable report/actor/role/action/reason
  evidence tied to the resulting restriction state, revision and expiry.

PostgreSQL and SQLite enforce:

- new rows begin active at revision one with a positive expiry interval;
- at most one non-retired active row exists per subject/scope;
- updates permit only subject retirement, one-step active extension, lift or
  expiry settlement;
- every event references the resulting restriction state and revision;
- restriction rows cannot be ordinarily deleted and events cannot be changed
  or deleted;
- account deletion retires the subject reference without rewriting evidence.

An expired timestamp immediately stops enforcement even if the stored state has
not yet been settled. A later separately reviewed issuance settles that old row
to `expired` with evidence before inserting a new active period. There is no
background worker that invents or extends authority.

Migrations 1-33 remain unchanged.

## Concurrency and admission

PostgreSQL issuance uses the same order as moderation decisions:

1. lock the exact report row;
2. acquire the target advisory lock and read the current target revision;
3. acquire the subject/scope advisory lock;
4. lock any active restriction row;
5. publish restriction state and immutable evidence atomically.

Restriction extend/lift and member write admission acquire the subject/scope
advisory lock before reading the active row. Therefore a contribution/report
write cannot race a newly published restriction across API replicas. SQLite
uses its existing serialized transaction path and does not claim cross-replica
operation.

Managed report submission still consumes shared `community-network` and
`community-account` buckets before the reporting-scope check. A rejected
restricted write stores no report. Restriction staff actions use the existing
staff admission bucket and fail closed if privileged admission is unavailable.

## Privacy, UI and failure behavior

Owner privacy exports include only restriction ID, scope, state, revision,
start/expiry and timestamps. They exclude subject links, source reports,
moderator identity and staff reasons. Staff evidence remains private.

- Existing reports, appeals and mutes remain readable and actionable.
- Owned contribution deletion remains available during participation
  restriction.
- Exact stale report, target or restriction revisions return conflict.
- Duplicate concurrent issuance produces one active row; the other operation
  fails explicitly and must reload current state.
- A shorter extension is rejected rather than silently reducing an existing
  restriction.
- Expired, lifted or retired restrictions cannot be changed as if active.
- Staff and member controls are in-page; no dialog is introduced.

## Evidence

The repository verifies:

- migration 34 upgrade preservation, indexes and both-adapter guards;
- server-side author/reporter resolution without account-ID DTOs;
- scoped participation/reporting admission and preserved unrelated access;
- duplicate-concurrency serialization, expiry, extension and lift fencing;
- moderator/administrator authority and staff-account/self protection;
- immutable event validation and deletion rejection;
- minimized member/staff status and privacy export exclusions;
- local member and managed staff browser workflows without dialogs;
- unchanged eager, landing and sign-in JavaScript graph ceilings.

## Still required

W11 remains open for:

- relationship-wide personal account blocking and direct-interaction policy;
- approved community rules, legal retention and takedown policy;
- external author/reporter restriction notices and an approved restriction
  appeal policy;
- reviewed automated spam triage that cannot make irreversible decisions;
- moderation staffing, escalation ownership and published response targets;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
