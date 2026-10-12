# 34 - Owned local comment submission receipts

**Status: implemented W11 engineering checkpoint, not managed-writing,
comment-retention, privacy-erasure or moderation approval.** Local authors can
recover an uncertain comment creation by checking or retrying one frozen
actor-owned key and normalized input. Managed community writing remains denied.

## Deployment and storage

Apply controlled **migration 25 and maintained queue migration** before starting
this release. Migration 25 adds `community_comment_submissions`:

```text
user_id, request_id, comment_id, resource, input_hash, created_at
```

The primary key is `(user_id,request_id)` and `comment_id` is unique. Owner and
owner/resource descending history indexes support bounded private reads.
Updates are rejected by an immutable trigger on both adapters. Account deletion
cascades receipts. There is intentionally no foreign key from `comment_id` to
`comments`: an acknowledged creation remains minimally recorded after comment
or exact-thread removal so retry cannot recreate it.

The ledger does **not** retain the original comment body, parent identifier or
author label. `input_hash` fingerprints the normalized actor, key, exact
resource, trimmed body and exact parent solely for retry conflict detection.
It is still private personal metadata and needs an approved retention, export
and deletion policy. A digest is not encryption, proof outside this database,
or a substitute for processor/privacy operation.

Published migrations 1-24 retain their names, SQL and checksums. Migration 25
does not rewrite existing posts, memberships, comments, revisions or migration
history, and it fabricates no receipts for legacy comments. Use the quiesced
matching-release promotion and forward-fix/verified-restore boundary in
[runbook 31](31-owned-community-contributions.md). Older releases reject the
new exact schema; do not mix incompatible versions or destructively remove the
receipt table to simulate rollback.

## Closed local API

```http
POST /api/comments/submissions
Content-Type: application/json

{
  "requestId": "UUID",
  "resource": "post/<exact-id> | <generic-resource>",
  "body": "2-3000 UTF-16 units after trimming",
  "parentId": "<exact-comment-id> | null"
}
```

The UUID is normalized to lower case. Resource and parent validation shares the
discussion contracts: exact post IDs preserve nonempty 1-200-unit opaque text;
generic resources trim to at most 150 units; parents preserve exact nonempty
1-200-unit/NUL-free IDs and must belong to the exact discussion. Resource,
body and parent must round-trip UTF-8. Unsupported fields, malformed keys,
NULs, invalid surrogate text and normalized parent substitutions return 400.

For a first key, one transaction locks the user, revalidates the actual browser
session, locks a post-backed parent if present, validates a reply parent,
creates the native comment and inserts its receipt. A receipt-insertion failure
rolls back the comment and its revision row. The first committed response is:

```typescript
{
  receipt: {
    requestId: string;
    commentId: string;
    resource: string;
    createdAt: string;
    status: 'created';
  };
  comment: Comment | null;
}
```

The stored comment UUID/date and receipt are created atomically. An existing
same actor/key plus the same normalized input returns its original receipt
without creating another row, even if the parent post or comment has since
been removed. The same actor/key with different normalized input returns 409.
Different actors may independently use the same UUID. The existing-key lookup
precedes new parent validation so a deleted acknowledged thread cannot turn a
safe retry into a new comment.

`status: created` means this database historically committed the creation. It
does not mean the comment still exists, is currently authorized, or preserves
its original body. `comment` is returned only while the same owner/resource/
creation tuple still identifies a current comment and a post-backed parent
still exists. Its body may reflect a later author edit. Privileged ID/date/
resource changes or database replacement can make it unavailable; the receipt
does not establish lineage across privileged recreation/import.

```http
GET /api/comments/submissions/receipt?requestId=...
GET /api/comments/submissions?resource=...&cursor=...
```

Both reads are local-only, current-session-protected and actor-scoped. Receipt
lookup accepts only one key. Missing lookup returns 404 with an explicit warning:
absence is not cancellation or proof that an in-flight request cannot commit.
History accepts only an optional normalized exact resource and cursor, returns
at most 10 rows after reading 11, and orders by stored creation text then UUID
descending. Its canonical base64url cursor is versioned and digest-bound to the
actual viewer and optional resource. It contains no raw account ID. Changed
viewer/resource, unsupported fields, malformed UTF-8 or forged payloads fail
400. History is a bounded private recovery view, not a complete privacy export.

The compatibility `POST /api/comments` remains available and non-idempotent.
No receipt is fabricated for those comments. This checkpoint is not a universal
ordered-intent framework or a receipt for post creation/editing/deletion.

## Browser recovery and history

The deferred local composer generates one UUID when the user submits and freezes
that exact resource/body/parent/key in memory. It never automatically retries a
write and never silently chooses a new key. If the response is lost, the UI:

- preserves the original text/key separately from edits made in the composer;
- offers **Check comment submission**, which performs only the private GET;
- offers **Retry original comment submission**, which sends the same frozen
  key and original normalized input;
- blocks ordinary submission while the outcome is unknown; and
- requires an in-page acknowledgment before **Start a separate comment
  submission**, explaining that it cannot cancel the earlier request and may
  create an additional comment.

A confirmed current comment is merged once into the loaded discussion. Text
typed after the pending request is not cleared. If the acknowledged comment is
gone, the UI says it is unavailable and a check/retry never recreates it.
Recovery input is not placed in browser storage. Component lifetime, input
identity and single-flight guards prevent an obsolete result from publishing
into another user/resource scope. No modal dialog is used.

**View comment submission history** deliberately loads the deferred private
module. Discussion history is resource-scoped; the local Account page can show
all resources. Reads are 10 rows per page with explicit load-more and retry.
Current text is truncated in history display; removed rows show only minimal
references. Abort/scope guards prevent a sign-out, actor change or superseded
screen from receiving an old private result. Managed Account remains separate
and exposes no local receipt history.

Post-deletion UI discloses that minimal private references remain without
original comment text. This is not account/privacy deletion. Staff/export/
retention workflows remain in W10 and must define whether/when these references
are exported or erased, including deletion-on-restore behavior.

## Concurrency, failure and operating boundaries

The lock order is user, actual session admission, then post for a new
post-backed insertion. Receipt replay/read/history still lock and revalidate
the current user/session; revocation before admission returns 401 and changes
nothing. New post-backed submissions serialize with owner post deletion in both
orders: admitted creation may commit before deletion and retain only a receipt,
or deletion commits first and creation returns 404. Replay after either order
never recreates the removed discussion.

Do not interpret 404 as cancellation, issue an automatic new key, mutate ledger
rows, copy original text into logs/telemetry, or expose history through public
community DTOs. Monitor validation/conflict/unknown-recovery rates without raw
body, credential, cookie or cursor capture. Operators need retention/export/
deletion policy and incident ownership before real customer data is collected.

This checkpoint does not approve managed writing, comment deletion/reply
retention policy, moderation/reports/appeals, immutable body history, complete
privacy export/deletion, public launch or customer migration.
