# Production application blueprint

**Status: design with incremental implementation.** Reviewed on 2026-10-11 against
commit `b9db1ea`. [Implementation progress](07-delivery-roadmap.md#implementation-progress)
now records runtime and persistence foundations. These documents describe how to turn Interview Studio into an
operable, paid interview-preparation service. They do not certify the current
application as production-ready.

## Executive recommendation

Keep the existing React/TypeScript experience and Express backend. Evolve the
backend into a **modular monolith**, backed by managed PostgreSQL, with a
separately deployed worker from the same codebase. Buy identity, hosted checkout,
transactional email, and infrastructure rather than building those systems.
Separate public content metadata from protected content before charging for it.

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

Read 01 and 07 for prioritization; use 02 as the technical foundation, then the
relevant feature specification. The roadmap's work-package IDs are intended to
be copied into future issues. Acceptance IDs in the feature documents describe
observable outcomes, not implementation checklists.

## Scope and assumptions

| Assumption | Working decision | Must be validated before |
| --- | --- | --- |
| Audience | Individual adult software-engineering candidates; not a hiring/evaluation product | Public terms and onboarding |
| Commercial scope | Direct-to-consumer web subscriptions, one initial currency and a restricted supported-country list | Enabling live checkout |
| Identity | Managed identity broker; Auth0 is the reference candidate, not an approved vendor purchase | Identity implementation |
| Billing | Stripe Checkout, Billing, and Customer Portal, subject to merchant eligibility and jurisdiction | Billing implementation |
| Hosting | Single primary region, managed database with high availability and point-in-time recovery | Infrastructure provisioning |
| Team | Small product team; no dedicated platform organization assumed | Schedule commitment |
| Existing data | Local data may be valuable; migration requires an explicit owner-approved inclusion policy | Any data migration |
| Product promise | Preparation assistance, not hiring predictions, accreditation, or current insider company reports | Marketing publication |

These are reversible planning defaults, not inferred business requirements.
Actual prices, tax treatment, legal policies, identity-vendor plan eligibility,
AI provider terms, and staffing remain approval gates in
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
