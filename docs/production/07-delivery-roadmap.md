# 07 - Delivery roadmap and launch gates

**Status: implementation in progress, not a promise of dates.** The original code
baseline is `b9db1ea`. Completion is recorded below; remaining design/approval
gates are not implicitly satisfied by a foundation change.

## GitHub delivery tracking

The issues below mirror the work packages, with acceptance checklists, owning
modules, dependencies, evidence and explicit approval boundaries. Closed
engineering checkpoints record published work, not approval of a whole
production feature. An open package can therefore contain a closed checkpoint.

| Package | Delivery issue | Published checkpoint |
| --- | --- | --- |
| W00 - Product/provider decisions | [#1](https://github.com/huangyingting/HelloInterview/issues/1) | [#15 - Blueprint](https://github.com/huangyingting/HelloInterview/issues/15) |
| W01 - Compiled runtime | [#2 - Completed](https://github.com/huangyingting/HelloInterview/issues/2) | Recorded in the delivery issue |
| W02 - Persistence/cutover | [#3](https://github.com/huangyingting/HelloInterview/issues/3) | [#16 - Persistence foundation](https://github.com/huangyingting/HelloInterview/issues/16) |
| W03 - Operated infrastructure | [#4](https://github.com/huangyingting/HelloInterview/issues/4) | [#17 - CI/container/recovery foundation](https://github.com/huangyingting/HelloInterview/issues/17) |
| W04 - Operated identity/recovery | [#5](https://github.com/huangyingting/HelloInterview/issues/5) | [#18 - Identity/session foundation](https://github.com/huangyingting/HelloInterview/issues/18) |
| W05 - Governed content publication | [#6](https://github.com/huangyingting/HelloInterview/issues/6) | [#19 - Protected content/quiz history](https://github.com/huangyingting/HelloInterview/issues/19) |
| W06 - Production premium authority | [#7](https://github.com/huangyingting/HelloInterview/issues/7) | [#20 - Immutable entitlement foundation](https://github.com/huangyingting/HelloInterview/issues/20) |
| W07 - Operated workers/delivery | [#8](https://github.com/huangyingting/HelloInterview/issues/8) | [#21 - Durable-job foundation](https://github.com/huangyingting/HelloInterview/issues/21) |
| W08 - Authentic payment lifecycle | [#9](https://github.com/huangyingting/HelloInterview/issues/9) | [#22 - Sandbox billing/subscription lifecycle](https://github.com/huangyingting/HelloInterview/issues/22) |
| W09 - Approved AI dispatch | [#10](https://github.com/huangyingting/HelloInterview/issues/10) | [#23 - Usage/native-intent/provenance foundation](https://github.com/huangyingting/HelloInterview/issues/23) |
| W10 - Staff/support/privacy | [#11](https://github.com/huangyingting/HelloInterview/issues/11) | [#24 - Private member-support receipts](https://github.com/huangyingting/HelloInterview/issues/24); [#28 - MFA staff account administration](https://github.com/huangyingting/HelloInterview/issues/28) |
| W11 - Community lifecycle/moderation | [#12](https://github.com/huangyingting/HelloInterview/issues/12) | [#25 - Reads/local ownership/pagination](https://github.com/huangyingting/HelloInterview/issues/25); [#27 - Comment submission receipts](https://github.com/huangyingting/HelloInterview/issues/27); [#32 - Recoverable comment deletion](https://github.com/huangyingting/HelloInterview/issues/32); [#33 - MFA community reports/moderation](https://github.com/huangyingting/HelloInterview/issues/33); [#34 - Appeals/status/shared admission](https://github.com/huangyingting/HelloInterview/issues/34); [#35 - Personal author muting](https://github.com/huangyingting/HelloInterview/issues/35); [#36 - Reviewed community restrictions](https://github.com/huangyingting/HelloInterview/issues/36); [#37 - Exact restriction appeals](https://github.com/huangyingting/HelloInterview/issues/37); [#38 - Privacy-safe account blocking](https://github.com/huangyingting/HelloInterview/issues/38); [#39 - Reviewed non-punitive spam triage](https://github.com/huangyingting/HelloInterview/issues/39) |
| W12 - Reviewed/accessible product | [#13](https://github.com/huangyingting/HelloInterview/issues/13) | [#26 - Deferred/keyboard/address recovery](https://github.com/huangyingting/HelloInterview/issues/26); [#40 - Bounded browser example runner](https://github.com/huangyingting/HelloInterview/issues/40); [#41 - Coarse-pointer touch targets](https://github.com/huangyingting/HelloInterview/issues/41); [#42 - Critical-flow text/focus contrast](https://github.com/huangyingting/HelloInterview/issues/42); [#43 - Critical form instructions/validation](https://github.com/huangyingting/HelloInterview/issues/43) |
| W13 - Integrated acceptance/launch | [#14](https://github.com/huangyingting/HelloInterview/issues/14) | Pending |

The migration-26 staff-administration checkpoint is tracked in
[#28](https://github.com/huangyingting/HelloInterview/issues/28), under W10.
It completes the first staff MFA/RBAC/audit and account-restriction slice while
keeping delivered support and comprehensive privacy/retention work open. The
migration-25 comment-submission receipt checkpoint is tracked in
[#27](https://github.com/huangyingting/HelloInterview/issues/27), under W11; it
does not retroactively change the migration-24 checkpoint. After this bounded
staff slice, continue the larger support/privacy milestone
[#11](https://github.com/huangyingting/HelloInterview/issues/11) and integrated
acceptance [#14](https://github.com/huangyingting/HelloInterview/issues/14).
Provider, commercial, customer-migration and public-launch approvals remain
explicit gates; issue creation or closure cannot supply them.

## Implementation progress

| Package | Status | Delivered boundary |
| --- | --- | --- |
| W00 | Business/provider approvals pending | Proceeding with reversible local engineering foundations; no provider purchase, data migration, or production-launch approval |
| W01 | Implemented | Separate configuration/application/database/process lifecycle; compiled Node.js runtime; lazy development Vite; runtime-only release verification; startup and bounded shutdown checks |
| W02 | Persistence checkpoint implemented; real-data cutover pending D05 | Async SQLite/PostgreSQL boundary; controlled migrations; owned record tables; atomic writes and revision conflicts; explicit dry-run/reconciled import without demo or password authority; two-replica PostgreSQL tests |
| W03 | Provider-neutral checkpoint implemented; managed deployment pending D04/D06 | Pinned CI and release artifacts; non-root/read-only container; migration-gated private staging; proxy/origin validation; fail-closed service mode; readiness/draining; private request telemetry; encrypted fixture dump/restore |
| W05 | Content-delivery checkpoint implemented; editorial/service authority pending W06/W12 | Allowlisted browser discovery graph; private readers/briefs/media; version-pinned server quiz sessions/checks/reports; readable/exportable owned history; migration 2 and replica/bundle checks |
| W07 | Durable-job checkpoint implemented; provider/worker composition pending W08-W10 | Maintained PostgreSQL queue, controlled schema/policies, atomic operation/inbox/outbox, fenced completion, safe retries, audited replay and actual worker-death recovery |
| W04 | In progress; private identity, shared admission and credential-lifecycle checkpoints implemented | Maintained OIDC verification, email/Google/GitHub reference connections, secure sessions/CSRF, fresh linking, paired PostgreSQL legacy proof, shared admission, signed reset revocation, read-only canonical security facts and compiled maintained-queue reconciliation; live delivery, operated alerts, notifications, broker-native abuse controls and imported-account recovery remain |
| W06 | Entitlement engineering checkpoint implemented; issuing adapters and commercial authority pending W08/W10/W12 | Immutable owned source grants, terminal revocation, database-clock capability policy, API/worker admission and publication checks, separate content-only access, licensed project snapshots, expiry-aware UI and retained archives |
| W08 | In progress; sandbox notifications, owned Checkout/recheckout, canonical funding/ledger, gated service authority, owned stop/resume cycles and restricted Portal checkpoints implemented | Pinned official Stripe SDK/API, signed durable evidence, stable owned financial keys, complete funding/adjustment traces, default-off calendar grants/scoped revocations, acknowledged exact-target renewal/recheckout with retained paid history and fresh restricted card-method/invoice sessions with URL-free audit; authentic provider evidence, commercial/grace policy, history partitioning/paid deletion and operated lifecycle remain |
| W09 | In progress; internal usage-ledger, native-intent and saved-input provenance checkpoints implemented | Explicit immutable sandbox manifests, atomic replica unit/cost/native/private-input reservations, pinned operation/job/generation, owned source/model/prompt hashes, exact UTF-8 bounds, transactional raw-payload retirement, overlap-safe original-calendar windows, unknown holds and coupled cancellation/SQL settlement; actual managed provider dispatch, consent/UX, model/token/cost policy, operating reconciliation and approval remain |
| W10 | In progress; member receipts, MFA staff administration, durable exports, deletion cooling-off and in-app support operations implemented | Private paginated receipts; MFA/role-gated support queue with revision-fenced assignment/status and owner-visible replies; exact masked account controls and immutable audit; fresh comprehensive exports; fresh deletion admission, restricted recovery, seven-day cancellation and explicit due blockers. Impersonation, external helpdesk/email, staffed SLA, physical erasure, processor/billing completion and retention approvals remain |
| W11 | In progress; private-safe reads, local owner/comment lifecycle, moderation, appeals, personal mute/block, reviewed restrictions and non-punitive spam-triage checkpoints implemented | Minimized DTOs with server ownership; bounded feeds/search/discussions/status; exact legacy-ID routing; revision-fenced owner edits/deletion; key-bound comment/report/appeal/mute/block/restriction-appeal recovery; MFA/role-gated report, appeal, expiring restriction, independent restriction-review and triage-review decisions with immutable evidence; atomic exact appeal/lift; narrow participation/reporting and relationship-locked direct-interaction admission; versioned bounded content-only spam suggestions with no automatic action; shared managed admission; consistent moderation visibility and direction-neutral personal filtering. Managed writing remains denied and retention/interaction/abuse-policy approval, external notices, operated calibration, staffing and publication gates remain |
| W12 | In progress; deferred-screen, keyboard, malformed-address, bounded browser-runner, coarse-pointer, critical-flow contrast and critical-form semantics checkpoints implemented | Separated discovery graphs, fixed cold JavaScript budgets, explicit loading/failure/recovery, semantic ready-screen/skip focus, keyboard-safe mobile navigation, rapid Search, invalid-address recovery, explicit client-only runner limits/private replies, coarse-pointer 44 CSS-pixel targets, computed light/dark text/placeholder/focus contrast, and stable form instructions/native invalid focus/request suppression with live outcomes; reviewed offers, D10 acceptance, broad accessibility, assistive-technology/physical-device review and operated serving remain |
| W13 | Pending | Integrated provider lifecycle, load/recovery/security evidence and operating/launch gates |

W01 preserves existing local accounts, SQLite schema, demo entitlements, API
contracts, curriculum, and UI. `NODE_ENV=production` means built asset serving,
not authorization to operate the proposed public paid service. Commercial
configuration and removal of production demo authority remain explicit later
packages. W02 retains the full-state read DTO while writing individual owned
PostgreSQL records; scoped content/history response APIs remain later work.
The [W02 implementation runbook](08-persistence-implementation.md) records
schema and revision contracts. The
[W03 platform runbook](09-platform-implementation.md) records deployment and
recovery boundaries. Managed hosting, region, TLS/edge, durable secrets/backups,
and operating approvals remain unresolved; no live infrastructure was provisioned.
W04 identity requires D01 provider approval; W05 content work can proceed
independently. No existing user data may be imported without D05 owner approval.
The [W05 content runbook](10-content-implementation.md) records the shipped
public/private DTOs, immutable quiz snapshots, legacy limitations, and media
delivery. Content flags/free access are unchanged; this is not editorial approval
or production entitlement authority.
The [W07 job runbook](11-jobs-implementation.md) records queue migration,
idempotency, worker/replay contracts and recovery. It proceeds independently of
vendor selection; no live handler, email delivery or provider purchase is implied.
The [W04 identity runbook](12-identity-implementation.md) records its opt-in
broker profile, migrations 4-6, sessions/linking, shared admission, authenticated
password revocation, canonical reconciliation and remaining delivery/operating gates.
It does not authorize a tenant purchase, real-user account beta or password-reset
recovery claim; service mode remains disabled.
The [W06 entitlement runbook](13-entitlements-implementation.md) records
migration 7, immutable source authority, capability policy, archival licensing,
client expiry behavior and trusted issuing-adapter requirements. No checkout,
approved price, staff grant endpoint or external AI allowance is implied.
The [W08 notification runbook](14-billing-implementation.md) records migration 8,
own-account sandbox signatures, minimized durable evidence, read-only canonical
observations and compiled worker operation. The
[owned checkout runbook](15-owned-sandbox-checkout.md) records migration 9,
durable server correlations, captured SDK parameters, bounded unknown-outcome
recovery and fresh authenticated sandbox UI. The
[canonical ledger runbook](16-canonical-sandbox-ledger.md) records migration 10,
owned subscription/invoice/line/payment-reference observations, bounded
historical reads, notification handoff and dirty-revision fencing. The
[payment-evidence runbook](17-sandbox-payment-evidence.md) records migration 11,
narrow sandbox card funding, complete allocations, historical reversals/credits
and consistency/terminal guards. The
[sandbox service-authority runbook](18-sandbox-service-authority.md) records
migration 12, explicit default-off calendar eligibility, trusted immutable
invoice-scoped issuing/revoking adapters, strict sandbox adjustments, policy
continuity and fresh UI permissions. The
[owned cancellation runbook](19-owned-sandbox-cancellation.md) records migration
13, fresh owned stop-renewal requests, bounded idempotent provider updates,
atomic canonical confirmation and preserved paid access. The
[restricted Portal runbook](20-restricted-sandbox-portal.md) records migration 14,
explicit default-off configuration, fresh owned synchronous preparation,
restricted card-method/invoice policy, minimized audit without bearer URLs,
unknown opening/lifecycle limitations and untrusted returns. The
[owned renewal-cycle runbook](21-owned-sandbox-renewal-cycles.md) records migration
15, explicit same-quote resumption consent, current funded-calendar admission,
immutable exact-predecessor cycles, stale replay protection and bounded
canonical recovery without access extension. The
[ended-subscription recheckout runbook](22-owned-ended-subscription-recheckout.md)
records migration 16, exact-parent fresh new-purchase consent, a scoped current
Checkout cursor, same-customer stable SDK creation/recovery and retained paid
history with independently eligible new invoice intervals. None establishes
eligible commercial service periods, live subscription entitlements, an operated
lifecycle or live-mode approval.
The [W09 usage-ledger runbook](23-sandbox-ai-usage-ledger.md) records migration 17,
internal accounting authority, source continuity, captured user/cost windows,
unknown-outcome holds and atomic publication/settlement. It is not managed AI
dispatch permission. The [native-intent runbook](24-owned-ai-native-intents.md)
records migration 18 and atomic pinned accounting admission/cancellation, with
explicit denied native provider authority. The
[saved-input runbook](25-owned-ai-input-provenance.md) records migration 19,
actual owned saved-source/model/prompt provenance, exact private UTF-8 snapshots
and transactional source/owner raw-payload retirement. Actual provider/claim/
privacy-consent/token/budget-policy composition remains.
The [W10 member-support runbook](26-owned-support-receipts.md) records migration
20, narrow owner-only receipts/history, retry-safe creation and shared support
write admission. It enables no staff reply, external delivery or privacy
completion. The [W10 staff runbook](35-mfa-staff-account-administration.md)
records migration 26, verified explicit OIDC MFA evidence, expiring append-only
role grants, minimized exact account lookup, administrator-only revision-fenced
status changes/session revocation and atomic immutable audit. It enables no
impersonation, role UI, private preparation access, financial authority,
helpdesk/email operation or comprehensive privacy completion.
The [W10 privacy-export runbook](36-durable-owner-privacy-exports.md) records
migration 27, fresh owner request/download admission, idempotent durable work,
comprehensive owned preparation/identity/access/usage/community/support/
sandbox-billing artifacts, 24-hour database expiry and integrity verification.
It enables no external object storage, email delivery, approved retention,
processor erasure, account deletion or paid-deletion completion.
The [W10 owner deletion runbook](37-owner-deletion-cooling-off-foundation.md)
records migration 28, fresh UUID-keyed admission, immediate restricted account
authority, peer-session revocation, seven-day cancellation, restricted recovery
sign-in and durable due work. Due work publishes explicit billing, processor,
retention and backup-restore blockers; it performs no physical erasure and
cannot claim completed or paid deletion.
The [W10 in-app support runbook](38-mfa-in-app-support-operations.md) records
migration 29, MFA/role-gated queue reads, revision-fenced assignment/status,
idempotent owner-visible replies and immutable staff evidence. It enables no
email/helpdesk delivery, automatic escalation, staffed SLA or approved support
retention.
The [W11 community-read runbook](27-private-safe-community-reads.md) records
migration 21, minimized public identities, query/viewer-bound cursor feeds and
independent full-text detail across Community and global Search. It preserves
local contributions but authorizes no managed writing or editorial publication;
at that checkpoint staff moderation, reports/appeals, abuse and operating
approval remained. Migrations 31-32 now supply bounded reports, reviewed
hide/restore mechanics, exact owner appeals, minimized member status and shared
write admission. Migrations 33-37 add personal author muting, reviewed expiring
participation/reporting restrictions, exact restriction appeals and private
relationship-wide account blocking plus deterministic staff-reviewed
non-punitive spam suggestions, while external delivery, approved
interaction/retention/abuse policy, operated calibration, staffing and
operating approval remain.
The [W11 comment-deletion runbook](39-recoverable-owner-comment-deletion.md)
records migration 30, exact owner/key/revision receipts, stripped comment
identity/text and non-repliable tombstones that preserve existing reply context.
It supplies no legal retention/privacy-erasure approval, staff moderation or
managed-writing authority.
The [W11 moderation runbook](40-mfa-community-reports-moderation.md) records
migration 31, authenticated owner/key-bound reports, a minimized MFA/role-gated
queue, revision-fenced claim/dismiss/hide/restore actions and consistent
post/comment visibility. The
[appeal/admission runbook](41-community-appeals-status-admission.md) records
migration 32, exact owner/key/hidden-revision appeals, minimized member status,
revision-fenced uphold/deny, atomic restoration and shared PostgreSQL
account/network admission. Reviewed restrictions follow in migration 34; these
earlier checkpoints supply no external notification, automated abuse response,
moderation staffing, retention approval or managed-writing authority.
The [personal-mute runbook](42-privacy-safe-personal-author-muting.md) records
migration 33, exact desired-state receipts, private author resolution, central
viewer-bound post filtering, non-interactive comment tombstones, minimized
history/export and shared managed admission. That checkpoint alone supplies no
relationship-wide account blocking, automated abuse response, notification,
retention approval, staffing or managed-writing authority; runbook 45 adds the
separate private blocking boundary.
The [reviewed restriction runbook](43-reviewed-expiring-community-restrictions.md)
records migration 34, exact report/target/restriction revisions, server-only
author/reporter resolution, fixed expiry, narrow participation/reporting
admission, immutable staff evidence and minimized status/export. It supplies no
automated enforcement, permanent/global suspension, external notice, approved
abuse/appeal/interaction policy, staffing or managed-writing authority;
runbook 45 adds the separate private blocking boundary.
The [restriction-appeal runbook](44-exact-community-restriction-appeals.md)
records migration 35, exact owner/key/restriction-revision admission,
independent moderator review, atomic exact uphold/lift, stale resolution,
immutable dual evidence and minimized member/staff/export surfaces. It supplies
no external delivery, response SLA, approved abuse/appeal policy, staffing or
managed-writing authority.
The [relationship-blocking runbook](45-privacy-safe-community-account-blocking.md)
records migration 36, exact owner/key desired-state recovery, server-only
subject resolution, direction-neutral pair filtering/tombstones, canonical
relationship locks, minimized owner history/export and shared managed
admission. It supplies no global moderation action, notification, approved
interaction/retention policy, determined-abuse guarantee, staffing or
managed-writing authority.
The [reviewed spam-triage runbook](46-reviewed-non-punitive-community-spam-triage.md)
records migration 37, one bounded versioned content-only suggestion per new
report, staff-only minimized signals and exact confirm/reject evidence. It
uses no AI provider or account history and cannot change report, target,
restriction or account state. Approved policy, operated calibration, external
notices, staffing and managed-writing authority remain open.
The [W12 deferred-screen runbook](28-deferred-screen-delivery.md) records the
fixed eager/cold graph budgets, compatibility metadata split, persistent shell,
explicit loading/failure and manual reload, actual built-chunk browser evidence
and multi-release asset-retention requirements. It changes no capability or
content-access flag and establishes no Core Web Vitals, serving-compression,
editorial, broad accessibility or public-launch approval.
The [bounded browser-runner runbook](47-bounded-browser-example-runner.md)
records exact source/case/input/result/structure budgets, a private worker reply
port, fail-closed parent validation, deterministic cleanup and truthful
client-visible/non-authoritative/no-memory-quota UX. It adds no remote execution,
hidden tests, grading authority or D10 security/accessibility approval.
The [keyboard-navigation runbook](29-keyboard-screen-navigation.md) records
readiness-aware main focus without interrupting form/query work, mobile
disclosure visibility/return focus, and canonical concurrent Search input.
The [critical-form semantics runbook](50-critical-form-semantics.md) records
stable instruction references, native invalid-control focus, zero invalid-
submit API requests and live rejected-login/local-support outcomes across
compiled local auth, account and support forms. Human screen-reader/device/IME
review and wider managed-provider, workspace and form-validation
assessment remain; no complete accessibility or operating approval is inferred.
The [opaque-address runbook](30-opaque-community-addresses.md) records exact
legacy-ID browser/API roundtrips, shared old/new route fences, local desired
states and exact post discussions, malformed-document recovery, and semantic
detail-query focus. It does not approve managed writing, ordered intent
replay, ambiguous historic comment reassignment or customer migration.
The [owned-contribution runbook](31-owned-community-contributions.md) records
migration 22, private owner snapshots, title/body-only CAS edits, current-session
admission and exact discussion deletion serialized with comment creation.
Explicit in-page comparison/adoption and deletion preserve drafts after
conflicts or lost responses without replay. Examples remain immutable; this
enables no managed writing, immutable content history or privacy-deletion claim.
The [owned-comment runbook](32-owned-comment-editing.md) records migration 23,
private author-only text snapshots/edits, minimized public viewer ownership,
user/session/post/comment lock order and shared on-demand author controls.
Conflict/lost-response, close/filter and superseded-read recovery preserve
drafts without replay. Comment deletion/retention and managed writing remain
separate unapproved boundaries.
The [bounded-discussion runbook](33-bounded-discussion-pages.md) records migration
24, indexed query/viewer-bound live comment pages and a shared UI without the
500-row stop. Explicit loading/retry and scoped functional merges preserve
drafts and show new comments immediately without duplication. Loaded-row search
is labeled honestly; frozen export, full-history search and publication gates
remain.

## Delivery strategy

Build vertical slices that preserve the existing product. Do not expose real
customers while identity, persistence and deletion are still experimental.
Do not charge while billing, content authorization or support are incomplete.

The smallest credible paid launch is Free/Pro, verified email plus Google/
GitHub login, existing approved learning/premium workflows, hosted billing and
portal, reliable saved work, bounded AI if enabled, staffed support and operated
infrastructure. Community writing is conditional on moderation readiness.

An intentional feature reduction is acceptable only if marketing, navigation,
direct API behavior and customer entitlements all reflect it. A hidden button
is not a disabled backend capability.

## Phases and exit gates

| Phase | Outcome | Exit gate |
| --- | --- | --- |
| 0 - Product and provider decisions | Approved launch scope, markets, operating owners, identity/billing/provider fit and risk assumptions | Decisions D01-D07 assigned and blockers resolved; no live charging |
| 1 - Production foundations | Modular persistence, migration, deployable runtime, secure identity, privacy/support skeleton | Internal staging can handle complete owned-data lifecycle and recovery |
| 2 - Safe account beta | Verified users learn/practice with server-authorized content and reliable saves | GATE-A: controlled real-user account beta |
| 3 - Paid product | Verified subscriptions, entitlement matrix, AI quotas, billing support and reviewed content | GATE-B: limited paid cohort |
| 4 - Operated launch | Recovery drills, load/accessibility/security evidence and sustained lifecycle correctness | GATE-C: broader public launch |
| 5 - Expansion | Gifts, richer content, optional integrations and growth optimizations | Each feature has its own business case and acceptance gate |

Community/moderation and content review can proceed in parallel with foundations.
Billing may be developed in sandbox before account beta, but cannot be switched
to live mode before its dependencies and legal approvals.

## Work-package backlog

Estimates are **engineering person-weeks**, including focused implementation
and automated tests, not calendar weeks. They exclude vendor approval queues,
legal review time and most human content authoring/review. The broad total is
approximately **23-44 engineering person-weeks**; staffing and integration
discoveries can change it substantially.

Do not add estimates mechanically to infer a date: packages have shared code,
dependencies and reviewer bottlenecks. For two experienced full-stack engineers,
a part-time product/design owner and available operations/content/legal support,
plan in terms of several months rather than a one-week provider integration.
Re-estimate after Phase 1; this is not a delivery commitment.

| ID | Deliverable and bounded scope | Dependencies | Owner | Estimate |
| --- | --- | --- | --- | --- |
| W00 | Confirm scope, providers, policies, price/quotas, acceptance harness and rollout plan; record decisions | None | Product + tech lead | 0.5-1 |
| W01 | Extract app composition/config/domain seams; compiled production runtime; preserve current local behavior | W00 | Backend/platform | 1-2 |
| W02 | PostgreSQL schema/migrations, scoped repositories, revisions, owner indexes, import/reconciliation rehearsal; remove whole-state write authority | W01, D05 | Backend | 3-5 |
| W03 | CI, staging/prod IaC, secrets, TLS/proxy, readiness, telemetry, backup foundation and release artifacts | W01, D04, D06 | Platform | 1.5-3 |
| W04 | Managed registration, Google/GitHub login, verification/recovery, sessions, linking, basic account UI and legacy transition | W02, W03, D01 | Identity/full-stack | 2-4 |
| W05 | Server-only content/answer graph, versioned publication/import, safe DTOs, authorized quiz sessions and migration-safe history | W02 | Learning/full-stack | 2-4 |
| W06 | Entitlement grants/policies, full route/worker matrix, replace demo authority, read-only archive policy | W02, W04, W05 | Backend/product | 1-2 |
| W07 | Durable job/outbox/inbox foundation, resource idempotency, fenced worker claims, delivery/replay tooling | W02, W03 | Backend/platform | 1-2 |
| W08 | Checkout/portal, billing tables, webhook verification, lifecycle/grace/refund/dispute reconciliation and customer account UI | W06, W07, D02, D04 | Billing/full-stack | 3-5 |
| W09 | AI reservation/settlement, job UX, budgets, consent/provenance and quality gates; preserve local rubric behavior | W05, W06, W07, D03 | AI/full-stack | 1.5-3 |
| W10 | Staff RBAC/MFA/audit, privacy exports/deletion, support queue/email, account restrictions and administrative commands | W04, W07, D06, D07 | Accounts/operations | 2-4 |
| W11 | Community owner edit/delete, server pagination, anonymous DTO, reports/moderation/appeals, abuse controls | W04, W07, W10 | Community/trust | 1-2 |
| W12 | Reviewed launch content/access manifest, correction/version policy, premium/account UX consistency, critical accessibility | W05, W06, D08, D10; W08-W10 for integrated UX | Content + frontend | 1-3 engineering, plus editorial work |
| W13 | Integrated provider lifecycle matrix, load/security/accessibility assessment, restore/rollback/payment drills, limited cohort operation | W03-W10, W12; W11 if community writes enabled | Tech lead + QA/operations | 2-4 |

W10 privacy deletion can be built against a billing-cancellation interface before
W08 completes, but **paid** deletion acceptance requires the W08 integration.
Similarly, administrative billing actions and full customer-support resolution
are not complete until tested against real sandbox billing facts.

Critical path: W00 -> W01 -> W02/W03 -> W04/W05 -> W06/W07 -> W08/W10 ->
W12/W13. W09 is on the paid-launch critical path only if AI is included in the
launch promise. Content review starts early; do not wait for checkout to discover
that marketed curriculum is not approved.

## Implementation slices and acceptance mapping

| Slice | Required behavior and evidence | Acceptance IDs | Primary gaps |
| --- | --- | --- | --- |
| Account creation/recovery | Verified registration, both social providers, interrupted/replayed auth, linking collision, reset invalidation, legacy ownership proof | IAM-01 through IAM-06, IAM-10 | GAP-01, GAP-02 |
| Owned data and migration | Scoped reads/writes, revision conflicts, deterministic import, zero unexplained data mismatches, private exports/deletion | IAM-08/09, FEAT-03/04/05, OPS-07/08 | GAP-07, GAP-08, GAP-10, GAP-14 |
| Protected learning | Browser import boundary, safe public previews, authorized nested resources, version-stable scoring/archive policy | FEAT-01/02/03/09, BILL-09 | GAP-05, GAP-06, GAP-16 |
| Checkout and subscription | Paid/unpaid/recovery/refund/dispute states, idempotency, raw signatures, reordering, repair, environment isolation | BILL-01 through BILL-12 | GAP-03, GAP-04, GAP-05 |
| Premium/AI work | Every tool has save/resume/access/expiry behavior; job reservation/concurrency/failure and provenance | FEAT-04 through FEAT-08 | GAP-08, GAP-09, GAP-18 |
| Staff/support/community | Staff limits, tickets/delivery, billing escalation, moderation/appeals, anonymous DTO, role audit | IAM-07, OPS-01/02/03/10 | GAP-02, GAP-11, GAP-12 |
| Operated service | Runtime artifact, CI/deploy/rollback, load/SLO/alerts, privacy/processor policies, security and accessibility evidence | OPS-04 through OPS-10, FEAT-10 | GAP-13 through GAP-19 |

Each future issue should contain: user outcome, owning module, exact data/API
changes, prerequisite IDs, failure states, migration/rollback impact, acceptance
IDs, telemetry, documentation changes and a named reviewer. Do not create
"add Stripe" or "add OAuth" issues with no lifecycle boundary.

## Test and validation strategy

### Preserve the existing baseline

Current commands, to run in implementation CI as appropriate:

```bash
npm ci
npm run build
npm run test:unit
npm run test:server
npm run test:runtime
npm run test:ai
npm run test:db
npm run test:content
npm run test:jobs
npm run test:identity
npm run test:identity-browser
npm run test:container
npm test
```

The build type-checks and emits frontend and standalone server artifacts.
Server tests cover configuration/startup, static/API behavior, isolation,
persistence, readiness, proxy/telemetry boundaries, and graceful/bounded shutdown.
Database tests require an explicitly dedicated `TEST_DATABASE_URL`.
Container tests require Docker and own isolated images, projects/volumes, and
fixture data for read-only execution and encrypted dump/restore. Runtime tests install an isolated
release without development dependencies. AI tests now use the compiled server
against a loopback fixture, not real-provider verification. Browser tests use
a Chrome executable and serialized local development server; CI now installs
Playwright-managed Chromium. `CHROME_PATH` still overrides the browser locally.

Do not simply make existing tests green by replacing all expected behavior.
Keep explicit checks for stable IDs, server scoring, saved reports after expiry,
project byte/patch preservation, latest-draft protection and source attribution.

### Add by work package

| Layer | Required cases |
| --- | --- |
| Unit/policy | Account state and role matrix, grant union/revocation, paid/grace boundaries, quota calendar math, retention transitions, editorial compatibility |
| Database integration | Migrations forward/compatible rollback, owner constraints, revisions, duplicate keys, concurrent last-unit reservation, grant/event dedupe, job fencing |
| Provider contract | OIDC claims/state/nonce/signature/error cases, verified identity events, Stripe raw signature/schema, email delivery statuses, malformed AI results |
| Provider sandbox | Both social-login callbacks, verification/reset deliverability, Stripe Checkout/Portal/action-required/renewal/refunds, authentic webhook delivery and replay |
| Browser | Visitor/unverified/Free/Pro/grace/expired/suspended journeys, account/billing cancellation, preservation after failures, archive export, accessibility/mobile |
| Content boundary | Build graph rejects private imports; distinctive protected fixture absent from JS/maps/HTML/previews/search; unauthorized endpoint and cache checks |
| Fault injection | Worker/API kill after external success and before DB commit, DB outage at webhook ingestion, reordered events, stale lease, provider timeout, email bounce |
| Migration/restore | Per-user data checksums/counts and rendered reports; encrypted restore, deletion replay, object integrity and post-restore billing reconciliation |
| Load/performance | Realistic large histories and 2x planned peak; p95 API/queue targets, DB locks/pool pressure, browser response sizes |
| Human review | Subject-matter content approval, screen-reader/keyboard flows, abuse/incident exercises, independent production security assessment |

Run deterministic fixtures on every relevant pull request. Use synthetic
provider sandbox tests before integration releases. Human social-provider
verification and a carefully approved live-payment smoke/void/refund may be
needed before opening paid access; no automated suite is authorized to make
unapproved real charges.

## GATE-A - Controlled real-user account beta

All must be true:

- Staging-to-production promotion is reproducible; secure identity, recovery,
  account status, session revocation, ownership and CSRF/proxy settings work.
- PostgreSQL migrations and an owner-approved data strategy are complete; no
  unknown local data is copied into production.
- Production demo signup/plan/gift routes are absent. Billing remains disabled
  or strictly sandbox-only; premium beta grants are audited and expiring.
- Export/deletion/support flows work and someone owns the queue.
- Privacy/terms, processors, data region, age/market policy and retention are
  approved for the beta's actual data use.
- Shared abuse controls, logs/alerts, backups and a restore rehearsal exist.
- Any enabled community writing has moderation; any enabled external AI has
  consent, bounded cost and verified provider behavior.
- No critical accessibility or independently identified security issue remains
  in the exposed account/learning flows.

Invite-only does not make a production data leak acceptable. Size the cohort to
support capacity and revoke unsafe capabilities with server-side flags.

## GATE-B - Limited paid cohort

GATE-A plus:

- Pricing, taxes, subscription terms, refund/cancellation and commercial entity
  are approved; supported payment countries/methods are configured.
- BILL-01 through BILL-12 pass in provider sandboxes, including reordered
  webhooks, duplicate checkout, renewal failure, refund and cancellation.
- No protected content or answer bank ships in public artifacts; the feature
  entitlement matrix is exercised on direct API calls.
- Customer can manage billing, retrieve invoices, cancel and reach support.
- Reviewed content/access manifest matches every advertised paid benefit.
- If AI is advertised: measured quality, exact quota windows, spend ceiling,
  reservation reconciliation and outage behavior are accepted.
- Restore and rollback preserve financial facts and newly saved work; missing
  entitlements can be repaired without arbitrary database edits.
- Live configuration is independently reviewed by engineering and billing
  owners. Any live smoke charge is explicitly authorized.

Use a capped cohort and monitor purchase-to-access delay, support volume,
payment recovery, grant drift, AI costs and retention.

## GATE-C - Broader public launch

GATE-B plus:

- At least two weeks of monitored limited-cohort operation with no unresolved
  money/access inconsistency, privacy incident or critical product-data loss.
- Monthly/annual renewal, cancellation and allowance boundaries are exercised
  with provider test clocks/fixtures; do not wait a year to validate annual
  behavior or claim two weeks alone proves it.
- Load tests meet the agreed envelope/SLOs; alert delivery and escalation are
  demonstrated, not merely dashboard screenshots.
- Timed restore meets RPO/RTO, includes deletion/object/provider reconciliation,
  and a compatible deployment rollback is rehearsed.
- Independent production security and accessibility reviews are resolved to
  the accepted risk policy, with explicit owners for nonblocking follow-ups.
- Support/moderation staffing, incident communications and billing reconciliation
  routines are in operation.

Do not wait for gifts, enterprise seats, mobile apps, live IDE sync or a full
CMS to pass GATE-C. Those do not compensate for a broken recovery/payment path.

## Rollout and rollback controls

Use server-evaluated environment/capability flags for live checkout, external
AI dispatch, community writing and newly introduced premium workflows.
Only authorized operators may change flags; record actor/reason/time.

Turning checkout off prevents new purchases, not webhook ingestion, cancellation,
refunds or existing-customer access. Turning AI off preserves saved work and
explicitly reports the unavailable capability. Turning community writes off
retains public reads, reports/appeals and customer-support routes where safe.

Never use a frontend-only flag as a security boundary. Never deploy a rollback
that reads an older SQLite snapshot after PostgreSQL has accepted customer
writes. Keep application releases/schema changes backward-compatible, and use
forward repair for financial or destructive migration changes.

## Decision register

| ID | Decision / recommended default | Accountable owner | Deadline and consequence |
| --- | --- | --- | --- |
| D01 | Managed identity: evaluate Auth0 against Google/GitHub/email, explicit app-owned linking, MFA, revocation, migration, regional and cost requirements | Tech lead + privacy | Before W04; substitute vendor if required capabilities are unavailable, not a homegrown OAuth shortcut |
| D02 | Stripe versus merchant-of-record model; approved recurring prices, currency, refund/grace rules and payment methods | Product + finance/legal | Before W08/live configuration; no commercial claims without approval |
| D03 | AI provider/model/retention, 100-unit draft allowance and operation weights, token/concurrency/spend ceilings, quality benchmark | Product + AI + privacy | Before W09/external AI beta; keep external AI disabled if unresolved |
| D04 | Merchant/customer countries, operating entity, age policy, data region, tax responsibilities and legal terms | Business + legal | Before real accounts for privacy; before payment for commercial rules |
| D05 | Whether any local accounts/data should migrate; ownership proof, sample/demo exclusion and courtesy-grant policy | Product + data owner | Before W02 import rehearsal; default is no unapproved production data import |
| D06 | Hosting/provider accounts, budget, on-call/support/moderation staffing and actual published response targets | Engineering + operations | Before W03 production provisioning / GATE-A |
| D07 | Retention/deletion/export scope, processor cleanup, audit duration, financial holds and recovery proof requirements | Privacy + support + finance | Before W10/GATE-A; no success claim while processor cleanup is unsupported |
| D08 | Exact free/paid resource manifest, expert review, archive license, storage caps and marketing scope | Product + editorial | Before W12/GATE-B; retain current free access absent a separate approved change |
| D09 | Community write launch versus read-only editorial scope | Product + trust | Before GATE-A; default read-only unless moderation is ready |
| D10 | Accessibility support matrix and browser-runner acceptance; remote execution explicitly excluded | Frontend + security | Before exposed beta flows; disable unsupported execution rather than imply safety |
| D11 | Future cadence changes, promotions/trials, gifts, enterprise and IDE/native scope | Product | After paid stability; require separate state/price/abuse design before provider features are enabled |

For each resolved decision, record date, chosen option, rationale, rejected
alternatives, approver and affected documents. Keep proposed values visibly
proposed until approval; a developer should not mistake a planning default for
a legally approved product promise.

## Post-launch roadmap

| Order | Candidate | Entry condition / reason to defer |
| --- | --- | --- |
| 1 | Better curriculum, independent reviews, richer examples, corrections and clearer learning recommendations | Core monetization stable; content quality is the closest product-value investment |
| 2 | Monthly/annual cadence switching, approved promotions, paid gifts | Billing operations and refund/reconciliation behavior proven |
| 3 | Better reminders, personalized review, learning analytics and public SEO | Measured retention/discovery need; consent and content-version boundaries intact |
| 4 | Longer original video courses and accessible transcripts | Rights, production budget, editorial ownership and private media delivery ready |
| 5 | Optional member MFA/passkeys, Apple login, additional languages/payment methods | Verified customer demand and supported provider lifecycle |
| 6 | Teams/enterprise seats or human coaching | Separate tenancy/seat/RBAC/invoicing or marketplace payout/compliance architecture |
| 7 | Live IDE integration, remote code judge, native apps | Independent security/platform investment and demonstrated business value |

Avoid expanding into all seven directions simultaneously. The priority is a
service customers can trust with their preparation work and money.
