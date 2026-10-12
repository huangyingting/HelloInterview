# 31 - Owned local community contributions

**Status: implemented W11 engineering checkpoint, not public-writing,
moderation, customer-migration or privacy-deletion approval.** Local authors
can edit or delete their own original posts. Managed community remains
read-only, including the new owner APIs. Illustrative examples are immutable.

## Deployment and storage

Migration 22 introduced this checkpoint; the current release requires
**migration 23 and maintained queue migration**, including
[owned comment editing](32-owned-comment-editing.md), before starting.
Migrations 1-22 retain their published names, SQL and checksums.
PostgreSQL startup still checks the exact release history; it does not migrate
on request or silently accept an older schema. Quiesce incompatible application
versions before migration and promote the matching compiled release. An older
release's exact-version check will reject the newer database. Use a reviewed
forward fix or an approved, verified restore, not a destructive down migration.

`community_post_revisions` is a side table keyed by the exact post ID, with a
cascading post relationship and a nonnegative integer revision. Existing posts
start at revision zero. The original twelve-column `posts` shape, legacy
insertion/import contracts and saved post/membership data remain unchanged.
Insertion triggers initialize versions; **every post UPDATE**, even a no-op
or privileged change back to the original text, advances the revision. Missing
version data aborts updates rather than silently fabricating a fresh revision.

SQLite adds the equivalent table/triggers when opening a local database.
Backfill occurs when introducing the table, not on each subsequent open.
Reopening preserves positive revisions; an existing table with missing post
versions fails startup explicitly and requires restore/reconciliation.
Interrupted local upgrades and manually dropped version metadata require
operator review, not an inferred history reconstruction.

These revisions are current-version conflict metadata, **not immutable content
history, a durable mutation ledger, an audit trail or a deletion receipt**.
Direct database access remains privileged and is not an end-user edit API.
Post revisions do not reset or wrap; at 2,147,483,647, editing returns 409.

## Private owner protocol

```http
GET /api/posts/owned?id=...
PUT /api/posts/owned
  {"id":"...","revision":0,"title":"...","body":"..."}
DELETE /api/posts/owned
  {"id":"...","revision":0}
```

The GET query and mutation bodies are closed shapes. IDs retain the exact
bounded text contract in [runbook 30](30-opaque-community-addresses.md): do not
trim, normalize or infer a slug. The current session supplies the actor; callers
cannot supply authorship, another account, a sample flag or a replacement
publication context.

Reads and successful edits return `{post, revision}`. `post` is the existing
private-safe public DTO: it exposes neither account IDs nor an extra public
revision field. Only the actor's `sample=0` posts are eligible. Anonymous
question labels remain anonymous. GET is private/no-store and is not classified
as a managed public read.

PUT changes only title and original text. Title is 5-200 characters and body
20-10,000, with trimmed surrounding whitespace and no NUL. Kind, exact ID,
company, track, level, region, author, sample and creation date are unchanged.
Successful edits return the authoritative committed snapshot; the UI does not
depend on a second read to declare an acknowledged save.

| Result | Meaning |
| --- | --- |
| 200 | An owned snapshot, confirmed edit or confirmed deletion |
| 400 | Invalid, duplicate or extra input fields, or invalid text/revision bounds |
| 401 | Missing, expired or revoked local session |
| 404 | Missing post, another author's post or an immutable example |
| 409 | Stale revision or exhausted editing revision |
| 503 | Managed owner management remains disabled; inactive managed accounts retain their 403 fence |

An old revision is not a retry key. Repeating an edit after a committed response
was lost returns 409, rather than a fabricated success. Repeating deletion after
removal returns 404, not an idempotent deletion receipt. There is **no automatic
replay, last-write-wins overwrite or rebase**.

## Admission, locking and conflicts

Mutations run in one adapter transaction and use **user -> actual current
session -> owned post** lock order. The local cookie is validated and hashed;
the same token, actor and expiry are rechecked inside the transaction. A request
paused before admission cannot commit after that browser session is revoked.
An already admitted mutation holds its session lock through completion; a
subsequent revocation waits rather than retroactively undoing a committed edit.

PostgreSQL locks the post first and then reads its revision in a **separate SQL
statement**. Reading a joined version while waiting for a post-only lock can
retain an earlier join snapshot and incorrectly admit an old draft. The
separate read observes the locked current row. SQLite's immediate transaction
provides the corresponding write serialization.

The captured revision is compared before mutation. Exactly one of two
competing edits from the same revision succeeds. Intervening updates invalidate
old edits/deletions even if the title/body later return to their original value.
Validation or conflict failure rolls back without advancing a version.

## Exact discussion deletion

Confirmed deletion removes the owned post, its version, vote/follow
relationships and comments whose resource is **exactly** `post/` plus the saved
ID. It does not trim the resource or delete another discussion by prefix.

PostgreSQL's historical comment-parent relationship can cascade removal.
Before deleting an exact thread, outside-resource children of its comments are
detached from those parents so their unrelated body/resource survive. The same
behavior is applied on SQLite. This is preservation of unrelated legacy data,
not permission to create new cross-resource reply links.

New post comments revalidate the current local session, lock/check the live
parent post and check that a reply parent belongs to the same exact resource.
Comment creation and owner deletion share lock order and serialize on the
post: an admitted comment is subsequently removed with the thread, or a
comment arriving after deletion receives 404. It cannot recreate an orphan
discussion. Generic non-post discussion semantics remain unchanged.

Historical local recognition points are not decreased on edit/deletion. They
represent past local activity, not money or access authority. This is not a
production reputation, abuse-resistant accounting or financial policy.

## In-page author experience

Only a local viewer with server-derived `isMine` on an original post sees
**Manage your post**. No account-ID comparison or modal dialog is used.

- Opening loads a private snapshot and captures its revision.
- Closing hides the editor but preserves the draft while that page stays
  mounted. Changing selected post or actual owner retires the previous editor.
- Failed or lost save/delete responses preserve text and explicitly say the
  outcome was not confirmed. No success navigation or automatic retry follows.
- **Check saved version** displays a comparison without changing the draft or
  its captured revision. **Replace my draft with saved version** is the explicit
  discard/adopt action; a stale draft is never silently rebound to a new version.
- Deletion requires a separate acknowledgment checkbox describing removal of
  the post, discussion, votes and follows. Only a confirmed response returns
  to the canonical feed. An unavailable post after a lost response remains an
  explicit error until the user chooses navigation.

Aborted/superseded reads and unmounted mutation callbacks cannot install a
previous editor's snapshot into another post. Controls are absent for strangers,
examples and managed viewers; direct API ownership checks remain authoritative.

## Evidence and remaining gates

```sh
npm run build
# TEST_DATABASE_URL must identify an isolated, owned PostgreSQL fixture.
npx tsx --test tests/community.test.ts tests/database.test.ts \
  tests/identity.test.ts tests/identity-runtime.test.ts tests/server.test.ts \
  tests/runtime.test.ts tests/content-boundary.test.ts
CHROME_PATH=/usr/bin/google-chrome npx tsx --test \
  tests/identity-browser.test.ts tests/billing-browser.test.ts \
  tests/screen-loading.test.ts
npm run test:unit
npm test
```

Both adapters cover ownership, examples, exact IDs, immutable metadata, closed
input, stale revisions, concurrent edits, ABA protection, missing-version
failure and exact removal with unrelated child preservation. Real 20 -> 21 -> 22
PostgreSQL upgrade evidence retains original data and migration checksums.
Paused real-session revocation and both comment/deletion lock orders are
exercised on PostgreSQL. Built browsers exercise conflict comparison/adoption,
explicit deletion, committed-but-lost responses without replay, superseded
private reads and absent stranger/example/managed controls.

Measured complete transitive graphs remain below unchanged 350 KiB raw /
100 KiB gzip-estimate limits: entry 296,535 / 94,464 bytes; cold Landing
303,140 / 97,619; cold Auth 312,769 / 100,617. The editor stays in the deferred
Community graph. These are build estimates, not deployed compression or
performance SLA evidence. Verify the actual downloadable archive, including
its hidden manifest and all referenced assets, as in
[runbook 28](28-deferred-screen-delivery.md).

Local author comment text editing is now implemented in
[runbook 32](32-owned-comment-editing.md). Remaining W11 work includes comment
deletion/reply-retention policy, ordered/durable write
intents and unknown-outcome receipts, rules/consent, reporting/review/appeals,
staff permission/audit, anti-abuse controls and consistently enforced
publication/moderation state. Managed writing remains denied until these
operating gates are approved, or launch remains read-only.

This feature is **not account deletion, a comprehensive privacy export/erasure
workflow, immutable moderation evidence or legally approved retention**.
Real providers, customer-data migration, operated infrastructure and public
launch still require their separate approvals.
