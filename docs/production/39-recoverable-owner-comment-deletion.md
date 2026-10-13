# 39 - Recoverable owner comment deletion

**Status: implemented W11 engineering checkpoint, not legal-retention,
privacy-erasure, moderation, managed-writing or public-launch approval.**

This checkpoint gives a local comment author an explicit destructive lifecycle
without collapsing an existing reply tree or turning an uncertain network
response into a second operation. It is tracked by
[#32](https://github.com/huangyingting/HelloInterview/issues/32) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12).

## Delivered boundary

Migration 30 adds:

- nullable saved comment ownership for deleted rows;
- `community_comment_tombstones`, containing only comment identity and deletion
  time needed to project reply context;
- owner-scoped, UUID-keyed `community_comment_deletions` receipts with input
  hash, resource, prior/result revision and deletion time;
- immutable receipt/tombstone guards;
- a receipt-insert trigger that locks the current owned revision, creates the
  tombstone, removes saved account ownership/author/body bytes and verifies one
  exact revision advance;
- structural comment-update guards permitting only body edits, the existing
  cross-resource parent cleanup used by post deletion, or receipt-bound
  tombstoning.

Published migrations 1-29 are unchanged.

## API contract

```text
DELETE /api/comments/owned
{
  "id": "<exact bounded comment id>",
  "revision": 3,
  "requestId": "<uuid>"
}
```

Admission requires the same local contributor and current-session authority as
comment editing. The comment must still belong to that owner and the supplied
revision must be current.

The response contains:

```json
{
  "receipt": {
    "requestId": "…",
    "commentId": "…",
    "resource": "post/…",
    "deletedAt": "…",
    "priorRevision": 3,
    "resultRevision": 4,
    "status": "tombstoned"
  },
  "comment": {
    "id": "…",
    "resource": "post/…",
    "author": "Deleted",
    "body": "This comment was removed by its author.",
    "createdAt": "…",
    "parentId": null,
    "isMine": false,
    "deleted": true
  }
}
```

An exact same-owner/key/id/revision retry returns the original receipt and
tombstone. If the containing discussion was subsequently removed, the exact
receipt still returns with `comment: null` and does not recreate anything.
Reusing the key for another comment or revision returns conflict. A different
key after deletion cannot acquire ownership and returns not found.

## Saved-data and reply semantics

The transition replaces the saved comment row's `user_id`, `author` and `body`
with `NULL`, empty string and empty string. Public APIs derive the explicit
`Deleted` tombstone label and explanatory body; those display strings are not
stored as replacement user content.

The original:

- comment text;
- public author label;
- account ownership link;

are absent from the saved comment after commit.

The comment ID, discussion resource, original creation time and existing
`parent_id` remain so current replies retain stable context and ordering. New
replies must target a live comment and are rejected for tombstones. Tombstones
cannot be edited, deleted again through another request or changed back into
live comments.

Deleting the containing local post still removes its exact discussion,
including tombstones and replies. Minimal submission and deletion receipts may
remain privately to prevent duplicate retry; they contain no removed comment
body or author label.

## Lost-response UX

The in-page comment owner control uses no dialog. The author must acknowledge
that text/authorship cannot be restored. One UUID is created for the deletion
attempt and remains visible after an uncertain response. The only recovery
action retries that exact key and saved revision.

After confirmation, the editor closes and the loaded discussion row changes to
the explicit tombstone. Reply and owner-edit controls disappear while existing
replies remain visible.

## Local SQLite compatibility

Existing local databases may have the prior `comments.user_id NOT NULL`
definition. Startup performs one controlled local schema rebuild before creating
the migration-30 mirror tables/triggers:

1. preserve comments and their exact revision rows;
2. rebuild only the comment/revision tables with nullable ownership;
3. recreate indexes and revision triggers;
4. run a foreign-key integrity check before continuing.

Saved comments and positive revisions are not rewritten or reset. New local
databases start with the nullable definition directly.

## Privacy export

Comprehensive owner exports include deletion request ID, comment ID, resource,
prior/result revision and deletion time. Tombstoned comment rows no longer join
the owner comment export because their ownership was removed. Removed body and
author bytes are absent.

This is evidence of the application transition, not a complete privacy deletion
receipt. The private deletion ledger remains owner-linked until a separately
approved account/privacy lifecycle removes or lawfully retains it.

## Failure and operating boundary

- Invalid, stale, foreign or exhausted revisions make no change.
- Receipt insertion, tombstone creation, byte removal and revision advance are
  one transaction.
- Database guards reject direct tombstone mutation and unbound restoration.
- Logs/telemetry must not include removed text, cookies, request bodies or
  private receipt keys.
- Managed community writing remains read-only.

The later [moderation checkpoint](40-mfa-community-reports-moderation.md)
supplies authenticated reports and reviewed hide/restore mechanics. Still
required for W11: approved retention policy, appeals, staffed moderation,
author/reporter notices, shared abuse controls and explicit managed-writing or
read-only launch approval.
