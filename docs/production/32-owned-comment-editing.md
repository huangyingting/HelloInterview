# 32 - Owned local comment editing

**Status: implemented W11 engineering checkpoint, not managed-writing,
comment-deletion, moderation or privacy approval.** Local authors can revise
their original discussion text. No comment-delete endpoint is introduced.
Managed discussions remain read-only.

## Deployment and data preservation

Migration 23 introduced this checkpoint; the current release requires
**migration 26 and maintained queue migration**, including
[bounded discussion pages](33-bounded-discussion-pages.md) and
[owned comment submission receipts](34-owned-comment-submission-receipts.md),
before starting. Migrations 1-24 retain their published SQL, names and checksums.
The exact-version startup check still rejects incompatible PostgreSQL history;
it never migrates on a request. Follow the quiesced promotion/forward-fix/verified
restore boundary in [runbook 31](31-owned-community-contributions.md), not a
destructive down migration or an incompatible mixed-version deployment.

`community_comment_revisions` is a side table with an exact comment ID,
cascading comment reference and nonnegative integer revision. Existing comments
start at zero. The original seven-column `comments` shape, import contracts,
body/resource/author/date/parent data and existing post versions are unchanged.

Triggers initialize versions on insertion and advance them on **every UPDATE**,
including no-ops, privileged body changes and parent detachment during exact
post-thread deletion. Returning to the original text does not revive an old
draft. Missing version data aborts updates explicitly. At 2,147,483,647, editing
returns 409; versions never reset or wrap. Privileged updates at the maximum
also fail rather than silently changing unversioned metadata. A historical
outside-thread child at that maximum can therefore prevent parent detachment
and requires operator review before its post can be removed.

SQLite introduces equivalent storage/triggers and backfills only when adding
the table. Reopening preserves positive versions. Missing rows in an existing
version table fail startup and require restore/reconciliation, not silent
reconstruction. Interrupted local upgrades and manually dropped version
metadata require operator review.

These are current-version conflict markers, **not immutable content history,
durable mutation receipts, moderation evidence or deletion audit**. Native
creation chooses new UUIDs; this protocol does not establish replay authority
across privileged deletion/recreation, database replacement or customer import.

## Public ownership and private snapshots

The existing bounded `GET /api/comments?resource=...` reader adds server-derived
`isMine`. Its exact output fields are:

```text
id, resource, author, body, createdAt, parentId, isMine
```

No account IDs or private revisions are returned. Ownership is computed in SQL
for the current viewer, not by browser account-ID comparison. Anonymous viewers
receive false. Author display labels remain unchanged; this does not make
comments anonymous or extend the anonymous-question-post promise.

The compatibility reader retains its 500-row ceiling and existing date order.
It is not a frozen export. The shared UI now uses the indexed live pages in
[runbook 33](33-bounded-discussion-pages.md) instead of this compatibility array;
full-history search and large-history/export operating gates remain.

```http
GET /api/comments/owned?id=...
PUT /api/comments/owned
  {"id":"...","revision":0,"body":"..."}
```

Owner reads return `{comment, revision}` and use private/no-store responses.
The query and body are closed shapes. IDs are exact, nonempty text up to 200
UTF-16 code units excluding NUL; generated IDs are addressed with query
parameters, not normalized as paths. Post discussions retain the exact resource
contract in [runbook 30](30-opaque-community-addresses.md).

Only the comment's author may read its private snapshot or edit it. Owning a
parent post does not grant editing authority over another author's comment.
PUT changes **only body**, trimmed to 2-3,000 characters with no NUL. ID,
discussion resource, author, creation date and reply parent remain immutable
through this API. Existing generic lesson/course discussion text is eligible;
post-backed comments additionally require a live parent post.

Successful edits return the authoritative committed snapshot. Missing/expired/
revoked local sessions receive 401, missing/other-owned comments or removed
discussions 404, invalid/extra/duplicate input 400, and stale/exhausted versions
409. Managed owner reads and writes remain disabled with 503; inactive managed
accounts retain their 403 fence. Private owner reads are not public-read
exceptions. No comment deletion or public-writing permission is implied.

## Lock order and deletion races

Owner reads and edits run in one transaction, locking **user -> actual current
session -> parent post if applicable -> target comment**. Generic discussions
omit only the post step. The actual local token, actor and expiry are rechecked
inside the transaction, including private snapshot reads.

For post comments, preliminary owned resource lookup locates the parent; the
post is locked before the comment. This matches creation and post deletion
ordering and avoids a comment-first/post-first deadlock. After obtaining the
comment lock, the resource is rechecked; a privileged concurrent move causes
an explicit conflict rather than locking a second discussion or editing under
the wrong parent.

The revision is read in a **separate statement after the target row lock**,
not an earlier joined snapshot. A real PostgreSQL lock-wait test observes the
blocked API connection in `pg_stat_activity`, releases an intervening privileged
body update and verifies that the stale native draft receives 409.

Exactly one competing edit from a captured version succeeds. A browser session
revoked before admission cannot commit a paused edit. Comment creation/editing
and post deletion serialize in either order: a confirmed comment may then be
removed with its parent thread, or a late edit receives 404. Neither operation
restores an orphan discussion.

Exact post deletion still preserves unrelated legacy child comments by
detaching their cross-resource parents. That metadata update advances their
comment versions, so an old editor cannot silently overwrite the changed
context. Comment-version rows cascade when their comments are removed.

## Shared in-page editor and recovery

Only a local viewer with server-derived `isMine` sees **Edit my comment**.
The existing author editor is shared with original posts, but comments expose
only their text field and no delete controls. It is loaded on demand from the
deferred owner module rather than importing it into cold Landing/Auth graphs.

Closing/reopening preserves the draft. Discussion filtering hides nonmatching
rows without unmounting their editors; hidden rows and controls remain outside
the tab/accessibility tree. Changing resource or actual owner clears the old
ownership view/editor. Aborted reads and unmounted callbacks cannot install
another discussion's private snapshot.
Public discussion reads show explicit loading, not a success-shaped empty
thread. Creation waits for that initial read; scoped functional updates prevent
late results or independent saved comments from replacing another view.

Conflict or lost-response failure preserves text and says **Saving was not
confirmed**. Checking the saved version shows a comparison without rebasing the
draft. Explicitly replacing the draft adopts that version and refreshes the
displayed comment. A successful-but-lost save is not automatically repeated:
an old-version replay conflicts instead of claiming idempotent success.
No automatic retry, silent rebase, modal dialog or fabricated receipt is used.

## Evidence and remaining gates

Both adapters exercise exact IDs, minimized ownership DTOs, author/post-owner
separation, closed input, immutable metadata, body/version limits, competing
edits, ABA protection, missing-version failure and post-removal cleanup.
Actual PostgreSQL 20 -> 21 -> 22 -> 23 and prior SQLite upgrades preserve saved
data and positive post versions. PostgreSQL tests cover actual-session
revocation, both creation/edit/deletion orders and an observed privileged
comment-row lock wait.

Built browsers cover sharing the existing post editor without regression,
confirmed/comment-conflict/lost-response flows, close/filter draft preservation,
explicit comparison/adoption, superseded private reads, different-account and
managed denial, no dialogs and a 390-pixel viewport with a maximum-length
unbroken 3,000-character saved comment. Full accessibility/device/
IME assessment is not implied.

At the migration-23 checkpoint, measured transitive entry, cold Landing and cold
Auth graphs remained below the
unchanged 350 KiB raw / 100 KiB gzip-estimate ceilings: 296,544 / 94,468 bytes;
303,149 / 97,620; and 312,778 / 100,622 respectively. These are build estimates,
not deployed transfer or performance SLAs. Verify the actual downloadable
archive/manifest/import closure as required by
[runbook 28](28-deferred-screen-delivery.md).

Run `npm run build`; with an owned `TEST_DATABASE_URL`, run community/database/
identity/runtime/content suites and managed/built-screen suites, followed by
`npm run test:unit`, `npm test` and exact-commit full CI/container recovery.

Remaining W11 gates include comment deletion with a defined reply-retention/
removal policy, ordered/durable write intents and unknown-outcome receipts,
rules/consent, reports/review/appeals, staff permissions/audit, anti-abuse and
publication/moderation enforcement. Managed writing stays denied until separately
approved and operated, or launch remains consistently read-only. Comprehensive
privacy export/erasure, approved retention, real providers, customer migration,
infrastructure and public launch remain separate gates.
