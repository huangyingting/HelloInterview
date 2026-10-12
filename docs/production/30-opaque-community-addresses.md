# 30 - Opaque community addresses and malformed URL recovery

**Status: implemented W11/W12 engineering checkpoint, not managed-writing,
moderation, privacy-migration or public-launch approval.** No dependency,
database migration, identifier rewrite or new commercial/provider authority is
introduced. Managed community remains read-only.

## Reproduced gaps

Saved community IDs are bounded, exact text, not necessarily UUIDs or slugs.
Production-built checks reproduced a card for `.` navigating back to its feed
instead of its detail. Raw interpolation also gives slash, backslash, question
mark, fragment, percent and whitespace characters URL syntax rather than data.
`encodeURIComponent` alone does not solve dot segments: it leaves `.` and `..`
unchanged, and URL handling can normalize encoded dot segments as well.

Malformed percent/UTF-8 escapes could throw in the application's route parser
outside its screen boundary. The server's path guard could similarly return an
unexpected 500 before the browser received the application.

Post discussions had a coupled identity problem: the generic 150-character
resource bound could not represent `post/` plus an accepted 200-character ID,
and trimming the whole resource could merge trailing-space identifiers.

## Canonical addresses and compatibility

All new Community card/title/detail links, global community Search links and
local publishing destinations share lightweight helpers:

```http
/community/post?kind=questions&id=...
/community/post?kind=submissions&id=...&track=...
/community/submissions?track=...

GET /api/community/post?kind=questions&id=...
GET /api/community/post?kind=submissions&id=...&track=...
```

Use `URLSearchParams`, not path interpolation, extra decoding, slugification,
Unicode normalization or trimming. Browser and server decode once. IDs retain
their exact stored values, including `.`, `..`, literal percent sequences,
Unicode and surrounding whitespace.

The singular API route deliberately does not reserve a value such as `detail`
under the existing `:id` route. These published routes remain compatible:

```http
/community/questions/:id
/community/submissions/:track/:id
GET /api/community/posts/:id?kind=questions
GET /api/posts?kind=questions
POST /api/posts/:id/:action
```

Old links remain usable for IDs their path representation can actually carry.
Already-normalized dot segments or unescaped fragment/query characters cannot
be recovered by guessing the original ID. Generate canonical links going
forward; do not rewrite saved IDs or silently reinterpret ambiguous bookmarks.

| Field | Canonical detail contract |
| --- | --- |
| `id` | Required exact nonempty text, at most 200 UTF-16 code units, no NUL |
| `kind` | Required `questions`, `stories`, `submissions` or `discussion` |
| `track` | Optional text, at most 80 code units, no NUL; when nonempty, an exact predicate |

Unknown or duplicate detail fields, missing/invalid selection, malformed URL
encoding and invalid bounds return 400. Missing posts or wrong kind/nonempty
track return 404. Empty/omitted track retains the existing unfiltered-detail
semantics; ID and kind remain required. There is no feed scan, guessed
placeholder, client-supplied viewer or permission encoded in these addresses.
Public DTO allowlisting, anonymous question authors, server-derived ownership,
bounded feeds/cursors and personalized `no-store` responses remain unchanged.

Submission return links carry a nonempty track as query data, including legacy
values outside today's editorial choices. The selected legacy filter is
visible in the Type selector. New local contributions still require supported
editorial types; their editor starts with a supported default rather than an
invalid inherited legacy value.

## Exact local interactions

Current browser vote/follow requests no longer put IDs in a mutation path:

```http
POST /api/posts/actions
Content-Type: application/json

{"id":"...","action":"vote","enabled":true}
```

This is a closed body: exact bounded `id`, `vote|follow`, and a boolean desired
state. The actual session supplies the actor. Unknown actor/authority fields,
missing boolean and invalid identifiers/actions return 400; unsigned requests
return 401 and missing posts return 404.

The transaction locks the current user's row on PostgreSQL, verifies that the
actor and post still exist, and creates/removes only that actor's membership.
Repeated or concurrent identical desired-state requests do not reverse state
or duplicate rows. The old toggle endpoint reuses the same transaction helper
and retains its published toggle behavior.

This is **not** an ordered intent/revision protocol or a durable request ledger.
An old desired-state request admitted after a newer opposing intent can change
state again. The browser does not automatically replay failed requests. Legacy
toggles, publishing and comment creation do not gain idempotency guarantees.
Managed mutations on both old and new routes remain denied; public-read and
managed-write classification share the same community prefix list. Pending
and suspended sessions gain no product-writing authority.

For post discussions, `resource` is exactly `post/` plus the accepted ID:
1-200 ID code units, no NUL, no resource trimming, at most 205 total code units.
Leading whitespace before the `post/` protocol prefix is rejected, not silently
trimmed into another resource. Other discussion resource types retain their
existing generic 150-character validation. Reads, writes and reply-parent
checks use the same exact resource identity.

Already-trimmed legacy comment resources are not automatically reassigned.
They may be ambiguous between old IDs; reviewed evidence and an approved
customer migration would be needed to recover an association safely. This
checkpoint neither repairs such history by inference nor certifies retention,
privacy deletion or moderated comment publication.

## Malformed addresses and focus

The browser parser handles only known `URIError` failures and validates
canonical selection before rendering a screen. It shows **This address could
not open.** with an explicit alert, a Studio link and usable shell navigation.
It does not expose the raw address/error, substitute an ID, reload automatically
or retry a mutation. Unknown well-encoded routes retain ordinary Not found.

Server malformed path/query encoding produces explicit 400 JSON. For a
production GET requesting HTML outside the API/auth/webhook/asset/media
namespaces, the runtime instead sends the compiled application index with
**HTTP 400 and `Cache-Control: no-store`**. The browser then renders the same
invalid-address screen. API and asset failures never become successful HTML
responses. Development/custom test hosts need not provide this production
document recovery; reverse proxies must preserve or deliberately review it.

Canonical detail selection is a real screen identity even when pathname stays
`/community/post`. Changing kind/ID/track clears the previous screen's local
draft state and follows readiness-aware main focus. Reordering equivalent
parameters preserves the current draft and focus. Ordinary Search query
editing still does not remount/refocus the screen. Submission navigation,
sidebar selection, return links, reload and browser Back remain usable.

Readiness continues to mean that the selected module has committed, not that
all content reads have completed. Skip-link tab-order checks wait for real
screen content, not merely the persistent sidebar beside a loading fallback.

## Verification and remaining work

The existing build, backend, managed-browser and built-screen CI steps include
the new checks; no separate runner or increased JavaScript budget is added.

```sh
npm run build
# TEST_DATABASE_URL must identify an isolated, owned PostgreSQL fixture.
npx tsx --test tests/community.test.ts tests/identity.test.ts \
  tests/identity-runtime.test.ts tests/server.test.ts tests/runtime.test.ts \
  tests/content-boundary.test.ts
CHROME_PATH=/usr/bin/google-chrome npx tsx --test \
  tests/identity-browser.test.ts tests/billing-browser.test.ts \
  tests/screen-loading.test.ts
npm run test:unit
npm test
```

Both database adapters exercise exact opaque IDs, closed queries, kind/track
mismatches, actor-scoped concurrent desired states, exact long/space-sensitive
comment resources, cross-resource reply rejection and legacy route behavior.
Actual built browsers exercise card/global Search/reload/local interactions,
managed read-only detail, arbitrary/empty submission tracks, equivalent and
changed query identities, Back/return navigation, malformed documents and SPA
addresses, and existing rapid Search/deferred/keyboard/mobile behavior.
Runtime-only release checks exercise the new API and unchanged managed denial.

Keep the fixed 350 KiB raw / 100 KiB gzip-estimate transitive JavaScript budgets.
Before accepting a release, also verify the actual downloadable archive's
hidden manifest and referenced assets as required by
[runbook 28](28-deferred-screen-delivery.md).

Owner editing/deletion, versioned/ordered write intents, abuse controls,
moderation/reports/appeals, operated publication, historic comment repair,
full accessibility/device/IME assessment and deployment/recovery evidence
remain open. Real providers, customer migration and public launch still require
their separate approvals.
