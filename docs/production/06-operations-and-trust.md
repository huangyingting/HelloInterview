# 06 - Operations, support, moderation and trust

**Status: proposed operating specification.** Addresses GAP-02 and GAP-10
through GAP-19. Requirements are conditional on the feature being public;
unsupported features must be disabled, not merely omitted from navigation.

**Implemented platform checkpoint (W03):** pinned CI/release artifacts, a
non-root runtime image, private migration-gated staging, canonical origin/proxy
validation, readiness/draining, and private request telemetry are available.
An isolated fixture rehearses authenticated encryption and PostgreSQL restore.
See [the platform runbook](09-platform-implementation.md). This is not managed
hosting, durable backups/PITR, on-call coverage, or satisfaction of the launch SLOs.

**Implemented job checkpoint (W07):** durable transactional delivery, maintained
PostgreSQL workers, fenced finalization, bounded retry modes, verified-event
storage and audited maintenance replay are available. The
[job runbook](11-jobs-implementation.md) distinguishes synthetic crash/recovery
evidence from enabled email/payment/privacy handlers and operating approval.

**Implemented member-support checkpoint (W10):** owner-only request history,
immutable retry-safe receipts, shared write admission and current-session fences
are available. The [support runbook](26-owned-support-receipts.md) records
migration 20 and explicit saved/not-delivered UI. This is not an operated queue,
staff reply/MFA workflow, email/helpdesk delivery or privacy-retention approval.

**Implemented community-read checkpoint (W11):** all public post DTOs omit
stable account IDs, questions force anonymous labels, and server-derived
ownership replaces browser account comparisons. The
[community-read runbook](27-private-safe-community-reads.md) records migration
21, bounded cursor feeds, independent detail and full-body global search.
Managed contributions remain read-only; moderation, public-writing and reviewed
editorial-content approval are not implied.

**Implemented deferred-screen checkpoint (W12):** bounded transitive entry/
cold landing/sign-in JavaScript graphs, accessible loading, descendant failure
handling and explicit manual recovery preserve the application shell without
automatic reload or action replay. The
[screen-delivery runbook](28-deferred-screen-delivery.md) specifies artifact
completeness and old-chunk retention requirements. No deployed compression,
Core Web Vitals, complete accessibility assessment or launch approval is implied.

**Implemented keyboard-navigation checkpoint (W12):** the skip target and
committed-screen focus, closed mobile navigation/return focus, and rapid Search
input/history behavior are verified in the built browser. The
[keyboard runbook](29-keyboard-screen-navigation.md) describes non-disruptive
focus and composing-key boundaries. Real assistive-device/IME review and
broader contrast, validation, media/workspace and accessibility gates remain.

**Implemented opaque-address checkpoint (W11/W12):** query-addressed community
detail preserves exact bounded legacy IDs, local desired states and discussion
resources preserve actor/record identity, and malformed addresses fail explicitly
without blanking the production document shell. The
[address runbook](30-opaque-community-addresses.md) specifies old/new route
compatibility and managed denial, semantic query navigation and HTTP 400
document recovery. Ordered writes, historic comment repair, moderation and
customer-migration approval remain separate.

**Implemented bounded browser-runner checkpoint (W12):** client-only
synchronous JavaScript examples now have exact source/case/input/result/
structure limits, a private worker reply port, independent parent validation,
network denial and deterministic cleanup. Practice/project UI explicitly says
the visible examples are not authoritative grading and the browser is not a
reliable memory sandbox. The
[runner runbook](47-bounded-browser-example-runner.md) records the residual
renderer-memory boundary and disable-rather-than-overclaim fallback. D10
frontend/security acceptance, broader browser/device evidence and launch
approval remain open.

**Implemented coarse-pointer checkpoint (W12):** controls, application
navigation, tabs, pagination and form fields receive 44 CSS-pixel minimum
targets under `pointer: coarse`; checkbox/radio labels expose a matching hit
area while inline prose links remain exempt. Production-built mobile Chromium
checks sampled auth, shell, learning, community, account and support screens
for dimensions, overlap and horizontal overflow. The
[touch-target runbook](48-coarse-pointer-touch-targets.md) records scope and
rollback. Physical-device, alternate-engine, assistive-technology, contrast,
zoom and complete WCAG approval remain open.

**Implemented critical-flow contrast checkpoint (W12):** production-built
light/dark browser acceptance computes direct text and placeholder contrast
through rendered ancestor colors and gradient stops, checks the shared solid
focus outline, and exercises alert/current-page semantics across auth, shell,
learning, community, account and support. The
[contrast runbook](49-critical-flow-contrast.md) records exact thresholds,
token corrections, image-background failure behavior and exemptions. Broad
WCAG, forced-colors, assistive-technology, alternate-engine, physical-device
and launch approval remain open.

**Implemented local owner-contribution checkpoint (W11):** private owned
snapshots, current-session/revision-fenced title/body edits, exact discussion
deletion and serialized post-comment admission are available. The
[owner runbook](31-owned-community-contributions.md) records migration 22 and
in-page conflict/lost-response recovery without replay. Examples remain
immutable and managed owner management stays denied; this is not immutable
history, moderation operation, comment deletion or account/privacy deletion.

**Implemented local comment-editing checkpoint (W11):** server-derived viewer
ownership, private current-session/CAS snapshots and text-only author edits
share the in-page post editor without loading it into cold initial screens.
The [comment runbook](32-owned-comment-editing.md) records migration 23,
parent-before-comment lock ordering, conflict/lost-response and close/filter
draft preservation. Managed writing,
moderation operation and comprehensive privacy workflows remain separate gates.

**Implemented bounded discussion checkpoint (W11):** the shared UI uses indexed
25/50-row live pages with explicit load/retry beyond the compatibility cap.
The [discussion runbook](33-bounded-discussion-pages.md) records migration 24,
minimized query/viewer-bound cursors and draft-safe concurrent creation/editing.
Loaded-row search, not full-history search or frozen export, is described
explicitly. Managed writing and the publication/privacy operating gates remain.

**Implemented local comment-submission receipt checkpoint (W11):** local
creation can atomically bind one actor/key/normalized input and recover a lost
response through explicit check or same-key retry. The
[receipt runbook](34-owned-comment-submission-receipts.md) records migration 25,
minimal immutable references without original comment text, bounded private
history, actual-session fences and non-resurrection after removal. This is not
retention approval, privacy export/deletion, moderation or managed writing.

**Implemented recoverable comment-deletion checkpoint (W11):** local comment
owners can publish one current-session, revision-fenced deletion through an
owner-scoped UUID request key. Migration 30 strips the saved author, body and
account ownership from the comment while retaining an explicit non-repliable
tombstone so existing replies keep their parent context. Immutable private
receipts permit exact retry after an uncertain response and retain no removed
comment text. The
[deletion runbook](39-recoverable-owner-comment-deletion.md) records structural
database guards, export scope and local schema upgrade behavior. This does not
approve legal retention, full privacy erasure, moderation or managed writing.

**Implemented community report/moderation checkpoint (W11):** authenticated
members can save exact UUID-keyed post/comment reports, and MFA/fresh
`moderator` or `administrator` staff can use a bounded queue with assignment,
dismiss, hide and restore actions. Migration 31 fences report and target
revisions, preserves immutable staff evidence, filters hidden posts from every
reader and projects hidden comments as non-repliable moderation tombstones.
The [moderation runbook](40-mfa-community-reports-moderation.md) records the
minimized DTO, privacy export and concurrency contract.

**Implemented community appeal/admission checkpoint (W11):** exact owners can
appeal one current hidden target revision with an exact UUID key, members can
read minimized bounded report/appeal status, and MFA/fresh moderators can
claim/release/deny/uphold with immutable evidence. Uphold restores the exact
hidden revision atomically. Managed report/appeal writes consume shared
PostgreSQL account and canonical-network admission buckets and fail closed when
that protection is unavailable. The
[appeal runbook](41-community-appeals-status-admission.md) records migration 32,
privacy export and failure behavior. External delivery, automated enforcement,
staffed targets, approved retention/interaction policy and managed writing
remain separate launch gates; reviewed restrictions and personal blocking are
added by runbooks 43 and 45.

**Implemented personal author-muting checkpoint (W11):** authenticated members
can privately mute one live contribution author with an exact UUID key, hide
that author's posts from all viewer-bound readers and retain comments only as
non-interactive personal tombstones. Exact revision-fenced unmute, bounded
minimized history, privacy exports without subject account IDs and shared
managed admission are included in migration 33. The
[mute runbook](42-privacy-safe-personal-author-muting.md) records concurrency,
privacy and failure behavior. Automated abuse policy, external notification,
staffing, approved retention/interaction policy and managed writing remain
gates; relationship-wide blocking is added by runbook 45.

**Implemented reviewed community-restriction checkpoint (W11):** fresh
MFA-authorized moderators or administrators can issue one exact report-bound
author-participation or reporter-submission restriction for 24 hours, seven days
or 30 days. Subject IDs stay server-only; admission is scope-specific; extension
and lift are revision-fenced; member status/privacy exports are minimized; and
staff reasons remain immutable private evidence in migration 34. The
[restriction runbook](43-reviewed-expiring-community-restrictions.md) records
lock order, expiry and failure behavior. Automated enforcement, permanent/global
suspension, external notices, approved abuse/interaction policy, staffing and
managed writing remain gates; personal blocking is added by runbook 45.

**Implemented exact restriction-appeal checkpoint (W11):** a restricted member
can submit one owner/key/restriction-revision-bound in-app appeal. A different
MFA/fresh moderator or an administrator can claim and deny, uphold or resolve
it. Uphold atomically lifts only the appealed active revision; stale, lifted or
expired revisions can only be resolved without changing later authority.
Migration 35 retains minimized member/staff/privacy surfaces and dual immutable
appeal/restriction evidence. The
[restriction-appeal runbook](44-exact-community-restriction-appeals.md) records
lock order, independence and failure behavior. External notices, approved
abuse/appeal policy, staffed response targets, managed writing and launch
approval remain gates.

**Implemented privacy-safe relationship-blocking checkpoint (W11):**
authenticated members can privately block one live contribution account with
an exact UUID key. Either active direction hides the two accounts' posts from
each other, renders direction-neutral comment safety tombstones and prevents
direct vote/follow/discussion/reply writes under one canonical account-pair
lock. Exact owner-only unblock, bounded minimized history, privacy export and
shared managed admission are included in migration 36. The
[blocking runbook](45-privacy-safe-community-account-blocking.md) records
privacy, concurrency and failure behavior. Approved interaction/retention
policy, global abuse response, external notification, staffing, managed writing
and launch approval remain gates.

**Implemented reviewed spam-triage checkpoint (W11):** every newly saved report
receives one bounded `community-spam-rules-v1` content-only suggestion with an
exact input hash, fixed inspectable signals, score and unlikely/uncertain/likely
label. Only the MFA/role-gated staff queue exposes it. An assigned moderator or
administrator can confirm or reject the suggestion once with revision-fenced
immutable evidence. Neither decision changes report, contribution, restriction
or account state. Migration 37 and the
[spam-triage runbook](46-reviewed-non-punitive-community-spam-triage.md) record
the false-positive, privacy, rollback and concurrency boundaries. Approved
policy, operated calibration, staffing, external notices, managed writing and
launch approval remain gates.

**Implemented managed staff-administration checkpoint (W10):** verified OIDC
`amr` can establish explicit MFA evidence for a managed session; privileged
staff admission additionally requires an active verified account, a current
12-hour/30-minute staff session and authentication/MFA within ten minutes. The
[staff runbook](35-mfa-staff-account-administration.md) records migration 26,
time-bounded append-only roles, exact masked lookup, revision-fenced account
status changes, epoch session revocation and transactional immutable audit. No
role is granted by default. Impersonation, other-staff changes, direct billing
or private-content authority, operated helpdesk delivery and comprehensive
physical privacy erasure remain unavailable.

**Implemented durable privacy-export checkpoint (W10):** migration 27 binds one
fresh-authenticated owner request to one `privacy.process` operation and one
immutable 24-hour database artifact. The
[privacy runbook](36-durable-owner-privacy-exports.md) defines comprehensive
owned-domain contents, secret/internal exclusions, explicit requested/
processing/ready/failed/expired states, integrity checks and the compiled
`privacy:process` / `privacy:worker` commands. External object storage, email
delivery, approved retention, processor erasure and account deletion remain
unavailable.

**Implemented owner deletion foundation (W10):** migration 28 records one open
owner request, immediately moves the account to restricted
`deletion-pending`, revokes peer sessions and permits a seven-day
fresh-authenticated cancellation path. The
[deletion runbook](37-owner-deletion-cooling-off-foundation.md) defines
restricted sign-in, `privacy.delete` due work and immutable explicit blockers.
The worker does not erase owner data or claim completion; billing, processor,
retention and backup-restore authorities remain required.

**Implemented in-app support operations (W10):** migration 29 adds a bounded
MFA/role-gated staff queue, revision-fenced assignment and handling state,
idempotent owner-visible replies and append-only staff evidence. The
[support operations runbook](38-mfa-in-app-support-operations.md) preserves
masked/minimized queue data and excludes staff identities from owner history
and exports. External email/helpdesk delivery, escalation, staffed SLA and
approved support retention remain unavailable.

## Operating model

Name accountable people before launch, even if one person initially fills
several roles. Each role needs a backup and an escalation route.

| Responsibility | Required owner |
| --- | --- |
| Product scope, entitlement promises and launch approval | Product owner |
| Availability, deployment, backups, security incidents | Engineering/on-call owner |
| Identity recovery, support triage, customer communication | Support owner |
| Payment policy, tax, refunds, disputes and reconciliation | Billing/finance owner |
| Privacy, processor agreements, deletion and retention | Privacy/legal owner |
| Curriculum correctness, rights and corrections | Content/editorial owner |
| Community reports, abuse, appeals and takedowns | Trust/moderation owner |

Paid launch requires an actual escalation arrangement, not an unmonitored
support form. If 24/7 staffing is unavailable, make the operating hours explicit
and choose smaller rollout limits rather than promise unsupported response times.

## Support and transactional communication

### Ticket lifecycle

```text
new -> triaged -> in_progress -> waiting_on_customer -> resolved -> closed
          \-------- escalated (billing / identity / engineering) --------/
```

Turn the current locally stored request into an owner-scoped conversation with
ticket ID, category, status, priority, assignee and delivery tracking.
Authenticated members can see their own tickets/replies. Public contact
requests require abuse protection and contact verification before sensitive
information is shared.

Launch categories: access/recovery, payment/refund, missing entitlement, data
privacy, content correction, technical issue and community report. Collect
minimal environment/request IDs, not full browser storage or automatic private
draft dumps. Allow explicit attachment of one report/snapshot with scoped
support permission and retention.

Use a hosted helpdesk or a small internal queue with staff-only reply handling.
Choose one system of record and define synchronization/deduplication if a
helpdesk is used. Do not build chat, ticketing, CRM and omnichannel support at once.

Proposed response targets: payment/access/privacy incidents triaged within one
business day, ordinary requests within two business days; critical active
service incidents use on-call escalation. Publish only targets the staffing
plan can meet. Resolution times depend on the issue and should not be implied.

### Email delivery

Use a transactional provider with authenticated sending domain, SPF, DKIM and
DMARC, approved templates, deliverability monitoring and separate staging/live
configuration. Verify bounce/complaint webhooks and suppress repeated delivery
to failed addresses. Do not store SMTP credentials in the repository.

| Message | Authority and deduplication |
| --- | --- |
| Verify/reset/security changes | Identity broker or app-owned lifecycle, not both sending competing tokens |
| Purchase receipt / invoice | Provider-hosted receipt; app can send a distinct welcome, not a duplicate invoice |
| Renewal failure / authentication required | One configured owner across Stripe and app; key by invoice and transition |
| Cancellation / expiry | Subscription state transition and approved notification policy |
| Export ready / deletion status | Privacy request ID and state; only verified contact |
| Support reply | Ticket message ID; private content minimized in email |
| Study reminders / marketing | Explicit preferences; separate subscription/unsubscribe rules |

Business transactions enqueue an outbox event. Delivery rows track pending,
sent, bounced, complained and failed status with retries. A ticket is **saved**
before it is **delivered**; UI should not claim an external agent has received it
unless the integration confirms the relevant state.

Support/in-app notices remain available when email fails. Security and legally
necessary billing messages are distinct from optional marketing consent.

## Community and moderation

The current community supports useful local actions but cannot be opened for
unmoderated public writing as-is. If moderation is not staffed, ship read-only
editorial content and disable write APIs.
Local original-post owner editing/deletion now follows the
[revision-fenced owner protocol](31-owned-community-contributions.md).
Local author comment text edits now follow
[runbook 32](32-owned-comment-editing.md). Public/managed writes and comment
deletion/reply-retention policy remain separate work; local
deletion is not the comprehensive privacy-erasure coordinator.
The shared paged reader and its loaded-only search now follow
[runbook 33](33-bounded-discussion-pages.md); live cursors are not privacy exports.
Authenticated reports and reviewed in-app hide/restore operations now follow
[runbook 40](40-mfa-community-reports-moderation.md). This provides the
provider-neutral queue and visibility mechanics. Owner appeals, minimized
member status and shared managed report/appeal admission now follow
[runbook 41](41-community-appeals-status-admission.md). Private personal author muting now follows
[runbook 42](42-privacy-safe-personal-author-muting.md); it is not account
blocking or a substitute for staffed abuse response. Reviewed expiring
participation/reporting restrictions now follow
[runbook 43](43-reviewed-expiring-community-restrictions.md); they are not
automated punishment, global suspension or an approved abuse/appeal policy, and
exact in-app review now follows
[runbook 44](44-exact-community-restriction-appeals.md). None of these
checkpoints authorizes external notices, approved response commitments or
managed contribution writes.

Launch requirements:

- Verified members can publish within rate and content limits.
- Public post/comment edit and delete flows use owner checks and revisions.
- Community rules prohibit confidential employer material, harassment, spam,
  impersonation and unauthorized content.
- Every post/comment has report controls; users can block/mute where necessary
  to avoid repeated unwanted interaction.
- New/high-risk contributions enter a review state or are held by bounded
  spam checks; automated classification does not make irreversible decisions.
- Moderators can hide/restore content and apply scoped, reasoned restrictions.
  Authors receive a notice and an appeal route.
- A rights/takedown process and repeat-abuse policy have an accountable owner.

Suggested moderation states:

```text
pending -> published -> reported -> reviewing -> retained / hidden / removed
                                      |
                                    appealed -> upheld / restored
```

Reports do not automatically remove content based only on report count; this
would enable coordinated abuse. Record evidence, actor, reason, timestamps and
appeal outcome with restricted access. Public removal notices must not reveal
the reporter or private investigative details.

### Privacy and pagination

An "Anonymous" label is insufficient if the API returns the author's stable
account ID. Public DTOs for anonymous questions must omit identity/linking
fields. Return `isMine` for the authenticated author rather than exposing
`authorId` to everyone. Moderators see the mapping only with authorized,
audited access. Explain that anonymity is from other members, not the service.

Filtering/search/sorting/pagination and independent post lookup are implemented
in the W11 read checkpoint; older posts no longer depend on the compatibility
1,000-row fetch. Cursor pages are not frozen exports. Enforce moderation/access
state consistently in search, direct reads, comments, exports and notification
previews.

Votes/follows should be idempotent desired-state operations, not unsafe retryable
toggles. Keep uniqueness constraints and abuse throttles. Recognition points
must not be farmed by replaying the same completion/contribution action.

## Privacy, legal and information boundaries

Publish real production terms, privacy notice, contact details, refund policy,
subprocessor information, support policy and community rules. The existing
local-demo pages cannot describe a service that sends identity, payment, email
and AI data to external processors.

Before launch, approve the operating entity, eligible countries/currency,
minimum age, data region, lawful processing grounds, processor agreements,
cross-border transfers and deletion/export response obligations. A proposed
adult-only policy needs an actual onboarding/enforcement decision.

No compliance certification is claimed by this plan. Legal and privacy
requirements depend on customer/merchant jurisdiction and actual processing.
Collect only data needed for the service; no employer-sensitive questionnaire,
government ID or broad repository permissions without a separate reviewed need.

### Proposed retention schedule

These are engineering defaults pending legal review; financial retention cannot
be finalized without jurisdiction. Shorter legal/customer obligations override
defaults. Every category needs an automated job and an exception/hold process.

| Category | Proposed retention / control |
| --- | --- |
| Active preparation records | While account is active, under disclosed storage limits; user-controlled deletion |
| Deleted private preparation/identity data | Remove from active systems within 30 days; follow 03 cooling-off and billing rules |
| Export object | Seven days; signed download link no longer than 24 hours |
| AI raw operational payload | Minimum needed for job completion; delete transient copies within seven days, separate from user-owned saved results |
| General request logs | 30 days; no tokens, answers, code, raw emails or full provider payloads |
| Restricted security/audit events | Proposed one year, subject to necessity/legal review and restricted access |
| Raw billing webhook payload | Proposed 90 days encrypted/restricted; retain minimal reconciled financial facts as legally required |
| Resolved support content | Proposed 12 months, with earlier removal/redaction for sensitive attachments |
| Analytics events | Pseudonymous, minimal events; proposed 13 months or shorter approved window |
| Database backups | 35-day encrypted PITR/backup window; deletion manifest replay on restore |
| Financial records | Jurisdiction-approved statutory schedule; do not hardcode an assumed universal number of years |

Document how deletion propagates to identity, email/helpdesk, AI, analytics and
object storage. Provider contracts must substantiate any promise such as
"not used for training" or "zero retention"; do not state it based on a product
name. Review AI data handling separately from basic account registration.

## Platform hardening and abuse controls

This is a readiness control set, not a finding that every item is currently
exploitable. An independent production security assessment remains a launch gate.

Use TLS, secure session cookies, CSRF protection, a configured canonical origin,
trusted proxy settings, request-size limits, output encoding, CSP, dependency
patching, secret management and parameterized database access. Preserve the
current browser code isolation without weakening the main application policy.

Rate-limit by risk and actor:

| Surface | Required dimensions |
| --- | --- |
| Login/signup/reset/verification | Broker policy plus IP/account controls; avoid account enumeration |
| Content and search | Account/IP read limits; bounded pagination and expensive queries |
| AI/jobs | User concurrency, short-window requests, monthly allowance, global provider/spend budget |
| Checkout/portal/refund/reconciliation | Verified account, per-user operation limits, idempotency |
| Community/comments/reports | User/IP limits, first-post controls and abuse escalation |
| Gift redemption when introduced | User/IP/code-attempt controls, atomic redemption |
| Support/export | User/contact/IP limits, bounded artifacts and generation concurrency |

Shared rate limits must remain effective across API replicas and restarts.
Coarse edge limits complement, not replace, user/resource-aware limits.
If a required limiter is unavailable, fail closed for expensive/auth-sensitive
actions with an explicit temporary error; ordinary safe public reading may use
a documented degraded mode.

Production should fail configuration validation if demo mode, insecure cookies,
test payment prices, missing critical secrets or wildcard callback origins
would be active. Disable creation of illustrative sample users/posts unless an
explicit editorial seed manifest is approved.

Staff access requires MFA, least privilege and auditable sensitive commands.
Logs redact authorization headers, cookies, reset/export URLs, payment tokens,
source contents and private behavioral text. Exporting production logs or
databases to a developer machine requires an approved process.

## Build, environments and deployment

Use isolated local/test, staging and production databases, object buckets,
identity tenants/connections, payment accounts/modes, webhook secrets, email
sending controls and AI budgets. Staging contains synthetic data by default.
Never use production customer credentials in browser fixtures.

W01 now builds server JavaScript into `dist-server/` and frontend assets into
`dist/`; `npm start` uses Node.js without development tooling. Vite is a
development-only dynamic import. `npm run test:runtime` verifies an isolated
`npm ci --omit=dev` release, including `.env` loading and restart persistence.
Build before omitting development dependencies, and never put the server
bundle in the public frontend directory. CI/IaC, immutable artifact promotion,
readiness/SLO monitoring, and managed recovery remain W03 and later work.

Pipeline:

1. Lockfile-based install; type-check; selected lint/format policy; unit/content/
   contract tests; secret/dependency checks.
2. Build server and browser artifacts; enforce protected-content graph/bundle
   checks; produce an immutable release artifact with version metadata.
3. Apply backward-compatible migrations through a single controlled runner,
   not concurrently in each replica's startup.
4. Deploy staging, run provider-sandbox/browser/accessibility checks and
   migration/restore scenarios for changed areas.
5. Promote the identical artifact behind controlled traffic; verify readiness
   and smoke journeys; keep a known-good compatible release.

Use expand/backfill/switch/contract migrations. Never drop a column still used
by the rollback version. Secrets are injected by the hosting secret manager;
rotate them using provider-supported overlap windows and an auditable runbook.

Liveness indicates the process can respond. Readiness checks required local
dependencies/schema compatibility and draining state. A transient AI/Stripe
outage should normally degrade those features, not remove every API replica
from serving already paid learning content.

Shutdown stops admitting new requests/jobs, drains within a bounded deadline,
releases/lets expire fenced leases and closes database pools. Stuck jobs remain
recoverable after termination.

## Observability and service objectives

Proposed initial objectives, to validate under staging load and staffing:

| Indicator | Target / measurement |
| --- | --- |
| Core service availability | 99.9% successful eligible core requests over a rolling 30 days, about 43 minutes error budget |
| Ordinary API latency | p95 under 500 ms server time at the agreed load; exclude long AI work and report those separately |
| Critical browser responsiveness | p75 LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 on representative public/account flows |
| Durable billing ingestion | p95 acknowledgement under two seconds after valid signature; no acknowledgement before commit |
| Payment-to-access delay | p95 under 60 seconds after provider confirmation; alert if oldest pending work exceeds five minutes |
| Background AI | p95 queue wait under ten seconds at admitted load; operation deadline and timeout rate reported separately |
| Backup recovery | RPO <= 15 minutes, RTO <= four hours, demonstrated by a timed restore |
| Privacy requests | Complete within the approved policy/legal deadline; alert well before breach |

Define request success by user outcome: do not inflate availability by ignoring
payment/provider failures or labeling errors as valid `200` responses. Separate
core API, login, checkout, AI and email indicators so dependency-specific failure
is visible. Monthly availability is an objective, not a contractual SLA unless
the business explicitly makes that commitment.

Structured logs/traces carry request ID, deployment version, module, duration,
safe error code and internal correlation IDs. Metrics cover error rate,
latency, event-loop lag, DB locks/pool saturation, queue age, webhook lag,
entitlement drift, AI tokens/cost, email failures and unresolved privacy jobs.
Avoid high-cardinality user IDs and private text in metric labels.

Alerts must name an owner and runbook. Alert on actionable symptoms, not every
retry. Release freezes apply when the core error budget is exhausted, billing
drift is unexplained or data durability is uncertain.

### Business and learning analytics

Instrument a small approved event catalog: verified registration, first saved
practice, quiz completion, premium discovery, checkout started, reconciled paid
activation, cancellation, refund and return-to-practice. Financial events come
from reconciled server facts, not a browser success-page view. Deduplicate by
business event ID and exclude demo/test accounts.

Product/finance dashboards should distinguish verified-to-active conversion,
checkout-to-paid conversion, weekly returning learners, voluntary/involuntary
churn, refunds, recurring revenue and AI cost per active paid user. Define
cohorts and revenue recognition with finance; invoice cash collected, MRR and
recognized revenue are not interchangeable. Use aggregate learning outcomes
and reviewed qualitative feedback rather than storing private answers in
analytics or optimizing solely for higher rubric scores.

## Required runbooks

| Incident | Immediate action | Recovery evidence |
| --- | --- | --- |
| Login provider unavailable | Preserve valid local sessions; stop unsafe recovery/linking; communicate scoped outage | New login/recovery probes succeed; queued invalidation signals reconciled |
| Paid customer missing access | Locate checkout/invoice by internal correlation; reconcile provider facts; use approved time-limited courtesy grant only if needed | Correct source grants, no duplicate charge, customer informed |
| Webhook backlog/worker failure | Keep durable ingestion; investigate lease/dead-letter state; replay original IDs | Inbox age normal, drift reconciliation clean |
| AI cost/error spike | Stop new dispatch with kill switch; retain drafts/reservations and disclose outage | Unknown jobs resolved, costs reconciled, controlled re-enable |
| Database loss/corruption | Freeze risky writes, declare incident, restore to isolated target | Timed RPO/RTO evidence, referential checks, deletion replay, provider reconciliation before reopening |
| Data/privacy incident | Restrict affected access, preserve scoped evidence, rotate affected credentials, notify privacy owner | Impact/notification decision, remediation, verified containment |
| Payment duplicate/refund dispute | Freeze implicated operation, reconcile actual provider objects, escalate billing | Audited resolution and accounting/grant consistency |
| Abuse/moderation surge | Rate-limit affected writes or switch community to read-only; retain appeal/support paths | Queue triaged, restrictions reviewed, false positives addressed |
| Email delivery failure | Stop retries to suppressed contacts, show in-app status, contact provider | Bounce/complaint state reconciled and critical messages retried safely |
| Deployment regression | Stop rollout; use schema-compatible app rollback or forward fix | Critical smoke checks and data integrity pass; no stale-database rollback |

Practice database restore and payment reconciliation before paid launch, then
at least quarterly and after major persistence changes. Restore drills must
include object references, identity mapping, deleted-user suppression, current
provider billing state and queued side effects. A database-only restore is not
a complete service recovery.

## Acceptance scenarios

| ID | Observable outcome |
| --- | --- |
| OPS-01 | A real staging support request reaches the staffed queue, replies appear only to its owner, and delivery failure is visible/retryable |
| OPS-02 | Anonymous public DTOs omit identity linkage; report/hide/appeal/edit/delete states apply to direct reads, lists, search and notifications |
| OPS-03 | All sensitive and expensive routes retain effective rate limits across replicas/restarts; disabled features cannot be invoked directly |
| OPS-04 | Production runtime starts from the immutable build without development tooling; bad environment configuration fails closed |
| OPS-05 | CI, migration sequencing, readiness, rollout and compatible rollback are reproducible from checked-in configuration |
| OPS-06 | Load and synthetic journeys establish the target envelope and generate working alerts to the named owner |
| OPS-07 | Restore meets RPO/RTO, reapplies deletions and reconciles provider events without duplicate email, charges or grants |
| OPS-08 | Privacy/legal/processor/retention decisions are approved; an end-to-end export/deletion rehearsal has completion evidence |
| OPS-09 | Keyboard/screen-reader/contrast/mobile checks cover auth, billing, learning and workspaces; unresolved critical accessibility issues block launch |
| OPS-10 | No secrets/private answers appear in telemetry; staff MFA and role/audit boundaries are demonstrated |
