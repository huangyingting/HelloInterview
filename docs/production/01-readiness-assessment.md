# 01 - Production-readiness assessment

**Review baseline:** `b9db1ea`, 2026-10-11. **Conclusion:** do not expose the
current local deployment as a paid public service without the launch gates in
[07](07-delivery-roadmap.md).

This is a product/architecture readiness review, not a penetration test,
compliance opinion, live-provider certification, or reconstruction of another
company's backend.

## Current product and architecture

Interview Studio already connects discovery, original lessons, practice,
feedback, progress, quizzes, and community participation. Premium mock
interviews, custom quizzes, study plans, and imported project snapshots have
actual persistence and meaningful error handling. These workflows should be
retained, not rewritten simply to change frameworks.

The checked-in catalog documents seven tracks, 74 lessons, 59 exercises,
33 quiz topics, 443 questions, and seven courses. System Design, Coding, and
Low-Level Design have substantial source-informed material; the other four
tracks remain starter-depth. Inventory volume is not evidence of independent
expert review or customer learning outcomes.

```text
Browser
  React + Vite SPA
  shared catalog includes lesson bodies, solutions, quiz answers
  browser-only JavaScript worker/iframe runner
        |
        | cookie-authenticated JSON requests
        v
One Express process: server/index.ts
  local password authentication + sessions
  whole-account JSON state + relational community records
  local plan/gift activation
  synchronous SQLite access
  optional outbound AI calls in HTTP requests
        |
        +--> local SQLite WAL database
        +--> optional OpenAI-compatible provider
```

### Evidence map

Source links point to working-tree files; line references identify the review
baseline and may move during future implementation.

| Ref | Observed evidence | What it establishes |
| --- | --- | --- |
| E01 | [package.json](../../package.json), [server/index.ts:1-11](../../server/index.ts#L1-L11), [App.tsx](../../src/App.tsx) | React/Vite SPA and a single Express entry point; no identity/payment SDK in the manifest |
| E02 | [server/index.ts:50-90](../../server/index.ts#L50-L90), [148-160](../../server/index.ts#L148-L160) | SQLite schema created at startup; most personal data is one JSON state value per user |
| E03 | [server/index.ts:130-240](../../server/index.ts#L130-L240) | Password signup/login, scrypt, hashed session tokens, 30-day cookies, process-local auth throttling, password change/session revocation |
| E04 | [Explore.tsx:12-17](../../src/pages/Explore.tsx#L12-L17), [88-93](../../src/pages/Explore.tsx#L88-L93) | Local auth/profile UI; recovery explicitly unavailable; no social-login or connected-account UI |
| E05 | [server/index.ts:648-673](../../server/index.ts#L648-L673), [domain.ts:19-21](../../shared/domain.ts#L19-L21) | Authenticated users can activate/reset demo plans and create/redeem demo gifts; no payment confirmation |
| E06 | [Explore.tsx:19-31](../../src/pages/Explore.tsx#L19-L31), [types.ts:213-234](../../shared/types.ts#L213-L234) | Illustrative monthly/year/lifetime offers; a plan field and expiry, not a subscription ledger |
| E07 | [catalog.ts:1-10](../../shared/catalog.ts#L1-L10), [domain.ts:1-2](../../shared/domain.ts#L1-L2), [Learn.tsx:1-38](../../src/pages/Learn.tsx#L1-L38), [Quiz.tsx:1-41](../../src/pages/Quiz.tsx#L1-L41) | Full content and answer-bearing catalog is imported by browser code; visual premium gates do not make bundled content private |
| E08 | [server/index.ts:246-284](../../server/index.ts#L246-L284), [398-570](../../server/index.ts#L398-L570) | Existing server-side progress/premium write gates; revision checks and async-access rechecks in mocks/projects; not yet a uniform authorization layer |
| E09 | [server/index.ts:358-397](../../server/index.ts#L358-L397), [629-647](../../server/index.ts#L629-L647), [ai.test.ts](../../tests/ai.test.ts) | Optional provider, 45-second timeout, structured feedback validation, explicit failures, loopback provider fixtures; no usage ledger or provider-spend budget |
| E10 | [server/index.ts:589-628](../../server/index.ts#L589-L628), [Community.tsx:14-24](../../src/pages/Community.tsx#L14-L24) | Community CRUD subset; up to 1,000 posts fetched, client-side filtering/pagination; anonymous display still carries author ID in post DTO |
| E11 | [server/index.ts:241-245](../../server/index.ts#L241-L245), [674-681](../../server/index.ts#L674-L681) | Account export contains user plus JSON state, not all relational contributions/support records; tickets are stored but not routed |
| E12 | [server/index.ts:114-128](../../server/index.ts#L114-L128), [177](../../server/index.ts#L177), [683-707](../../server/index.ts#L683-L707) | Basic headers/origin checks, process-health response, static serving, minimal logging/shutdown; no checked-in readiness, structured telemetry, or production proxy configuration |
| E13 | [sandbox.ts](../../src/sandbox.ts), [PREMIUM-WORKFLOWS.md](../PREMIUM-WORKFLOWS.md) | Network-disabled browser execution with deadlines; project snapshots, not a remote execution or IDE service |
| E14 | [playwright.config.ts](../../playwright.config.ts), [tests](../../tests), [package.json](../../package.json) | Unit/content/provider-fixture/browser coverage exists; Chromium configuration; no lint or documentation-test command |
| E15 | [CONTENT-CURRICULUM.md](../CONTENT-CURRICULUM.md), [Explore.tsx:102-109](../../src/pages/Explore.tsx#L102-L109) | Draft curriculum limitations, short original videos, local-demo legal/privacy text |
| E16 | Tracked-file inventory, [.env.example](../../.env.example), [README.md](../../README.md) | No checked-in CI workflow, versioned DB migration system, container/IaC, deployment pipeline, or automated restore runbook at this baseline |

Absence from the repository does not establish that an external hosting account
or organization policy does not exist. Those external arrangements were not
available for verification. Runtime databases, credentials, and private
reference artifacts were not used for this assessment. Existing tests were
inspected, not re-certified as part of this documentation-only change.
The catalog totals above were checked directly from the exported source data.

## Gap register

Priority is tied to exposure, not a speculative vulnerability severity:
**P0 = required before public accounts**, **P1 = required before paid launch**,
**P2 = growth/post-launch**. A P1 feature may be built earlier, but cannot be sold
before its gate is satisfied.

| ID | Area and current state | Production gap / impact | Priority | Owning design |
| --- | --- | --- | --- | --- |
| GAP-01 | Local password accounts work (E03-E04) | No verified signup, social identity, recovery, safe linking, or compromised-account process; customers can lose access | P0 | [03](03-identity-and-user-management.md) |
| GAP-02 | Session ownership checks and basic throttling exist (E03, E08, E12) | No shared abuse controls, staff roles, session inventory, consistent account-status/re-auth policy; async completion checks differ by route | P0 | [03](03-identity-and-user-management.md), [06](06-operations-and-trust.md) |
| GAP-03 | Demo plan/gift activation is explicit (E05-E06) | Anyone signed in can activate demo access; these routes must not remain production entitlement authorities | P0 isolation; P1 replacement | [04](04-billing-and-entitlements.md) |
| GAP-04 | Pricing/checkout UI exists (E06) | No actual checkout, payment confirmation, recurring billing, invoices, cancellation, tax handling, refunds, or disputes | P1 | [04](04-billing-and-entitlements.md) |
| GAP-05 | Boolean premium policy with expiry (E05, E08) | No feature grants, access-source provenance, grace rules, revocations, or usage limits; cannot explain why a customer has access | P1 | [04](04-billing-and-entitlements.md), [05](05-premium-and-content.md) |
| GAP-06 | Content is shared with browser; score computed server-side (E07-E08) | Paid lesson bodies/solutions and answer keys ship to unauthenticated clients; no secure assessment/content delivery boundary | P1 | [02](02-target-architecture.md), [05](05-premium-and-content.md) |
| GAP-07 | SQLite persistence and bounded archives (E02, E08) | Whole-account read/modify/write and unversioned schema do not support safe multi-instance writes or lifecycle queries; large bootstrap returns private archives wholesale | P0 | [02](02-target-architecture.md) |
| GAP-08 | Strong local preservation patterns in premium flows (E08-E09) | No durable background jobs, idempotent provider side effects, or uniform revision checks across all editable records | P0 foundation; P1 paid jobs | [02](02-target-architecture.md), [05](05-premium-and-content.md) |
| GAP-09 | AI is optional with honest labeling (E09) | No quota reservation, token/cost accounting, circuit breaker, live quality evaluation, consent record, or provider-retention approval | P1 if sold/enabled | [05](05-premium-and-content.md) |
| GAP-10 | Profile, password change, JSON export (E04, E11) | No verified email change, deletion/retention workflow, complete export, account suspension, or protected staff administration | P0 | [03](03-identity-and-user-management.md) |
| GAP-11 | Community posting and replies (E10) | No moderation, reports, appeals, edit/delete policy, spam response, or privacy-safe anonymous DTO; public contributions create operational liability | P0 if enabled | [06](06-operations-and-trust.md) |
| GAP-12 | Local tickets and toast errors (E11) | No customer notification delivery, support inbox, delivery retries, ticket status, escalation, or refund-support workflow | P0 support; P1 billing support | [06](06-operations-and-trust.md) |
| GAP-13 | Local health route and logs (E12, E16) | No measured SLOs, telemetry, alert ownership, dependency readiness, on-call runbooks, or reliable rollback evidence | P0 | [06](06-operations-and-trust.md) |
| GAP-14 | Local DB and manual backup guidance (E02, E16) | No automated encrypted backups, restore rehearsal, verified RPO/RTO, regional data-residency decision, or deletion-on-restore policy | P0 | [02](02-target-architecture.md), [06](06-operations-and-trust.md) |
| GAP-15 | Existing type/build and test commands (E14, E16) | No mandatory CI gates, provider sandboxes, billing lifecycle/concurrency tests, load evidence, accessibility audit, or deployment smoke gate | P0 base; P1 provider cases | [07](07-delivery-roadmap.md) |
| GAP-16 | Original substantial curriculum in three tracks (E15) | No editorial approval, versioned question history, publication lifecycle, correction workflow, or demonstrated instructional quality; other tracks are shallow | P1 for advertised scope | [05](05-premium-and-content.md) |
| GAP-17 | Responsive UI, themes, search, simple page titles (E01, E10) | No accessibility conformance evidence, full account/payment error-state coverage, field performance monitoring, or public SEO strategy | P0 accessibility; P2 growth | [05](05-premium-and-content.md), [06](06-operations-and-trust.md) |
| GAP-18 | Browser-only example runner (E13) | No independent production boundary review, strong memory/output budgets, or cross-browser assurance; not an authoritative judge | P0 if exposed | [05](05-premium-and-content.md) |
| GAP-19 | Explicit local-demo legal pages (E15) | No operating entity, supported-market/tax/refund decision, processor agreements, lawful retention/consent program, or production terms | P0 privacy; P1 commercial | [06](06-operations-and-trust.md), [07](07-delivery-roadmap.md) |

## Important distinctions

### Access control is present, but incomplete for a paid product

It would be inaccurate to say there is no backend authorization. The server
checks users and premium access on many mutations, and mock/project processing
rechecks access after provider calls. However, those checks do not protect
content already delivered in static JavaScript. A source split must include
transitive imports: `shared/domain.ts` imports the answer-bearing catalog, so
moving a single page's import is insufficient.

Likewise, the ordinary attempt evaluation path checks premium access before the
provider call but does not perform the same post-call entitlement check as mocks
and projects. The target is one policy covering reads, writes, queued execution,
and result publication, not more individually scattered checks.

### SQLite is not inherently unsuitable; this persistence model is the issue

The single-process synchronous implementation avoids interleaving inside some
local mutations. It is not evidence that multiple app instances can safely
read and replace the same JSON blob, or that separate gift/user/state writes
are atomic. PostgreSQL is recommended for shared transactions, worker
coordination, managed recovery, and future billing queries. A framework or ORM
change alone would not fix whole-state replacement.

### Existing premium functionality is valuable

Adaptive mocks, quiz resumes, progress-linked plans, project baseline
preservation, and exports are real behaviors. Preserve them while adding
versioned data, quotas, reliable background work, server-side content delivery,
and transparent billing. Do not promise live IDE integration, unlimited
expensive AI, or employer-certified assessments.

### Local success is not an operating service

Passing a development browser flow would not establish payment reconciliation,
customer recovery, accessibility, content correctness, or disaster recovery.
Each needs a specific release artifact and accountable owner.

## Recommended launch scope

Retain learning, ordinary practice, quizzes, private stories, personal progress,
and the four current premium tools. Launch only editorially approved materials
as paid benefits. Enable community writing only after moderation is staffed;
otherwise publish clearly labeled editorial examples as read-only content.

Remove production demo entry, demo entitlement reset, unrestricted gift
creation, lifetime offers, and unsupported claims. Keep their local equivalents
available in isolated development mode. A later roadmap can add gifts, richer
media, improved pedagogy, and integrations after reliable commerce is operating.

The next step is [the target architecture](02-target-architecture.md), followed
by the dependency and approval gates in [07](07-delivery-roadmap.md).
