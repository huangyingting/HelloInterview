# 42 - Privacy-safe personal author muting

**Status: implemented W11 engineering checkpoint, with reviewed expiring staff
restrictions delivered separately by
[runbook 43](43-reviewed-expiring-community-restrictions.md); not
relationship-wide account blocking, automated abuse enforcement, approved
retention, staffed moderation, managed community writing or public-launch
approval.**

This checkpoint implements
[#35](https://github.com/huangyingting/HelloInterview/issues/35) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It gives an
authenticated member a private desired-state control over another live
community author's posts and comments without publishing either account
identifier.

## Member contract

```text
PUT /api/community/mutes
{
  "requestId": "<uuid>",
  "muted": true,
  "targetType": "post" | "comment",
  "targetId": "<exact live contribution>"
}

PUT /api/community/mutes
{
  "requestId": "<uuid>",
  "muted": false,
  "muteId": "<owned mute uuid>",
  "revision": 3
}

GET /api/community/mutes
```

The initial request resolves the contribution's author only inside the server.
It rejects the caller's own contribution, illustrative posts, removed comments,
moderation-hidden targets and missing targets. An exact owner/key/input replay
returns the original receipt; changed desired-state input under the same key
conflicts.

One row represents one owner/subject pair. The first mute begins at revision
one. Each actual `muted`/`unmuted` transition advances exactly one revision.
An unmute requires the current owned mute ID and revision. Re-muting through
another live contribution from the same author advances the existing row rather
than creating another identity link.

History returns active mutes only, in bounded 20-row owner-bound cursor pages.
It includes the mute ID, representative target type/ID, revision and
timestamps. It never includes the subject account ID, name, email or another
member's state.

## Reading and interaction behavior

An active personal mute is applied centrally for the exact viewer:

- the subject's posts are absent from compatibility feeds, bounded feeds,
  totals, search results, company facets and direct detail;
- other viewers and the muted author see unchanged public results;
- the subject's comments remain in thread position as viewer-only tombstones
  saying that the author was muted;
- muted tombstones cannot be replied to or reported;
- direct reply, post-discussion and report API attempts recheck the mute rather
  than trusting hidden UI controls.

The post-detail and comment controls are available only for authenticated,
writable, non-owner, non-example, live contributions. Muting a post returns to
its feed. Muting a comment changes it in place to the same tombstone returned
by a fresh server read. **My moderation status** lists active personal mutes and
provides an exact revision-fenced unmute control. No dialog is introduced.

## Migration 33

Migration 33 adds:

- `community_mutes`: UUID identity, owner and server-only subject references,
  representative target, desired state, monotonic revision and timestamps,
  unique per owner/subject;
- `community_mute_intents`: immutable owner-scoped UUID request key, exact input
  hash, target, desired state, prior/result revision and receipt timestamp.

PostgreSQL and SQLite enforce:

- owner and subject differ;
- the first row is `muted` at revision one;
- only one desired-state transition with a one-step revision advance may update
  a mute;
- request intents are append-only and bind a valid unchanged or one-step
  transition;
- ordinary mute deletion and intent update/deletion are rejected;
- owner deletion cascades private mute state and intent receipts rather than
  retaining a cross-account relationship.

PostgreSQL serializes owner/subject transitions with one advisory-lock order and
then a row lock. Migrations 1-32 remain unchanged.

## Admission, privacy and failure behavior

Managed mute and unmute writes consume the same shared
`community-network` and `community-account` admission scopes as reports and
appeals. Canonical network and account fingerprints remain HMAC-derived.
Managed shared-control failure is explicit and stores nothing. Local SQLite is
a development path and does not claim cross-replica admission.

Owner privacy exports include the owner's minimized mute states and exact
intent receipts. They omit `subject_id` and all subject account attributes.
Public post/comment DTOs likewise expose only viewer-relative filtering and a
boolean comment tombstone flag.

- A changed request key, stale unmute revision or unavailable target fails
  without changing state.
- Exact replays remain safe after later desired-state transitions.
- Post/comment visibility and interaction checks use current database state.
- No notification is sent to the muted author.
- Personal muting does not remove content globally, alter moderation state,
  create staff evidence or claim protection from determined abuse.

## Evidence

The repository verifies:

- migration 33 upgrade preservation, indexes and both-adapter guards;
- exact replay, changed-key conflict, self/example/missing rejection and
  monotonic unmute/re-mute revisions;
- feed, detail, search-total, facet and comment-tombstone filtering;
- reply and report rejection for muted authors;
- minimized bounded history without subject account IDs;
- privacy export state and intent receipts without subject IDs;
- shared managed network/account admission;
- local in-page mute/tombstone/history/unmute behavior without dialogs;
- build/type safety and unchanged deferred-screen graph ceilings.

## Still required

W11 remains open for:

- account blocking and relationship-wide interaction policy;
- approved community rules, legal retention and takedown policy;
- external author/reporter delivery and published response targets;
- external restriction notices, approved restriction-appeal policy and reviewed
  automated spam triage; exact in-app restriction appeals follow in runbook 44;
- moderation staffing and ownership;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
