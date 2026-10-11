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
