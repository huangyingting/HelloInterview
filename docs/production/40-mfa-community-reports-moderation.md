# 40 - MFA-gated community reports and moderation

**Status: implemented W11 engineering checkpoint, with appeals delivered by
[runbook 41](41-community-appeals-status-admission.md); not automated
enforcement, external notification, staffed moderation, approved retention,
managed-writing or public-launch approval.**

This checkpoint implements
[#33](https://github.com/huangyingting/HelloInterview/issues/33) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It gives
authenticated members a durable report receipt and gives explicitly authorized
staff a bounded in-app queue with reviewed hide/restore decisions. It does not
turn on managed community contribution writes.

## Delivered contract

Member API:

```text
POST /api/community/reports
{
  "requestId": "<uuid>",
  "targetType": "post" | "comment",
  "targetId": "<exact identifier>",
  "category": "spam" | "harassment" | "privacy" | "misinformation" | "other",
  "details": "<20-1,000 characters>"
}
```

The route requires an active authenticated member. Managed deployments use the
same current-account/session write admission as other owner operations. Local
mode requires the actual current local session. A report is accepted only for
an existing visible post or live visible comment.

`requestId` is scoped to the reporter and binds the exact target, category and
details. An exact retry returns the original receipt; reuse for different input
conflicts. One reporter cannot create a second open report for the same target,
and at most 20 open reports may be retained for one reporter. The receipt says
`moderation-queue-only`; it does not promise review time, notification or
resolution.

Staff API:

```text
GET   /api/staff/community/reports
PATCH /api/staff/community/reports/:id
{
  "revision": 4,
  "targetRevision": 2,
  "action": "claim" | "release" | "dismiss" | "hide" | "restore",
  "reason": "<20-500 characters>"
}
```

Staff admission requires:

- an active verified managed account;
- explicit OIDC MFA evidence;
- a current session created within 12 hours and used within 30 minutes;
- authentication and MFA within ten minutes;
- an unexpired `moderator` or `administrator` role.

Non-administrators must claim a report before acting and cannot change another
moderator's assignment. Administrators can review or take over any report.
Every action is fenced by both the report revision and current target revision.
A per-target PostgreSQL transaction lock serializes actions from independent
reports before the contribution row and target state are checked.

## Migration 31

Migration 31 adds:

- `community_reports`: nullable reporter ownership for later account retirement,
  owner-scoped UUID keys, exact input hash, target/category/details, queue state,
  assignment, revision and timestamps;
- `community_moderation_targets`: one post/comment visibility row with a
  monotonic revision;
- `community_moderation_events`: append-only actor/role/action/reason evidence
  tied to resulting report and target revisions.

PostgreSQL and SQLite enforce:

- new reports begin owner-linked, open, unassigned and at revision zero;
- new target rows begin at revision one;
- report input and target identity cannot be rewritten;
- staff report and target state changes advance exactly one revision;
- evidence references the resulting report and, for hide/restore, target
  revision;
- event rows, report rows and moderation-target rows cannot be deleted through
  ordinary application SQL.

A user-row deletion retires `reporter_id` through `ON DELETE SET NULL`; it does
not erase report content or staff evidence. Assigned staff references remain
restricted. This is a conservative engineering boundary pending an approved
retention and full privacy-erasure policy, not a legal retention decision.
Migrations 1-30 remain unchanged.

## Public visibility and owner behavior

One hidden-post predicate is applied to:

- the compatibility feed;
- bounded feed results and counts;
- direct/query-addressed detail;
- full-body search through the feed reader;
- company facets;
- vote/follow admission;
- post discussion and comment-submission admission.

Hidden posts return not found and cannot receive new comments. In local mode,
the exact owner can reopen a hidden post through the private viewer context only
to delete it; the post cannot be edited, voted on, followed, reported again or
discussed. Managed contribution management remains disabled.

Hidden comments remain in discussion order as:

```json
{
  "author": "Moderated",
  "body": "This comment was hidden by moderation.",
  "moderated": true,
  "deleted": false
}
```

The stored author/body are not returned by public readers. Hidden comments
cannot be edited, reported again or receive new replies. Submission receipt and
history joins no longer return their current text. Their owner can still use the
existing UUID-keyed deletion workflow; owner deletion then strips account,
author and body bytes and the owner-deletion tombstone takes precedence.

Restore advances the target revision and returns the contribution through the
same readers. Report count alone never hides content.

## Minimized staff and owner surfaces

The staff queue returns the report statement and public contribution content,
but no reporter account identifier. Assignment is only `me`, `other` or null;
staff actor identifiers and prior internal reasons are not returned in queue
DTOs.

The owner privacy export includes submitted report ID/key, target, category,
details, state, revision and timestamps. It excludes assignment, moderator
identity, internal reasons and unrelated reports. The reporter UI exposes its
exact request key after success or uncertain failure.

Both member reporting and staff moderation use in-page controls. There are no
confirmation dialogs. The moderator page remains a deferred staff screen and
does not enter public cold JavaScript graphs.

## Failure and operating behavior

- A changed report or target revision returns conflict and applies nothing.
- A missing/deleted target cannot be hidden or restored.
- Concurrent hide requests for one target serialize; one transition wins and a
  stale target revision conflicts.
- Hidden comments and posts are unavailable to reply/comment admission.
- Queue cursors are bounded and encode the exact moderation queue version.
- Database guard failures and authorization failures are explicit; there is no
  success-shaped fallback.

No email, push, webhook or helpdesk notification is sent. Runbook 41 adds
bounded in-app member status and owner appeals, but operators must not infer a
response SLA from a saved report, appeal or queue row.

## Evidence

The repository verifies:

- migration 31 upgrades and both-adapter schema guards;
- owner/key/input-bound report replay and conflict behavior;
- minimized staff queue DTOs;
- MFA/role-gated claim, hide and restore actions;
- concurrent target revision fencing;
- feed/detail/search/facet visibility;
- explicit comment moderation tombstones;
- blocked edit/reply and retained owner deletion;
- privacy export inclusion without moderator identities/reasons;
- local and managed in-page browser workflows without dialogs;
- unchanged cold entry, landing and sign-in graph ceilings.

## Still required

W11 remains open for:

- approved community rules, retention and takedown policy;
- external author/reporter delivery and published response targets;
- approved relationship/direct-interaction policy, external restriction
  notices, approved restriction-appeal policy and shared rate-limit operations;
  personal muting, reviewed restrictions, exact restriction appeals and private
  account blocking follow in runbooks 42-45;
- approved policy and operated calibration for the deterministic,
  staff-reviewed non-punitive triage delivered in runbook 46;
- moderation staffing, escalation ownership and published response targets;
- managed contribution writing and read-only rollback approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
