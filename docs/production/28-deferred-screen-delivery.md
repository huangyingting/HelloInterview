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

The private-content build guard still examines every browser module, and the
content-boundary checks scan every emitted JavaScript/map/HTML asset, including
deferred chunks. Splitting code is not protection for paid content: authorized
server readers, immutable quiz snapshots and owned data remain authoritative.

## Fixed JavaScript budgets

Vite emits `dist/.vite/manifest.json`. For each budget, traverse **all transitive
static `imports`**, using a visited set to handle cycles and count each file
once. Do not traverse `dynamicImports` as though every screen were eager.
Cold-screen measurements are the union of the entry graph and that screen's
static dependency graph, not just its named output file.

| Graph | Raw JavaScript ceiling | Gzip-estimate ceiling | Measured raw bytes | Measured gzip-estimate bytes |
| --- | --- | --- | --- | --- |
| Entry | 350 KiB | 100 KiB | 294,502 | 93,858 |
| Cold landing | 350 KiB | 100 KiB | 301,107 | 97,007 |
| Cold sign-in | 350 KiB | 100 KiB | 310,731 | 100,010 |

These are one release build's measurements; hashes and sizes can change.
The tests enforce the ceilings independently of these recorded numbers.
The published pre-split entry was 630,436 raw bytes; the new eager entry is
approximately 53% smaller. Sign-in includes its managed-identity dependencies
even when local mode renders the local form.

Gzip values sum reproducible `gzipSync` encodings of each selected asset. They
are **encoding estimates**, not observed compressed transfers or a promise that
the current Express/edge configuration delivers compression. The budgets do
not include CSS, HTML, images, media, API response sizes or request overhead.
They establish neither Core Web Vitals, interaction latency nor a load SLA.
No cosmetic vendor splitting or increased threshold is used to hide eager bytes.

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

Build before packaging and promote `dist/`, `dist-server/`, `package.json` and
`package-lock.json` together. The manifest accompanies the browser artifact.
Every referenced script, CSS and other manifest asset must exist and be served
as its original bytes, not an HTML SPA fallback. Runtime-only verification
checks the complete manifest from a copied release without development tooling.

An already open browser can request an old hashed route chunk long after its
initial page load. Do not overwrite/delete old hashed assets immediately during
a rollout. The eventual hosting/edge design must provide an approved retention
window and make old hashed assets reachable through load balancer/CDN routing;
retaining them on only one replica is insufficient.

Promote HTML and its asset set atomically. Define appropriate HTML revalidation
and immutable-asset caching/compression policies at the approved serving layer.
Keep rollback artifacts available and rehearse old-tab/new-release navigation.
These are operating requirements, **not infrastructure provisioned by this
checkpoint**. Single-directory local serving cannot promise multi-release
asset retention. A manual reload normally selects current HTML but does not
repair an incomplete deployment or a still-unavailable serving layer.

## Evidence and remaining gates

```sh
npm run content:metadata -- --check
CHROME_PATH=/usr/bin/google-chrome npm run test:screens
```

CI uses Playwright-managed Chromium; local commands may specify another installed
Chrome executable. No new test dependency or external provider key is required.

The focused tests verify fixed transitive graph budgets, navigation metadata
projection, exact cold browser requests, every manifest asset's actual served
bytes, delayed loading with a usable persistent shell, query/alias state,
owner changes, synthetic asset outages and descendant render failures.
Failure tests navigate away/back, demonstrate document-cached failure, restore
the asset, reload explicitly and compare saved account/history while ensuring
no user mutation replay. Existing managed identity/billing/support/expiry,
local learning/workspace/community, private-content, compiled-runtime and
container/recovery suites remain release gates.

Still required: editorial/free-paid offer/access-manifest review, broad keyboard/
screen-reader/contrast/mobile assessment, measured deployed cold/warm behavior,
large-history/API/load evidence, cache/compression/asset-retention operation,
independent security/recovery review and all provider/commercial/privacy/launch
approvals. Neither W12 nor the overall production roadmap is complete.
