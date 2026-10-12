# 27 - Private-safe community reads

**Status: implemented W11 engineering checkpoint, not public-writing or
moderation approval.** Local contributions remain local. Managed community
publishing, voting, following and comments remain denied until operated
moderation is enabled by a separate reviewed implementation.

## Deployment and compatibility

Migration 21 introduced this read checkpoint; the current release requires
**migration 26 and maintained queue migration**, including the
[local owner-contribution protocol](31-owned-community-contributions.md) and
[owned comment editing](32-owned-comment-editing.md) and
[bounded discussion pages](33-bounded-discussion-pages.md) and
[owned comment submission receipts](34-owned-comment-submission-receipts.md),
before
starting this release:

```sh
npm run build
npm run db:migrate
```

Migration 21 adds owner/recent, global/recent and follow-owner indexes. It changes
no posts, vote/follow memberships, publication state, author mapping, support
receipt or identity authority. Migrations 1-20 remain immutable. SQLite receives
equivalent read indexes on opening its existing local database.

The compatibility `GET /api/posts?kind=...` still returns an array with at most
1,000 full posts. `X-Community-Truncated: true|false` now explicitly describes
truncation, detected with one extra row. Its identity fields intentionally
change: consumers must use `isMine`, never the removed `authorId`.
The current UI no longer downloads this compatibility corpus.

## Public DTO and anonymity

All compatibility, feed, detail and global-search post DTOs use an explicit
allowlist:

```text
id, kind, title, body, company, track, level, region, author, createdAt,
votes, voted, followed, sample, isMine
```

Neither `authorId` nor the stored `author_id` is returned. `isMine`, `voted` and
`followed` derive from the current server-authenticated viewer, not query input.
Anonymous viewers receive false. A question's author is always `Anonymous`,
even when a legacy saved row contains a real display name. Other contribution
kinds retain their public display labels. Question author names are excluded
in SQL as well as in the DTO projection.

This hides direct account identifiers from other members, not from the service.
Self-identifying body text, other public contributions and comments can still
identify someone. No staff author-lookup endpoint, audit permission, content
redaction or comprehensive privacy deletion is introduced.
Personalized API responses remain `Cache-Control: no-store`.

## Bounded feed contract

```http
GET /api/community/posts?kind=questions&sort=recent&scope=all
GET /api/community/posts?q=cache&limit=50
```

| Field | Contract |
| --- | --- |
| `kind` | Optional: `questions`, `stories`, `submissions`, `discussion`; omitted searches all kinds |
| `q` | Literal case-insensitive substring of title, full body, company and kind; at most 200 UTF-16 code units |
| `company` | Exact company, at most 80 code units |
| `level`, `region` | Exact match, at most 40 code units each |
| `track` | Exact match, at most 80 code units |
| `sort` | `recent` (default) or `popular` |
| `scope` | `all` (default), `mine` or `following`; the latter two require a signed-in viewer |
| `limit` | Closed sizes `6` (default), `20`, `50`; no arbitrary or unbounded page size |
| `cursor` | Optional canonical base64url continuation, at most 2,048 code units, including bounded legacy Unicode IDs |

Unknown/duplicate fields, NUL-containing filters, unknown kind/sort/scope,
noncanonical sizes and malformed or mismatched cursors return 400.
Unsigned personal scopes return 401. Database faults and invalid saved records
are explicit server errors, never fabricated empty success responses.

The response is:

```ts
{
  posts: CommunityPost[]; // at most limit; body is at most 241 Unicode code points
  total: number;          // all matches, independent of the current cursor
  limit: number;
  nextCursor: string | null;
  companies: string[];   // at most 200, for the selected kind or all kinds
  companyOptionsTruncated: boolean;
}
```

Search evaluates the full saved body, not its preview. Detail returns the full
saved text. The Community UI displays up to 240 Unicode code points plus an
ellipsis without splitting a surrogate pair.

Page and total are read in one SQL statement, including empty or past-end
pages. Company options use an independently bounded kind-scoped read, not only
the current page or active text/company filter. They can reflect a subsequent
database snapshot. One extra distinct company detects option truncation; search
and exact filtering can still address companies outside the offered list.

`%`, `_` and backslash are escaped as literal search characters. SQLite uses a
deterministic JavaScript lowercase function rather than ASCII-only `lower()`.
PostgreSQL uses the deployment's `lower()`/collation. ASCII, accented Latin and
emoji cases are exercised on both adapters; this is not a promise of identical
Unicode case folding, normalization, accent-insensitivity or collation in every
locale. Pin and rehearse the actual managed database locale before launch.

## Cursor and consistency boundary

Recent order is `(createdAt DESC, id DESC)`. Popular order is
`(votes DESC, createdAt DESC, id DESC)`. Continuations retain that tuple, a
version and a SHA-256 fingerprint of the normalized query and current viewer.
Changing any filter, sort, personal scope, page size or viewer requires a fresh
first page.

Cursors are navigation data, not signed permission or a database snapshot.
Authorization always uses the actual session and SQL owner/follow predicates.
New posts and vote changes can reorder later pages; popular navigation may
skip or repeat changed records. Counts are current per response, not a frozen
export. The UI keeps a Previous/Next cursor stack; changing filters/account
resets navigation. Global search deduplicates already loaded IDs when appending.
Previous remains available when concurrent removals shrink a later page, and
navigation does not invent a frozen total-page count.

These limits bound response rows and strings, not full-table search/count/sort
CPU. Current substring search, aggregate vote ranking and company facets require
load/index-plan evidence at the intended dataset size; this checkpoint does not
claim full-text indexing, search SLAs or operated read-abuse protection.

## Independent detail and current readers

[Runbook 30](30-opaque-community-addresses.md) adds canonical query-addressed
browser/API detail for exact legacy IDs and local interactions. The path reads
below remain compatible; new generated links use `GET /api/community/post`
with required `id` and `kind` and optional nonempty exact `track`.

```http
GET /api/community/posts/:id?kind=questions
GET /api/community/posts/:id?kind=submissions&track=system-design
```

The detail read is independent of feed size, cursor and search filters. Missing
posts or wrong kind/track return 404. Its closed query accepts only `kind` and
optional `track`. It does not manufacture a placeholder or retrieve a post from
another section.

Community filtering/sort/personal scopes now run on the server with six-card
pages. Local publish/vote/follow refreshes use the corresponding feed or direct
detail read. Aborted and viewer/query-keyed reads prevent old personalization
from being displayed after an account or query change.

Global search requests one cross-kind, query-scoped community page rather than
four full corpora. Body-only matches are retained without a second title-only
client filter. Explicit Load more retrieves remaining community matches,
including beyond the former 80-result cap. The separate static catalog retains
an explicitly labeled 80-match display cap. Search and pagination errors remain
visible; an outage is not presented as a successful empty library.

## Evidence and remaining W11 gates

`npm run test:community` requires a dedicated `TEST_DATABASE_URL`; tests own
unique PostgreSQL schemas and temporary SQLite fixtures. It covers explicit
DTO fields, anonymous/owner/other personalization, legacy-name anonymity,
literal/Unicode/body-only matching, exact personal/filter scopes, stable tied
recent/popular pagination, query/viewer mismatch and input limits, direct reads
past 1,000 rows, bounded company options and actual HTTP response headers.
Migration acceptance applies real migrations 1-20, preserves saved posts and
memberships/checksums, and repeatedly upgrades to 21.

Compiled runtime-only identity evidence covers private-safe feed/detail after
restart and denied new-route writes. Managed browser evidence exercises custom
off-page companies, cursor reset, direct full text and body-only global matches
while all write controls remain unavailable. Local browsers preserve
publishing/votes/follows/comments and load all 85 synthetic body-only search
matches without using the old corpus endpoint.

Local original-post revision-fenced owner editing/deletion is now implemented
in [runbook 31](31-owned-community-contributions.md); actor-scoped desired-state
votes/follows are implemented in [runbook 30](30-opaque-community-addresses.md).
Still required before public writing: approved rules, staffed moderation,
comment deletion/reply-retention policy, ordered/durable mutation receipts, reports/review/appeals,
notifications and audited staff permissions, anti-abuse controls and truthful
production recognition accounting. Publication/access/moderation
state must be integrated consistently into every reader when those states are
introduced; this checkpoint adds no such state. Unreviewed imported/local
content is not automatically approved editorial content.
