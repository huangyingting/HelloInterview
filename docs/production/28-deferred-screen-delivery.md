# 28 - Deferred screen delivery

**Status: implemented W12 engineering checkpoint, not production-launch,
editorial, accessibility or operating approval.** Route code loads on demand;
the existing local/managed capabilities and server authorization remain
unchanged. No provider, payment, AI or community-write capability is enabled.

## Delivery graph

The application keeps its store, navigation, theme and bootstrap/error handling
in the initial JavaScript graph. Module-scope `React.lazy` adapters load the
selected screen inside `Suspense`. Multiple screens in one page module share
that module; this is domain-level delivery, not one chunk per URL or component.
There is no speculative route prefetch or new service worker.

Moving only page imports was insufficient: shared metadata and presentation
barrels still brought discovery data into the eager graph. The implementation
also separates:

- Public navigation labels from full track, problem, course and quiz metadata.
- Lightweight presentation/access widgets from content-dependent widgets.
- Landing from Dashboard, and authentication from Search/account/discovery.
- Shared download and track-icon helpers from their former page modules.

`shared/public-catalog.ts` remains a compatibility re-export barrel. The
generator writes all six public modules and `--check` verifies every generated
output. Existing projected fields and values, lesson access flags and curricula
are retained; navigation tracks contain only ID, title, short description,
description and color. Type-only imports do not introduce private content.

Next.js compiles the browser graph and standalone preparation copies only
reviewed public/static assets. Splitting code is not protection for paid
content: authorized server readers, immutable quiz snapshots and owned data
remain authoritative.

## JavaScript budgets

The former Vite-manifest byte budgets were retired with the Vite runtime.
Replacement budgets must be derived from Next build/app manifests and measured
against the exact standalone artifact rather than mapping old chunk names or
silently increasing thresholds. CSS, HTML, images, media, API response sizes
and request overhead remain separate measurements; no current budget is a load
or Core Web Vitals SLA.

## Loading, failure and state

An unresolved selected-screen import displays an accessible polite status,
`Loading screen`, with `aria-busy=true`. Navigation and theme controls remain
usable in the same shell. Bootstrap failures retain their existing separate
handling; the screen boundary is not a global exception handler.

Descendant import/render failures replace the main screen with an explicit
failure, a manual **Reload page** action, an unsaved-change warning and a
**Back to the Studio** link. There is no automatic document reload, mutation
retry, guessed successful screen or silent fallback. The custom console report
contains the error name, not its raw message or user input; no remote error
collector is added. Browser/framework diagnostics remain browser diagnostics.

Changing the path or query resets a *failed* boundary so other screens can
open. A healthy boundary is not remounted on these changes: query-only Search
updates preserve category/focus, and equivalent Account aliases preserve their
existing unsaved form state. An actual owner change remounts the screen boundary,
preventing its old owner-local state from being reused. Existing individual
screen keys and server-clock access/expiry behavior remain in place.

React caches a rejected lazy import for that document. Returning to the failed
screen therefore does not blindly re-fetch/retry it. After assets become
available, deliberate document reload starts a fresh lazy-module cache.
Reload can discard unsaved work; navigation/render failures are not a new
durable-draft mechanism or a guarantee to preserve every unmounted editor.
Already saved account/history remains in the server and is not replayed.
The [keyboard-navigation checkpoint](29-keyboard-screen-navigation.md) adds
non-disruptive committed-screen focus, a focusable skip target, keyboard-safe
mobile disclosure and reliable concurrent Search input. These do not complete
the broader accessibility or deployed-performance gates.

## Release and deployment

Build before packaging and promote `.next/standalone/`, `dist-server/`,
`package.json` and `package-lock.json` together. Next build and route manifests,
static chunks and public assets accompany the standalone runtime. Every
referenced script, CSS and media object must exist and be served as its original
bytes, not a compatibility SPA fallback. Runtime-only verification checks the
copied release without development tooling. CI explicitly includes hidden files
for the allowlisted `.next/standalone` path. Environment and data directories
remain outside those paths, and standalone preparation explicitly deletes any
traced `data` directory before upload. Verification must inspect the actual
downloadable archive as well as the pre-upload build directory.

An already open browser can request an old hashed route chunk long after its
initial page load. Do not overwrite/delete old hashed assets immediately during
a rollout. The eventual hosting/edge design must provide an approved retention
window and make old hashed assets reachable through load balancer/CDN routing;
retaining them on only one replica is insufficient.

Promote HTML and its asset set atomically. Define appropriate HTML revalidation
and immutable-asset caching/compression policies at the approved serving layer.
Keep rollback artifacts available and rehearse old-tab/new-release navigation.
These are operating requirements, **not infrastructure provisioned by this
checkpoint**. The later
[retained-asset checkpoint](53-retained-frontend-assets.md) can compose current
assets with explicitly mounted prior release asset directories on one runtime,
but does not provision or prove shared CDN/load-balancer/multi-replica
retention. A manual reload normally selects current HTML but does not repair an
incomplete deployment or a still-unavailable serving layer.

## Evidence and remaining gates

```sh
npm run content:metadata -- --check
TEST_DATABASE_URL=postgresql://... npm test
```

CI uses Playwright-managed Chromium; local commands may specify another installed
Chrome executable. The browser fixture creates an isolated PostgreSQL schema,
applies the immutable migrations and starts Next.js directly; no local-demo
authority or external provider key is required. It covers anonymous content,
worked solutions, premium access gates, deep links, search, mobile reflow and
theme behavior. Authenticated workflow acceptance lives in the Auth.js Next
runtime and exact-container suites.

Still required: editorial/free-paid offer/access-manifest review, broad keyboard/
screen-reader/contrast/mobile assessment, measured deployed cold/warm behavior,
large-history/API/load evidence, cache/compression/asset-retention operation,
independent security/recovery review and all provider/commercial/privacy/launch
approvals. Neither W12 nor the overall production roadmap is complete.
