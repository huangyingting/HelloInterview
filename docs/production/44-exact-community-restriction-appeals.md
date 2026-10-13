# 44 - Exact in-app community restriction appeals

**Status: implemented W11 engineering checkpoint; not external notification,
an approved abuse/appeal policy, a response SLA, staffed moderation, automated
decision-making, managed community writing or public-launch approval.**

This checkpoint implements
[#37](https://github.com/huangyingting/HelloInterview/issues/37) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It gives the
subject of one current community restriction a private, exact-revision review
path. It does not expose the source report, account identifier, restricting
moderator or internal evidence.

## Member contract

```text
POST /api/community/restriction-appeals
{
  "requestId": "<uuid>",
  "restrictionId": "<current owned restriction uuid>",
  "restrictionRevision": 2,
  "statement": "<20-1,000 characters>"
}

GET /api/community/restriction-appeals
```

The restriction must belong to the authenticated member and be active,
unexpired and at the supplied positive revision. The UUID request key is scoped
to that owner and binds the exact restriction, revision and normalized
statement:

- an exact retry returns the original receipt;
- changed content under the same key conflicts;
- one owner can submit only one appeal for one restriction revision;
- one owner can retain at most 20 open restriction appeals;
- extension, lift, expiry or account retirement cannot silently retarget the
  appeal to another restriction period.

The receipt promises only `restriction-review-queue-only`. The paginated
20-record member history contains appeal/restriction IDs, scope, appealed and
current revisions, effective restriction state/expiry, appeal state and
timestamps. It omits the member statement, source report, contribution,
assignment, staff identity, staff reason and subject account identifier.

**My moderation status** shows the current restriction, an in-page exact appeal
form and minimized appeal history. Existing report/appeal status, personal
mutes, reads, owned deletion, support, privacy, billing, learning, identity and
sign-out remain available.

## Staff contract

```text
GET /api/staff/community/restriction-appeals

PATCH /api/staff/community/restriction-appeals/:id
{
  "revision": 3,
  "restrictionRevision": 2,
  "action": "claim" | "release" | "deny" | "uphold" | "resolve",
  "reason": "<20-500 characters>"
}
```

The bounded staff queue contains the member statement, restriction scope and
revisions, effective state/expiry and source contribution evidence needed for
review. It returns no restricted account identifier, source report identifier,
prior staff reason or staff account identifier. Assignment is only `me`,
`other` or null; the latest restriction actor is only `me` or `other`.

Staff admission retains the existing requirements:

- active verified managed account;
- explicit OIDC MFA evidence;
- session created within 12 hours and used within 30 minutes;
- authentication and MFA within ten minutes;
- current unexpired `moderator` or `administrator` role.

Moderators must claim an appeal before a final action and cannot take an appeal
owned by another moderator. A moderator who published the latest restriction
revision cannot deny, uphold or resolve that appeal. A different moderator or
an administrator must perform the final review. Administrators may act without
assignment when operating the bounded queue.

`deny` leaves the exact current restriction unchanged. `uphold` atomically
lifts only the exact active, unexpired appealed revision and publishes both the
ordinary restriction-lift event and restriction-appeal decision event.
`resolve` is available only when the appealed revision is no longer current
because it was extended, lifted, expired or retired. It records that the appeal
is superseded and never changes a later restriction.

## Migration 35

Migration 35 adds:

- `community_restriction_appeals`: nullable retained owner, owner-scoped UUID
  key and input hash, exact restriction/revision, statement, open/denied/
  upheld/resolved state, assignment, monotonic appeal revision and timestamps;
- `community_restriction_appeal_events`: immutable actor/role/action/reason,
  prior/result appeal revision, reviewed restriction revision, optional exact
  upheld-lift revision, resulting appeal state and timestamp.

PostgreSQL and SQLite enforce:

- new appeals begin owner-linked, open, unassigned and at revision zero;
- request key, input hash, restriction identity/revision and statement cannot
  be rewritten;
- owner retirement is the only non-review ownership transition;
- each staff transition advances exactly one appeal revision;
- action and resulting appeal state agree;
- upheld evidence references the resulting lifted restriction revision;
- all other events reference the restriction revision reviewed at publication;
- appeal and event rows cannot be ordinarily deleted, and event rows cannot be
  changed;
- account deletion sets `owner_id` to null while retaining the statement and
  staff evidence.

Migrations 1-34 remain unchanged.

## Concurrency and exact authority

Member submission:

1. performs owner/session admission;
2. returns an exact existing request-key receipt before requiring current
   restriction state;
3. reads only enough restriction state to resolve subject/scope;
4. acquires the subject/scope advisory lock;
5. rechecks the request key and locks the restriction row;
6. validates ownership, active unexpired state and exact revision;
7. inserts one appeal or fails explicitly.

Staff review:

1. reads only enough appeal/restriction state to resolve subject/scope;
2. acquires the same subject/scope advisory lock used by restriction changes
   and public admission;
3. locks the restriction row;
4. locks and re-reads the appeal row;
5. fences both supplied revisions and current authority;
6. publishes any exact restriction lift, appeal state and both immutable events
   in one transaction.

Consequently, an appeal uphold cannot race a restriction extension/lift or a
newly admitted write. SQLite uses its existing serialized transaction boundary
and makes no cross-replica claim.

An expired timestamp is treated as effective `expired` even before stored
restriction settlement. Such an appeal can only be resolved as superseded.

## Privacy, UI and failure behavior

Owner privacy exports include only the owned appeal ID/key, restriction
ID/revision, statement, state, appeal revision and timestamps. They exclude
assignment, actor, role, staff reason, source report and restriction evidence.

- A non-owner receives not found rather than ownership details.
- A stale appeal or restriction revision returns conflict and changes nothing.
- The latest restricting moderator cannot decide or close their own appeal.
- A current appeal cannot be resolved instead of receiving uphold/deny review.
- A superseded appeal cannot lift a later restriction revision.
- Duplicate concurrent submission stores one appeal.
- Staff and member controls remain in-page; no dialog is introduced.
- No email, push, webhook or helpdesk delivery is attempted.

## Evidence

The repository verifies:

- migration 35 upgrade preservation, indexes and both-adapter guards;
- exact owner/key/input/restriction-revision replay and conflict behavior;
- subject/scope lock ordering across submission, review and restriction change;
- independent moderator enforcement and administrator override;
- atomic exact-revision uphold/lift with dual immutable evidence;
- stale/lifted restriction resolution without retargeting;
- minimized member/staff DTOs and privacy exports;
- local member and managed staff browser workflows without dialogs;
- preserved unrelated account and product access;
- unchanged eager, landing and sign-in JavaScript graph ceilings.

## Still required

W11 remains open for:

- external author/reporter restriction notices;
- an approved abuse, appeal, retention and takedown policy;
- approved relationship/direct-interaction policy; personal account blocking
  follows in runbook 45;
- approved policy and operated calibration for the deterministic,
  non-punitive spam triage delivered in runbook 46;
- moderation staffing, escalation ownership and published response targets;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
