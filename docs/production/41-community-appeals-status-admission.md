# 41 - Community appeals, member status and shared admission

**Status: implemented W11 engineering checkpoint, not external notification,
automated enforcement, block/mute, repeat-abuse restriction, staffed moderation,
approved retention, managed writing or public-launch approval.**

This checkpoint implements
[#34](https://github.com/huangyingting/HelloInterview/issues/34) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It adds an
owner-bound second-review workflow for hidden contributions, minimized in-app
status for reporters and contribution owners, and shared PostgreSQL admission
limits for report and appeal writes.

## Delivered member contract

Appeal API:

```text
POST /api/community/appeals
{
  "requestId": "<uuid>",
  "targetType": "post" | "comment",
  "targetId": "<exact identifier>",
  "targetRevision": 3,
  "statement": "<20-1,000 characters>"
}

GET /api/community/reports
GET /api/community/appeals
```

An appeal requires the exact authenticated owner of an existing post or live
comment. The contribution must currently be hidden at the supplied positive
moderation revision. The UUID key is scoped to the owner and binds the exact
target, revision and normalized statement:

- an exact retry returns the original receipt;
- changed input under the same key conflicts;
- one owner can submit only one appeal for one hidden target revision;
- one owner can retain at most 20 open appeals;
- deleting or restoring/re-hiding a target cannot silently retarget an appeal.

The receipt promises only `moderation-queue-only`. It does not promise external
delivery, review time or restoration.

The report-history endpoint returns only the member's receipt key, category,
queue state, target state/revision and timestamps. The appeal-history endpoint
returns only the member's receipt key, appealed revision, decision state,
current target state/revision and timestamps. Neither endpoint returns the
member's original private statement, staff identity, assignment, internal
reason or another member's records. Both use owner-bound 20-row cursors.

## Staff contract

```text
GET   /api/staff/community/appeals
PATCH /api/staff/community/appeals/:id
{
  "revision": 2,
  "targetRevision": 3,
  "action": "claim" | "release" | "deny" | "uphold",
  "reason": "<20-500 characters>"
}
```

Staff admission reuses the report queue boundary:

- active verified managed account;
- explicit OIDC MFA evidence;
- current session created within 12 hours and used within 30 minutes;
- authentication and MFA within ten minutes;
- unexpired `moderator` or `administrator` role.

Non-administrators must claim an appeal before deciding it and cannot take an
appeal assigned to another moderator. Every operation fences both the appeal
revision and the current target revision. An upheld appeal changes the exact
hidden target to visible and advances its revision atomically with the appeal
decision. A denied appeal leaves the target hidden. A stale appeal cannot
restore a later, independently hidden revision.

The staff DTO contains the owner statement and contribution content needed for
review, but no owner account identifier. Assignment remains only `me`, `other`
or null. Staff reasons and actor identifiers remain in immutable evidence, not
member status.

## Migration 32

Migration 32 adds:

- `community_appeals`: nullable owner ownership for later account retirement,
  owner-scoped UUID key, exact input hash, target and appealed target revision,
  statement, queue state, assignment, appeal revision and timestamps;
- `community_appeal_events`: append-only actor/role/action/reason evidence tied
  to the resulting appeal revision and, for uphold, restored target revision;
- `community-network` and `community-account` scopes in the existing shared
  PostgreSQL admission buckets.

PostgreSQL and SQLite enforce:

- new appeals begin owner-linked, open, unassigned and at revision zero;
- appeal target identity, appealed revision and statement cannot be rewritten;
- staff state changes advance exactly one appeal revision;
- upheld evidence references the resulting visible target revision;
- appeal and appeal-event rows cannot be ordinarily deleted;
- account deletion retires `owner_id` through `ON DELETE SET NULL` without
  deleting the retained appeal statement or staff evidence;
- assigned staff references remain deletion-restricted.

Migrations 1-31 remain unchanged.

## Shared production admission

Managed report and appeal creation consumes both a canonical network bucket and
an account bucket before opening the write transaction. Fingerprints remain
HMAC-derived; raw network addresses and account identifiers are not stored in
the bucket table. The shared 15-minute window survives API replica changes and
restarts.

If shared admission, canonical edge address verification or PostgreSQL is
unavailable, managed report/appeal creation fails explicitly and stores
nothing. Local SQLite mode remains a development workflow and does not claim
replica-shared admission.

The limiter supplements, rather than replaces:

- exact UUID replay;
- one open report per owner/target;
- 20 open reports per owner;
- one appeal per owner/target/revision;
- 20 open appeals per owner;
- staff role, MFA, session freshness and revision fencing.

## In-page behavior

Hidden local owner posts and comments display an appeal control beside existing
delete-only management. The form preserves one exact request UUID across an
uncertain response and displays it after failure or success.

Authenticated members can open **My moderation status** from Community to read
bounded report and appeal outcomes. The staff screen has a separate deferred
appeal queue with claim/release/deny/uphold controls. No dialog is introduced,
and the appeal screen remains outside the public cold JavaScript graph.

The public post/comment DTO carries `moderationRevision: 0`. Only the exact
owner reading a currently hidden contribution receives its positive hidden
revision, which is required to bind an appeal. Other readers receive neither a
hidden contribution nor its moderation revision.

## Privacy and failure behavior

Owner privacy exports include the owner's appeal key, target, appealed revision,
statement, state, appeal revision and timestamps. They exclude assignment,
moderator identity, internal reasons and unrelated appeals.

- A changed appeal or target revision returns conflict and changes nothing.
- A non-owner receives not found rather than contribution ownership details.
- A deleted owner comment or missing post cannot be appealed or restored.
- Concurrent decisions serialize on the target; only one target transition can
  publish.
- Report/appeal history cursors are bound to the exact authenticated owner.
- Staff evidence remains immutable and unavailable through member APIs.
- No email, push, webhook or helpdesk notification is attempted.

## Evidence

The repository verifies:

- migration 32 upgrades and both-adapter structural guards;
- owner/key/input/target-revision appeal replay and conflict behavior;
- minimized report and appeal member status;
- owner-only hidden moderation revisions;
- MFA/role-gated claim and uphold with atomic restore;
- stale appeal and target revision rejection;
- immutable appeal evidence and minimized staff DTOs;
- shared managed account/network bucket use;
- privacy export inclusion without staff identity/reason;
- local and managed in-page browser workflows without dialogs;
- unchanged eager, landing and sign-in JavaScript graph ceilings.

## Still required

W11 remains open for:

- approved rules, legal retention and takedown policy;
- external author/reporter delivery and published response targets;
- block/mute, repeat-abuse restrictions and reviewed spam triage;
- moderation staffing and escalation ownership;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
