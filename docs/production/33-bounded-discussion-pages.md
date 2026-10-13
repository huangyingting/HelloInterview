# 33 - Bounded discussion pages

**Status: implemented W11 engineering checkpoint, not managed-writing,
moderation, privacy-export or operating approval.** The shared discussion UI
now reads explicit pages instead of silently stopping at 500 comments. Local
author editing remains available; managed writing remains denied.

## Deployment and preservation

Migration 24 introduced this checkpoint. The current release requires controlled
**migration 26 and maintained queue migration**, including
[owned comment submission receipts](34-owned-comment-submission-receipts.md),
before starting. Published migrations 1-24 retain their names, SQL and checksums.
Migration 24 adds `comments_resource_cursor(resource,created_at,id)`; SQLite
creates the equivalent index during its existing schema initialization.
No comment body, author, date, resource, parent, existing positive revision,
seven-column comment/import shape or post revision is rewritten.

Use the quiesced matching-release promotion and forward-fix/verified-restore
boundary in [runbook 31](31-owned-community-contributions.md). Index creation is
ordinary transactional DDL, not a promise of lock-free online migration.
Measure construction time and provision capacity for the approved database.
An older application's exact-version check rejects the newer schema; do not
mix incompatible releases or remove published migrations to simulate rollback.
This checkpoint authorizes no customer migration.

## Read contract

```http
GET /api/comments/page?resource=...&limit=50&cursor=...
```

The closed query accepts exactly one resource, optional page size **25 or 50**
(default 50), and optional cursor of at most 4,096 characters. Duplicate,
unsupported or forged viewer/account fields return 400. Existing generic
resource trimming/150-character semantics are shared with creation and the
compatibility reader. Post resources preserve exact `post/` plus a nonempty
1-200 UTF-16-unit identifier, including reserved characters and whitespace in
the post ID; leading whitespace before `post/` is rejected. NUL resources fail
validation on both adapters rather than reaching PostgreSQL as invalid text.
The new page query bounds its raw resource string at 205 units.

```typescript
{
  comments: Comment[];
  limit: number;
  nextCursor: string | null;
}
```

Each comment has exactly:

```text
id, resource, author, body, createdAt, parentId, isMine
```

The server computes `isMine` for the actual viewer. Anonymous viewers receive
false. No author account ID or private revision is returned. Comment display
labels remain public; anonymous question posts do not imply anonymous comments.
Ownership indicators are not edit capability or approval.

Pages use ascending **stored creation text, then exact ID**, with a strict
tuple boundary and matching index. The database fetches at most `limit+1` rows
(51 maximum), emits at most `limit`, and uses the extra row solely to establish
continuation. There is no offset, whole-thread download or per-page full-thread
COUNT. The UI reports loaded rows, not a fabricated live thread total.
Native comment body bounds still apply to creation; this is a row-count bound,
not a newly certified response-byte bound for arbitrary privileged legacy data.

Cursor decoding reuses the community-feed codec: canonical unpadded base64url,
valid UTF-8, a closed versioned payload and a digest of normalized query plus
actual viewer. The discussion version is `community-comments-v1`; post-feed
cursors, changed resources/page sizes/viewers, malformed UTF-8, extra fields
and oversized boundaries are rejected. Cursor boundaries preserve nonempty
comment IDs up to 200 units and saved creation text up to 200, excluding NUL.
Native UUID/ISO creation satisfies these bounds. Unsupported/corrupt privileged
boundary data fails explicitly; operators must review it rather than silently
normalize IDs or dates.

The digest binds query use; it is **not a secret signature, authorization
token, durable receipt or database-epoch proof**. Public readers can choose
positions within their permitted resource; they cannot provide a viewer to
obtain another account's ownership projection. These are live pages, not a
frozen export: deletions and later edits are visible on subsequent requests;
new/backdated or privileged reordered data may be absent or appear between
pages. A deleted boundary record need not exist for its tuple to remain useful.
Do not infer retention/export completeness or privileged import replay safety.

`GET /api/comments?resource=...` remains the unchanged array compatibility
reader with its 500-row/date-order ceiling. It is no longer used by the shared
discussion UI. Managed inactive/anonymous public reads still work; managed
mutation fences and current-session/private CAS admission remain unchanged.

## Local creation and UI behavior

The existing local `POST /api/comments` now returns
`{ id, comment: Comment }`: `id` remains compatible, and the authoritative
minimized comment is read inside the insertion transaction. It contains no
private revision or author account ID. A missing inserted row is an explicit
failure, not fabricated success. Post-backed creation keeps the existing
user/session/post locking and deletion serialization.
Reply parents use the same exact nonempty 200-unit/NUL-free identifier bound
instead of trimming/capping valid IDs at 80. Omitted/null/empty parent retains
the no-reply meaning; other invalid types fail 400. The parent must still exist
in the same exact resource. This is identity compatibility, not a reply-retention
or comment-removal policy.

The shared UI initially reads 50 rows. **Load more comments** is deliberate;
there is no automatic corpus traversal or fixed 500-row stop. Matching IDs are
deduplicated while preserving current rows/editor instances, confirmed local
edits, unsaved author text, the composer, reply selection and loaded-row filter.
Concurrent author saves/creation use functional merges and preserve page state.
Confirmed new comments appear immediately without rereading the oldest page;
the next chronological cursor remains unchanged. A newly added row can thus
appear ahead of unread older pages and is not duplicated when reached later.
The UI explicitly describes that placement.

Search filters **loaded comments only**, with an explicit no-loaded-match
message; it does not imply full-history search. Hidden rows preserve author
drafts and remain outside display/tab/accessibility through the existing hidden
rule. More pages remain loadable even when no currently loaded row matches.

Initial read failure is explicit, disables creation and offers **Retry
discussion** without clearing composer text. A later page failure keeps rows,
cursor and drafts with an inline alert; the same continuation can be retried
deliberately. First/continuation requests have a synchronous single-flight
guard. Reads are aborted and scope-checked on resource/actual-owner changes.
An already admitted creation may finish after navigation but cannot append to
another discussion, clear its new draft or announce success in that new view.
Successful creation clears only the submitted composer/reply state, preserving
text typed while its response was pending.

No write retry, automatic rebase, fabricated unknown-outcome receipt or modal
dialog is introduced. Creation remains non-idempotent: a lost response needs
deliberate investigation, not an automatic duplicate POST. CAS editing retains
the [runbook 32](32-owned-comment-editing.md) conflict/recovery contract.

## Evidence and remaining gates

Both adapters exercise 551 tied-date records, bounded 25/50-row traversals,
unique deterministic IDs, exact resources, minimized viewer ownership,
query/viewer/version/encoding rejection, compatibility ceiling and authoritative
creation output plus exact 200-unit opaque reply parents. Live-page tests delete the cursor boundary/unread rows, edit
an unread body and insert before/after the boundary without claiming a frozen
snapshot. Actual PostgreSQL 20 -> 21 -> 22 -> 23 -> 24 preserves saved data
and all published history; existing CAS/session/deletion concurrency remains.

Built browsers traverse 551 existing plus one newly created comment, edit an
author record beyond the old ceiling, hold creation/page responses concurrently,
preserve independent editor/composer drafts, avoid duplicates, recover explicit
initial/later read failures and reject superseded publication. Existing managed,
lost-edit/deletion-response, opaque-address, keyboard, asset and 390-pixel
wrapping checks remain applicable.

The fixed transitive entry/cold Landing/cold Auth ceilings remain **350 KiB raw /
100 KiB gzip-estimate**. Verify the actual uploaded manifest/static and dynamic
import closure under [runbook 28](28-deferred-screen-delivery.md), not only build
console totals. Passing them is not deployed compression, load/SLO, device/IME
or comprehensive accessibility approval.

This build's complete static graph measurements are:

| Graph | Raw bytes | Gzip-estimate bytes | JavaScript assets |
| --- | ---: | ---: | ---: |
| Entry | 296,544 | 94,461 | 1 |
| Cold Landing | 303,149 | 97,616 | 8 |
| Cold Auth | 312,778 | 100,615 | 5 |

Large-history loaded DOM/memory assessment, full-history search, frozen privacy
export/retention/deletion, durable ordered write intents/unknown-outcome
receipts, rules/consent, staff/report/appeal/abuse and operated publication
remain separate work. Recoverable local owner deletion and reply-preserving
tombstones are implemented in
[runbook 39](39-recoverable-owner-comment-deletion.md), without approving legal
retention or complete privacy erasure. Managed writing stays denied.
Real providers, customer migration and public launch retain explicit approval
gates.
