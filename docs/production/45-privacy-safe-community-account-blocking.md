# 45 - Privacy-safe community account blocking

**Status: implemented W11 engineering checkpoint; not an approved
direct-interaction/retention policy, global moderation action, external
notification, determined-abuse prevention guarantee, staffed operation, managed
community writing or public-launch approval.**

This checkpoint implements
[#38](https://github.com/huangyingting/HelloInterview/issues/38) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). It gives an
authenticated member a private, reversible relationship-wide community safety
control without accepting or returning another member's account identifier.

## Member contract

```text
PUT /api/community/blocks
{
  "requestId": "<uuid>",
  "blocked": true,
  "targetType": "post" | "comment",
  "targetId": "<exact live contribution>"
}

PUT /api/community/blocks
{
  "requestId": "<uuid>",
  "blocked": false,
  "blockId": "<owned block uuid>",
  "revision": 3
}

GET /api/community/blocks
```

The initial request resolves the contribution author only inside the server. It
rejects self, illustrative, removed, hidden and missing targets. An exact
owner/key/input retry returns the original receipt; changed desired-state input
under the same key conflicts.

One row represents one owner/subject direction. The first state is `blocked` at
revision one. Each actual block/unblock transition advances one revision. An
unblock requires the current owned block ID and revision. A later contribution
from the same account reuses the existing relationship row rather than adding
another identity link.

History returns only the owner's active block directions in bounded 20-record
pages. It contains the block ID, representative target type/ID, revision and
timestamps. It excludes subject ID, name, email and whether the other member
has independently blocked the owner.

## Private relationship behavior

Either active direction creates the same viewer-relative relationship boundary
for the two accounts:

- each account's posts are absent from the other's compatibility/bounded feeds,
  totals, search, facets and direct detail;
- each account sees the other's comments in third-party discussions only as a
  generic **Unavailable** safety tombstone;
- the tombstone exposes a direction-neutral `blocked` flag, not who initiated
  the setting;
- direct vote/follow, joining the other account's post discussion and replying
  to the other account's comment fail as unavailable;
- owned edit/deletion and unrelated community/product activity remain
  available;
- every other viewer sees unchanged public posts, comments and counts.

Blocking is not a report or staff action. It does not rewrite moderation state,
erase existing reports/appeals, notify the other member, remove content
globally or prevent access through another account or a logged-out browser.
The two members can still contribute independently to a third-party discussion,
but their comments remain tombstones to each other.

Removing the owner's direction does not reveal or override a reciprocal block.
The UI therefore confirms only that **my block** was removed; it never promises
that the relationship became visible.

## Migration 36

Migration 36 adds:

- `community_blocks`: UUID identity, owner and server-only subject references,
  representative target, blocked/unblocked state, monotonic revision and
  timestamps, unique per owner/subject direction;
- `community_block_intents`: immutable owner-scoped UUID request key, exact
  input hash, target, desired state, prior/result revision and receipt
  timestamp.

PostgreSQL and SQLite enforce:

- owner and subject differ;
- new rows begin blocked at revision one;
- updates may only publish one desired-state transition and one revision;
- intent receipts bind the resulting owned state and unchanged or one-step
  revision;
- intent evidence cannot be rewritten or ordinarily deleted;
- owner or subject deletion cascades private relationship state instead of
  retaining an orphan cross-account link.

Migrations 1-35 remain unchanged.

## Concurrency and admission

Block/unblock and direct interactions use one canonical unordered account-pair
advisory lock in PostgreSQL. Multi-target comment writes sort all account pairs
before locking. The write path then rechecks the current relationship:

1. resolve only the server-side target account from the exact live post/comment;
2. acquire canonical relationship lock(s);
3. revalidate the live post/comment and active block directions;
4. publish either the desired block transition or the direct interaction;
5. commit before another operation on the same relationship can proceed.

An interaction admitted first may complete before a later block publication.
Once a block is published, a waiting or later direct interaction cannot commit.
SQLite relies on its serialized transaction boundary and makes no
cross-replica claim.

Managed block/unblock writes consume the existing `community-network` and
`community-account` admission scopes. Canonical fingerprints remain
HMAC-derived. Admission failure is explicit and stores no new state.

## Privacy, UI and failure behavior

Owner privacy exports include only owned block IDs, representative targets,
state/revision/timestamps and exact intent receipts. Subject identifiers and
the other account's desired state are excluded.

Post and comment controls remain in-page. **Block account** expands an explicit
impact summary before confirmation. **My moderation status** lists only
accounts blocked by the current owner and provides exact revision-fenced
recovery. No dialog is introduced.

- A stale unblock revision, changed request key or unavailable target changes
  nothing.
- Exact receipt replay remains safe after later state transitions.
- A reciprocal block remains effective after one owner removes only their own
  direction.
- Public DTOs never include either account ID.
- Existing mutes remain independent; unblocking does not unmute.
- No email, push, webhook, helpdesk or staff notification is attempted.

## Evidence

The repository verifies:

- migration 36 upgrade preservation, indexes and both-adapter guards;
- exact replay, changed-key conflict, self/example/missing rejection and
  monotonic unblock/reblock behavior;
- direction-neutral two-account post filtering and comment tombstones;
- unchanged third-party visibility;
- relationship-locked direct discussion/reply/vote/follow admission;
- reciprocal block privacy and owner-only recovery;
- minimized history and privacy export without subject IDs;
- shared managed account/network admission;
- local and managed in-page block/history/unblock workflows without dialogs;
- build/type safety and fixed eager/landing/sign-in graph ceilings.

## Still required

W11 remains open for:

- approved relationship/direct-interaction, abuse, legal retention and
  takedown policy;
- external author/reporter and restriction notices;
- reviewed automated spam triage that cannot make irreversible decisions;
- moderation staffing, escalation ownership and published response targets;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
