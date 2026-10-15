# Production application blueprint

**Status: design with incremental implementation.** Reviewed on 2026-10-11 against
commit `b9db1ea`. [Implementation progress](07-delivery-roadmap.md#implementation-progress)
now records runtime and persistence foundations. These documents describe how to turn Interview Studio into an
operable, paid interview-preparation service. They do not certify the current
application as production-ready.

## Executive recommendation

Migrate the React/TypeScript experience to a **Next.js App Router modular
monolith** with Auth.js/NextAuth, Prisma-backed PostgreSQL and separately
deployed workers from the same codebase. The completed repository must not
retain Vite, Express, React Router, Auth0 compatibility or the SQLite service
runtime. Buy OAuth identity, hosted checkout, transactional email and
infrastructure rather than building those provider systems. Separate public
content metadata from protected content before charging for it.

Launch one coherent product: **Free plus Pro, with monthly and annual billing**.
Google, GitHub, and verified email/password registration cover the initial
identity scope. Preserve the existing learning loop and premium workflows;
invest first in identity recovery, payment correctness, content quality, reliable
saving, bounded AI costs, and customer support rather than more feature breadth.

The current application is a useful local product foundation, not merely a
static prototype. Its largest gaps are trust boundaries and operational
lifecycle: it cannot yet reliably verify a customer, recover their access,
collect and reconcile money, administer their account, or operate a public
service with defined recovery and support commitments.

## Reading guide

| Document | Purpose | Primary audience |
| --- | --- | --- |
| [01 - Readiness assessment](01-readiness-assessment.md) | Evidence-backed current state, gaps, priorities, and launch blockers | Product and engineering |
| [02 - Target architecture](02-target-architecture.md) | Deployment, modules, data model, APIs, consistency, migration, and architecture decisions | Engineering |
| [03 - Identity and user management](03-identity-and-user-management.md) | Registration, social login, linking, recovery, sessions, administration, and deletion | Product, identity, support |
| [04 - Billing and entitlements](04-billing-and-entitlements.md) | Checkout, subscriptions, payment lifecycle, access policy, refunds, and reconciliation | Product, billing, finance |
| [05 - Premium and content](05-premium-and-content.md) | Feature matrix, learning workflows, content delivery, AI budgets, and acceptance criteria | Product, learning, AI |
| [06 - Operations and trust](06-operations-and-trust.md) | Support, moderation, privacy, accessibility, deployment, observability, and runbooks | Operations and engineering |
| [07 - Delivery roadmap](07-delivery-roadmap.md) | Dependency-ordered work packages, estimates, release gates, and unresolved decisions | Delivery owners |
| [08 - Persistence implementation](08-persistence-implementation.md) | Shipped storage boundaries, schema, revisions, explicit importer, and cutover runbook | Backend and operations |
| [09 - Platform implementation](09-platform-implementation.md) | CI, container/staging boundaries, readiness, telemetry, promotion, and recovery rehearsal | Platform and operations |
| [10 - Protected-content implementation](10-content-implementation.md) | Browser-safe discovery graph, authorized readers/media, versioned quiz sessions, legacy reports and rollout | Learning and backend |
| [11 - Durable-job implementation](11-jobs-implementation.md) | Controlled maintained queue, inbox/outbox, idempotency, fenced workers, replay and crash/restore boundaries | Backend and operations |
| [12 - Identity implementation](12-identity-implementation.md) | Opt-in hosted OIDC, verified contact authority, secure sessions/linking, paired legacy proof and incomplete lifecycle gates | Identity and operations |
| [13 - Entitlement implementation](13-entitlements-implementation.md) | Immutable managed grants, server-clock capability authority, licensed archives and expiry-safe UI | Backend and product |
| [14 - Billing notification implementation](14-billing-implementation.md) | Test-only signed durable notifications, minimized read-only canonical evidence, compiled worker and remaining commercial boundaries | Billing and operations |
| [15 - Owned sandbox checkout](15-owned-sandbox-checkout.md) | Durable owned customer/session intents, immutable SDK idempotency, fresh resume/refresh, sandbox UI and unresolved financial lifecycle | Billing and full-stack |
| [16 - Canonical sandbox ledger](16-canonical-sandbox-ledger.md) | Owned subscription/invoice/service-line/payment-reference observations, dirty-revision fencing, historical handoff, private UI and explicit no-grant financial holds | Billing and operations |
| [17 - Sandbox payment evidence](17-sandbox-payment-evidence.md) | Linked card funding, complete allocations, historical refunds/disputes/credits, consistency and terminal guards, legacy compatibility and no commercial/service-period authority | Billing and operations |
| [18 - Sandbox service authority](18-sandbox-service-authority.md) | Default-off versioned calendar eligibility, immutable invoice-scoped grants and terminal adjustments, policy continuity, expiry-safe owned UI and unresolved commercial gates | Billing and full-stack |
| [19 - Owned sandbox cancellation](19-owned-sandbox-cancellation.md) | Fresh owned stop-renewal requests, bounded stable provider writes, unknown-outcome recovery, atomic confirmation and unchanged paid access; Portal/live/deletion gates | Billing and operations |
| [20 - Restricted sandbox Portal](20-restricted-sandbox-portal.md) | Default-off fresh owned card-method/invoice-history sessions, explicit restricted policy, minimized URL-free audit, honest hosted lifecycle and unchanged payment/access authority | Billing and full-stack |
| [21 - Owned sandbox renewal cycles](21-owned-sandbox-renewal-cycles.md) | Acknowledged same-offer resumption, funded current-period checks, immutable repeat cycles and exact predecessor replay guards, bounded recovery and unchanged paid access | Billing and full-stack |
| [22 - Ended-subscription recheckout](22-owned-ended-subscription-recheckout.md) | Exact-parent acknowledged new hosted test purchases, scoped current-attempt cursor, retained Checkout/source history, bounded same-customer creation/recovery and independently eligible new intervals | Billing and full-stack |
| [23 - Sandbox AI usage ledger](23-sandbox-ai-usage-ledger.md) | Internal atomic unit/cost reservations, original-calendar overlap-safe windows, unknown-outcome holds and fenced settlement; no managed provider permission | AI and backend |
| [24 - Owned AI native intents](24-owned-ai-native-intents.md) | Atomic owned reservation/native admission, pinned job/generation, explicit denied provider authority and coupled known-undispatched cancellation | AI and backend |
| [25 - Owned AI input provenance](25-owned-ai-input-provenance.md) | Actual saved-source/model/prompt fingerprints, exact UTF-8 private snapshots, atomic admission and transactional source/owner raw-payload retirement; no provider permission | AI and backend |
| [26 - Owned support receipts](26-owned-support-receipts.md) | Private member request history, immutable retry keys, current-session fences, shared write admission and truthful saved/not-delivered UX; no staff/helpdesk/email operation | Support and full-stack |
| [27 - Private-safe community reads](27-private-safe-community-reads.md) | Explicit public DTOs without account IDs, server-derived ownership, bounded query/cursor feeds, independent detail and body-aware cross-kind search; no public-writing/moderation approval | Community and full-stack |
| [28 - Deferred screen delivery](28-deferred-screen-delivery.md) | Bounded transitive cold JavaScript graphs, separated public metadata, accessible loading/failure, manual recovery and multi-release asset requirements; no launch/performance SLA approval | Frontend and operations |
| [29 - Keyboard screen navigation](29-keyboard-screen-navigation.md) | Non-disruptive ready-screen focus, skip target, hidden/dismissible mobile navigation and reliable rapid Search/URL behavior; no complete accessibility approval | Frontend and accessibility |
| [30 - Opaque community addresses](30-opaque-community-addresses.md) | Exact legacy-ID browser/API roundtrips, actor-scoped local desired states, exact post discussions and explicit malformed-address recovery; no managed-writing or historic-data repair approval | Community and frontend |
| [31 - Owned community contributions](31-owned-community-contributions.md) | Private local owner snapshots, revision/current-session-fenced original-post editing and exact thread deletion, explicit draft/lost-response recovery and migration 22; no managed-writing, immutable history or privacy-deletion approval | Community and full-stack |
| [32 - Owned comment editing](32-owned-comment-editing.md) | Private author-only local text editing, viewer-derived ownership, parent/comment lock ordering, shared draft/conflict recovery and migration 23; no comment-deletion, managed-writing or retention approval | Community and full-stack |
| [33 - Bounded discussion pages](33-bounded-discussion-pages.md) | Indexed 25/50-row, viewer/resource-bound live pages; explicit load/retry beyond 500, draft-safe concurrent creation/editing and migration 24; no frozen export, full-history search or managed-writing approval | Community and full-stack |
| [34 - Owned comment submission receipts](34-owned-comment-submission-receipts.md) | Atomic actor/key/input-bound local creation, explicit lost-response check/same-key retry, non-resurrecting minimal receipts and bounded private history in migration 25; no managed-writing, retention/privacy-erasure or moderation approval | Community and full-stack |
| [35 - MFA staff account administration](35-mfa-staff-account-administration.md) | Verified OIDC MFA and fresh staff admission, expiring append-only roles, exact masked lookup, revision-fenced account status/session revocation and immutable minimal audit in migration 26; no impersonation, delivered support or complete privacy lifecycle | Identity, operations and full-stack |
| [36 - Durable owner privacy exports](36-durable-owner-privacy-exports.md) | Fresh-authenticated owner-only durable export requests, comprehensive owned-domain artifacts, integrity checks, explicit failure/expiry and migration 27; no external delivery, retention approval, processor erasure or account deletion | Privacy, identity and backend |
| [37 - Owner deletion cooling-off foundation](37-owner-deletion-cooling-off-foundation.md) | Fresh owner request, immediate restricted authority, peer-session revocation, seven-day cancellation and immutable due blockers in migration 28; no physical erasure or external completion | Privacy, identity and backend |
| [38 - MFA-gated in-app support operations](38-mfa-in-app-support-operations.md) | Bounded staff queue, revision-fenced assignment/status, idempotent owner-visible replies and immutable evidence in migration 29; no email/helpdesk delivery or SLA | Support, identity and full-stack |
| [39 - Recoverable owner comment deletion](39-recoverable-owner-comment-deletion.md) | Owner/key/revision-bound local deletion receipts, stripped comment identity/text, non-repliable reply-preserving tombstones and migration 30; no retention/privacy-erasure or moderation approval | Community, privacy and full-stack |
| [40 - MFA community reports and moderation](40-mfa-community-reports-moderation.md) | Authenticated key-bound reports, MFA/role-gated bounded queue, revision-fenced hide/restore, immutable evidence and consistent post/comment visibility in migration 31; appeals are added separately in 41, with staffing, retention and managed-writing approval still open | Community, trust, identity and full-stack |
| [41 - Community appeals, status and shared admission](41-community-appeals-status-admission.md) | Owner/key/revision-bound appeals, minimized member status, MFA/role-gated uphold/deny, atomic restore and shared PostgreSQL report/appeal admission in migration 32; reviewed restrictions follow in 43, with no external delivery, automation, staffing or managed-writing approval | Community, trust, identity and full-stack |
| [42 - Privacy-safe personal author muting](42-privacy-safe-personal-author-muting.md) | Owner/key-bound private author mute state, central post filtering, viewer-only comment tombstones, exact unmute, minimized history/export and shared admission in migration 33; relationship-wide account blocking follows in 45, with no automation, staffing or managed-writing approval | Community, trust, privacy and full-stack |
| [43 - Reviewed expiring community restrictions](43-reviewed-expiring-community-restrictions.md) | Report-bound author-participation/reporter-reporting restrictions, exact staff authority/revisions, fixed expiry, narrow admission, minimized status/export and immutable evidence in migration 34; exact in-app appeals follow in 44, with no automation, permanent/global suspension, external notices, approved policy, staffing or managed-writing approval | Community, trust, identity and full-stack |
| [44 - Exact in-app community restriction appeals](44-exact-community-restriction-appeals.md) | Owner/key/restriction-revision-bound appeals, independent MFA/fresh review, atomic exact uphold/lift, stale resolution, minimized status/export and immutable evidence in migration 35; no external delivery, automation, approved policy/SLA, staffing or managed-writing approval | Community, trust, privacy, identity and full-stack |
| [45 - Privacy-safe community account blocking](45-privacy-safe-community-account-blocking.md) | Owner/key-bound private account-pair blocks, direction-neutral post filtering/comment tombstones, relationship-locked direct interaction, exact unblock and minimized history/export in migration 36; no global moderation, notification, approved interaction policy, staffing or managed-writing approval | Community, trust, privacy and full-stack |
| [46 - Reviewed non-punitive community spam triage](46-reviewed-non-punitive-community-spam-triage.md) | Bounded versioned content-only spam suggestions for new reports, staff-only minimized evidence and exact confirm/reject review in migration 37; no AI provider, automatic moderation, user risk scoring, approved policy, staffing or managed-writing approval | Community, trust, privacy and full-stack |
| [47 - Bounded browser example runner](47-bounded-browser-example-runner.md) | Explicit client-only source/case/input/result/structure budgets, private worker reply protocol, fail-closed result validation, cleanup and truthful non-authoritative/memory limits; no remote execution, authoritative grading, security approval or launch approval | Frontend, learning and security |
| [48 - Coarse-pointer touch targets](48-coarse-pointer-touch-targets.md) | Coarse-pointer 44 CSS-pixel control policy, checkbox/radio hit areas and production-built geometry/overlap/overflow evidence across critical flows; no broad WCAG, real-device, assistive-technology or launch approval | Frontend and accessibility |
| [49 - Critical-flow text and focus contrast](49-critical-flow-contrast.md) | Computed light/dark text, placeholder and keyboard-focus contrast thresholds across production-built critical flows, with shared token corrections and non-color status semantics; no broad WCAG, image-content, alternate-engine or launch approval | Frontend and accessibility |
| [50 - Critical form instructions and validation semantics](50-critical-form-semantics.md) | Stable names/instruction associations, native invalid focus, invalid-submit request suppression and live error/success outcomes across compiled local auth, account and support forms; no full form inventory, hosted-provider, assistive-technology or launch approval | Frontend and accessibility |
| [51 - Reduced motion in critical flows](51-reduced-motion-critical-flows.md) | Shared compiled CSS motion suppression, visible static loading, dynamic preference observation and manual algorithm progression; no complete vestibular/media, alternate-engine, physical-device or launch approval | Frontend and accessibility |
| [52 - Reflow, text spacing and forced colors](52-reflow-text-spacing-forced-colors.md) | 320 CSS-pixel reflow with WCAG text-spacing overrides plus system-color focus/current/progress evidence in forced-colors mode; no complete low-vision, screen-magnifier, alternate-engine, physical-device or launch approval | Frontend and accessibility |
| [53 - Retained frontend assets](53-retained-frontend-assets.md) | Current-first immutable hashed assets with explicitly mounted prior-release overlays, startup validation and asset-shaped 404s; no operated CDN/load-balancer, retention-duration, field-performance or launch approval | Frontend and operations |
| [54 - Azure OpenAI transport compatibility](54-azure-openai-transport.md) | Azure deployment routing, API-version/api-key support and authentic bounded `gpt-6.1-sol` application evidence; no managed dispatch authority | AI and backend |
| [55 - Privacy-safe field performance telemetry](55-privacy-safe-field-performance.md) | Default-off native LCP/CLS/INP observation with allowlisted screen/navigation dimensions, strict normalization/rate limits and no raw URLs or identifiers; no operated field evidence, SLO or launch approval | Frontend and operations |
| [56 - Approved invite-only private-beta boundary](56-approved-private-beta-boundary.md) | Approved free/read-only/no-managed-AI scope on the existing Azure Southeast Asia `WebStack` VM, USD 200 ceiling and named owner; explicit guest-database/no-SLA boundary with deployment, privacy and human-review evidence still open | Product and operations |
| [57 - Invite-only service runtime](57-invite-only-service-runtime.md) | Fail-closed service composition and verified-email admission with billing/AI/demo authority rejected; no authentic tenant, Azure guest deployment or participant acceptance | Identity and operations |
| [58 - Canonical HTTPS ingress](58-canonical-https-ingress.md) | Exact `interview.genisisiq.com` DNS/TLS Caddy ingress, loopback-only upstream and truthful 503 fallback; no application/Auth0/database deployment acceptance | Platform and operations |
| [59 - Azure guest runtime foundation](59-azure-guest-runtime-foundation.md) | Exact-artifact runtime image, separated PostgreSQL migration/runtime authority and disabled supervised app/worker units; no authentic service launch | Platform, database and operations |
| [60 - Private-beta Azure cost control](60-private-beta-cost-control.md) | Conservative USD 200 monthly shared-resource-group budget with staged owner notifications and explicit attribution limits | Platform, finance and operations |
| [61 - Participant policy runtime](61-participant-policy-runtime.md) | Fail-closed public controller/contact/age/retention/deletion/no-durability contract and managed privacy rendering | Privacy, identity and operations |
| [62 - Service launch preflight](62-service-launch-preflight.md) | Exact-release no-listener configuration/database/queue validation with bounded secret-free evidence | Platform, identity and operations |
| [63 - Next.js, Auth.js and Prisma migration](63-nextjs-authjs-prisma-migration.md) | No-legacy target architecture, social-provider policy, Prisma authority, route/session migration and cutover gates | Full-stack, identity and platform |
| [64 - Auth.js TOTP MFA and recovery](64-authjs-totp-mfa.md) | Encrypted app-owned TOTP, replay fencing, one-time recovery codes, session step-up and active-credential staff admission in migration 39; no support bypass or routine key rotation | Identity and security |
| [65 - Next.js owned sandbox billing](65-nextjs-owned-sandbox-billing.md) | Auth.js/CSRF owned billing Route Handlers, bounded raw Stripe webhooks and Prisma transaction-coupled worker completion; sandbox only with deployment and live-commerce gates remaining | Billing, identity and full-stack |
| [66 - Managed AI native worker](66-managed-ai-native-worker.md) | Explicit Azure model/pricing/data-use policy, native claim fencing, measured token cost and atomic Prisma result/usage/job completion; no participant producer yet | AI, privacy and operations |

Read 01 and 07 for prioritization; use 02 as the technical foundation, then the
relevant feature specification. The roadmap's work-package IDs are intended to
be copied into future issues. Acceptance IDs in the feature documents describe
observable outcomes, not implementation checklists.

## Scope and assumptions

| Assumption | Working decision | Must be validated before |
| --- | --- | --- |
| Audience | Individual adult software-engineering candidates; not a hiring/evaluation product | Public terms and onboarding |
| Commercial scope | Direct-to-consumer web subscriptions, one initial currency and a restricted supported-country list | Enabling live checkout |
| Identity | Auth.js with Google registration/login and explicitly linked Facebook login; Studio retains invite, account, linking and session authority | Authentic provider acceptance |
| Billing | Stripe Checkout, Billing, and Customer Portal, subject to merchant eligibility and jurisdiction | Billing implementation |
| Hosting | Invite-only beta exception: existing Azure Southeast Asia `WebStack` VM with guest PostgreSQL and no RPO/RTO promise; public/paid target remains managed recovery-capable infrastructure | External testers and any public/paid expansion |
| Team | Small product team; no dedicated platform organization assumed | Schedule commitment |
| Existing data | Local data may be valuable; migration requires an explicit owner-approved inclusion policy | Any data migration |
| Product promise | Preparation assistance, not hiring predictions, accreditation, or current insider company reports | Marketing publication |

The private-beta choices recorded in
[56](56-approved-private-beta-boundary.md) are approved; other rows remain
planning defaults where noted. Actual prices, tax treatment, legal policies,
identity-vendor plan eligibility, AI provider terms, and public-launch staffing remain approval gates in
[the decision register](07-delivery-roadmap.md#decision-register).

## Delivery boundaries

**Before public accounts:** secure identity and recovery, production data
storage, private-data authorization, retention/deletion, trustworthy deployment,
observability, and support. An invite-only beta is still a service handling real
people's data; it is not an exemption from these requirements.

**Before taking payment:** everything above, plus protected content delivery,
auditable billing and entitlements, invoice/payment-failure/cancellation/refund
flows, AI budgets, approved terms, and recovery drills. Do not sell features
whose availability or quality has not been established.

**After a stable paid launch:** richer content, gifts, selective premium
expansion, better personalization, and growth work. Enterprise workspaces,
human-coach marketplaces, native apps, live IDE bridges, and server-side code
execution are separate products, not launch prerequisites.

## How future implementation should use this blueprint

1. Confirm the relevant decisions and release gate before selecting a work
   package. Record changes to the design in its owning document.
2. Preserve stable content IDs, existing saved work, source attribution, and
   the distinction between local rubric feedback and provider-generated feedback.
3. Implement the vertical user journey, its permission checks, failure states,
   telemetry, migrations, and acceptance cases together.
4. Keep development/demo mode isolated from production. Nothing in this plan
   authorizes migrating demonstration entitlements into paid subscriptions.
5. Update the root README and existing local-workflow documentation only when
   the corresponding production behavior actually ships.

Repository evidence is in 01. Provider references appear beside the relevant
design. External documentation was consulted on 2026-10-11; recheck it and pin
supported SDK/API versions during implementation. No production identity,
payment, email, or hosting accounts were provisioned during this review.
