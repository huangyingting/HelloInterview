# 05 - Premium features, learning content and AI

**Status: proposed product specification.** Addresses GAP-05 through GAP-09,
GAP-16 through GAP-18. [04](04-billing-and-entitlements.md) owns commercial
entitlements; this document owns the product experience and consumption rules.
The [first W09 engineering checkpoint](23-sandbox-ai-usage-ledger.md) supplies an
internal owned allowance/cost ledger with overlap-safe calendar windows and
atomic settlement. It does not enable managed AI, approve the proposed values
below, bind native provider jobs or supply real-provider consent.

## Product promise and success criteria

Interview Studio helps candidates turn learning into deliberate practice,
useful feedback and a repeatable plan. It should sell depth, continuity and
feedback quality, not a paywall alone.

Retain the existing loop:

```text
Choose a goal -> learn a concept -> attempt a task -> receive feedback
      ^                                                 |
      +------ review missed ideas / adjust plan <--------+
```

Measure activation as a verified member completing a meaningful learning or
practice action and returning to the saved result, not simply account creation.
Product analytics should track completion and return behavior without storing
private answers/code in analytics events. Do not equate time spent or rubric
score with hiring readiness.

Initial differentiation is the combined workflow: sourced curriculum,
version-stable practice, private behavioral preparation, progress-aware plans,
and honest feedback. Human-reviewed curriculum and dependable saving are more
important than adding a new AI feature every release.

## Launch feature matrix

Access columns assume an active, verified account and no explicit safety hold.
Grace is the limited read-only renewal grace from 04; archive access is a
user-data right under the declared retention/license policy, not a paid tier.

| Capability | Visitor | Free | Pro | Grace / former Pro |
| --- | --- | --- | --- | --- |
| Catalog, pricing, approved public previews | Read | Read | Read | Read |
| Current free lessons/exercises and approved free solutions | Read public material | Read/save/practice | Same | Same |
| Premium lesson/course/solution bodies | Preview only | Preview only | Authorized read | Read only during eligible grace; otherwise preview |
| Ordinary free exercise attempts and local rubric | No persisted private work | Yes, rate/storage limits | Yes | Yes |
| Regular quizzes and review deck | Preview/sample | Yes | Yes | Yes |
| Private stories, bookmarks, targets, free progress | No | Yes | Yes | Yes |
| New premium exercise attempts | No | No | Yes | No |
| Adaptive mock interview creation/continuation | Discover | No | Yes | Owned draft/report read/export only |
| Custom mixed/missed-topic quiz creation/answering | Discover | No | Yes | Owned session/results read/export only |
| Company-focused study-plan creation/reflection edits | Discover | No | Yes | Owned plan read/export |
| Imported project creation/edit/review | Discover | No | Yes | Owned snapshot/report/patch read/export |
| External AI feedback/tutor | No | Not included at launch | Explicit consent plus allowance | No new calls |
| Local non-AI study helper | Public explanation | Authorized free-content retrieval | Includes authorized paid content | Free retrieval; owned history readable |
| Own completed reports/data export | No | Yes | Yes | Yes |
| Community read/contribute | Published read | Verified, subject to moderation | Same | Same |
| Support and billing resolution | Public contact | Yes | Yes | Yes |

Keep existing free resources free unless a separate product/content decision is
approved. Use current premium flags as a migration input, not as the final
editorial/business policy. Publish an explicit reviewed resource-to-access
manifest before paid launch so marketing, API gates, courses and previews agree.
Do not retroactively delete owned work when the manifest changes.

Do not advertise "unlimited" AI or storage. Capacity limits and allowance
remaining must be visible before starting a constrained activity.

## Preserving and improving existing workflows

### Learning and structured courses

Retain track discovery, outlines, bookmarks, exercise links and next-step
navigation. Fetch authorized content by stable ID/version. Courses consist of
versioned lesson, quiz, practice and media references; the server computes
completion from actual saved actions.

Existing completion records remain historical records for their course version.
New content can appear as recommended extension work, not silently make a
completed course incomplete. Completion remains evidence of finishing practice,
not accreditation, verified mastery or employment readiness.

Paid launch may focus its marketing on the three deeper tracks. Behavioral,
AI Coding, ML System Design and Salary Negotiation must remain clearly scoped
starter material until editorially expanded. Four short animations are not a
long-form video catalog. Do not create a media subscription promise until
recording rights, captions, hosting and editorial quality are ready.

### Ordinary practice and behavioral stories

Retain design diagrams, code/review explanations, timers, history, STAR stories
and exports. Add reliable autosave with visible `Saving`, `Saved`, `Offline`
and conflict states. A failed save retains local unsaved text and offers retry;
do not clear a draft merely because an HTTP request was sent.

Apply resource revisions to all editable records. Do not silently overwrite
another tab's version. Offer reload/compare rather than an invented automatic
merge of diagrams or code. Avoid persisting private material in long-lived
browser storage by default; any opt-in offline recovery needs disclosure and
logout cleanup.

Feedback carries provenance: local rubric, AI model/prompt version, exact
attempt revision and generation time. Editing invalidates the displayed
current evaluation, while history retains the older result against its input.
Never claim browser examples were independently executed by the server.

### Adaptive mock interviews

Preserve three/five-turn interviews and topic-gap follow-ups. The launch
interviewer can remain deterministic; it must be labeled as such, even when
answer grading uses AI.

Save the answer before requesting grading. Resume at the saved turn after a
reload. A submitted turn is immutable; editing earlier answers starts an
explicit new attempt rather than rewriting a completed transcript.

For AI grading, show the estimated cost of the whole selected interview and
remaining allowance before start, then charge/reserve per graded turn. If
allowance ends partway through, retain the draft and offer waiting for reset or
an explicitly labeled local-rubric continuation if the user chooses it.
Do not automatically substitute local feedback after an AI failure.

Finished reports summarize coverage, actionable next practice, feedback source,
input versions and limitations. No "probability of hire" or official-company
score. Expired accounts can read/export owned transcripts but cannot continue
new premium turns.

### Custom quizzes and regular quiz integrity

Preserve selected topics, missed-only mode, distinct questions, fixed order,
resume, canonical scoring and review-deck integration.

Use server sessions for both ordinary and custom quizzes. At creation, pin
question versions/order. Before answer reveal, send prompt/options only.
Accept answer or explicit skip with expected revision; validate against the
session's allowed next question. Finalization is idempotent.

Ordinary teaching quizzes can retain immediate explanations after an answer is
committed. Custom assessment-style sessions can retain results at completion.
This is a deliberate reveal policy, not a claim that all practice answers must
remain secret forever. Server scoring is authoritative in either mode.

Retakes create new sessions. Historical results retain the original question
wording, option order, explanation and score even after editorial correction.
An explicit score-correction workflow can annotate a report; never silently
regrade history or issue duplicate recognition.

### Preparation plans

Retain two/four-week schedules, company/level context and real progress-derived
completion. Describe company emphasis as original study curation, not insider
interview intelligence.

Store the selected time zone and local-date schedule alongside UTC event
timestamps. Define daylight-saving/month-boundary behavior. Existing UTC-day
streaks remain historical; switching to user-local learning days requires a
versioned rule and transparent migration, not retroactive streak loss.

Allow intentional rescheduling of incomplete tasks; do not move completed work.
Reflection edits use revisions. Reminder emails are opt-in and deduplicated;
unsubscribe does not disable security/billing notifications.

### Project workbench

Retain immutable imported baselines, exact bytes/newlines, bounded file import,
diff review, browser example execution and patch/JSON export.

Keep the current documented limits initially: 16 tracked files, 20,000
characters per file, and 120,000 current-content characters per snapshot.
Add explicit UTF-8 request/object byte budgets and account storage quotas;
character limits alone do not bound transport or retained-version size.
Validate path, type, encoding and size on both client and server.

Do not imply path filtering is a complete secret scanner. Warn before import
and before sending a diff to AI. Store private objects with ownership checks;
support cannot browse snapshots without a specific shared attachment.

Archive rather than discard completed work to make room for active projects.
Proposed active limits: 20 projects, 20 plans, 100 unfinished mocks/custom
quizzes per account, with abuse/storage limits independent of purchased tier.
Introduce archive/delete controls before removing current hard archive caps.
Any total storage cap must be approved, visible and enforced without deleting
old data to make a new save appear successful.

Live repository cloning, dependency installation, terminal sessions, multi-file
execution and IDE sync remain out of scope.

## Content architecture and editorial lifecycle

### Delivery contract

| Artifact | Delivery policy |
| --- | --- |
| Public catalog | Stable IDs, titles, descriptions, track, estimated duration, access label, approved preview and version metadata |
| Lesson body / worked solution | Authorized endpoint; check effective grant and publication state on every request |
| Unanswered quiz question | Prompt, option text and question version only |
| Answer/graded result | Revealed only under the session's teaching/assessment policy, scoped to the owner |
| Tutor retrieval | Server chooses passages only from currently authorized content; client cannot grant access by naming a lesson |
| Paid media | Private object/CDN origin, short-lived authorized playback access, captions/transcript and bounded caching |
| Archived report | Immutable owner-scoped snapshot including the originally licensed question/feedback context |

Public search indexes contain only approved public fields. Do not leak paid
bodies through previews, search snippets, source maps, prerendered pages, static
JSON, worker fixtures or the local helper. A member's content entitlement must
not influence a globally cached public response.

Protected distribution prevents unauthorized delivery; it is not DRM and cannot
prevent an authorized reader from copying visible content. Terms/licensing and
reasonable abuse controls must match that reality.

### Authoring and publication

Keep content as versioned source files at first, compiled/validated into
server-owned versions. Avoid introducing a CMS before an editorial workflow
exists. Production content metadata must include author/reviewer, source links,
originality/license status, last review date, difficulty, objectives and
publication/access state.

Lifecycle:

```text
draft -> technical review -> editorial/accessibility review -> approved
      -> published immutable version -> corrected successor / retired
```

Paid content requires an accountable human subject-matter reviewer. Automated
word counts, code examples and source-link checks remain useful quality gates
but do not substitute for review. Audit factual corrections and notify users
when a material error changes a learning conclusion.

Retirement removes new discovery but preserves required historical snapshots.
Do not reuse deleted IDs for unrelated exercises. Moderated removal for rights
or safety may require redaction even from history; record the reason and show
an explicit unavailable/redacted state rather than a broken reference.

Seeded community examples remain labeled and separate from user reports.
Do not convert examples into testimonials, import proprietary lessons, or
market a reference site's private functionality as implemented.

## AI allowance and cost-control design

### Proposed launch allowance

These numbers are planning defaults requiring measured unit economics and
product approval, not a committed pricing offer:

| Operation | Proposed user allowance units | Bounds |
| --- | ---: | --- |
| Tutor response | 1 | Bounded authorized retrieval and conversation context |
| Ordinary AI feedback | 2 | One saved attempt revision |
| Mock-turn AI feedback | 2 | One submitted turn with bounded prior context |
| Project diff review | 5 | One saved diff/revision, bounded input tokens |
| Local rubric / deterministic plan / browser examples | 0 AI units | Separate rate/storage limits still apply |

Pro allowance: **100 units per monthly allowance window**, no rollover and no
automatic paid overages. Free does not include external AI at launch. Annual
subscribers receive monthly windows anchored to their original subscription
start. Calculate each boundary from the original calendar anchor, clamping to
month-end where needed; do not repeatedly add 30 days or let February permanently
shift a January-31 anchor. Use half-open UTC windows `[start, end)`.

Publish operation cost, remaining units and reset date in UI. A policy version
is attached to grants/windows/jobs so changing costs cannot retroactively
change completed usage or ambiguously charge a running request.

Reservations settle against the window in which they were admitted, even if
the result finishes after a reset; they must not consume or refund the new
window. Check that paid access remains valid before publishing the result.
Keep usage history when access ends. Re-enabling the same paid interval or
replacing a refunded/duplicate subscription within an overlapping allowance
window reuses that window's consumed/reserved balance rather than minting a
second allowance. A genuinely new nonoverlapping paid interval starts its
own anchored window.

### Reservation and settlement

1. Authorize account/feature/revision and calculate bounded operation cost.
2. Lock/update the user's current usage bucket atomically. Reject if
   `consumed + reserved + requested > limit`.
3. Insert a unique reservation and job under the request's idempotency key.
4. Before provider dispatch, recheck eligibility and enforce global and
   per-user concurrency limits.
5. A valid, usable result consumes the reservation once. Explicit provider
   failure, malformed output, cancellation before dispatch, stale input or
   access loss before publication releases user allowance under this policy.
   Record any actual provider cost separately even when user units are released.
6. A crash/timeout with unknown provider outcome remains a tracked ambiguous
   job until reconciliation resolves it. Never release an active reservation
   solely because a generic TTL elapsed while its worker still owns execution.

Enforce database constraints and job-state transitions, not process-local
counters. Two tabs racing for the last units must not both succeed.

User-level exactly-once charging does not guarantee one provider invoice: some
AI providers lack request idempotency or result retrieval. Avoid blind retries
after an ambiguous dispatch; explicitly report unknown/failed status, bound
operator retry, and account for possible duplicate provider cost. Rate-limit
repeated cancellation/stale-input patterns that otherwise create free costs.

### Provider and quality controls

Set input/output token ceilings per operation, bounded history, maximum queued
age, execution deadline and at most the approved retry count. Limit initial
global provider dispatch concurrency to a measured budget; the architecture's
20 in-flight operations is a planning ceiling, not permission to exceed
provider rate limits.

Separate customer allowance from internal cost ceilings:

- Per-user short-window request/concurrency limits.
- Daily/monthly application spend limits and warning thresholds.
- Circuit breaker for latency, error rate, malformed responses or unusual cost.
- Model/prompt version and actual token usage attached to each job.
- Provider-cost reconciliation when usage is delayed/missing.

Set the actual monetary stop thresholds before enabling AI. A kill switch
stops new dispatch, preserves saved work and clearly reports unavailability.
It must not silently switch models/providers with different privacy terms.

Unit economics model:

```text
net recurring revenue
  - payment fees / taxes borne / expected refunds
  - identity + hosting + email + support allocation
  - (paid users x included units x observed cost per unit x utilization)
  = contribution margin before fixed development/content costs
```

Evaluate a full-allowance heavy-user scenario as well as average utilization.
Do not justify "unlimited AI" using an assumed low average. No live provider
pricing or real-user utilization was measured during this review.

Before sending private answers/code, disclose provider, content categories,
purpose and retention terms; record the applicable user choice/policy version.
Use least-context prompts, redact where feasible, and do not log raw prompts in
general telemetry. Treat submitted content and retrieved text as untrusted
data, not instructions to access tools or reveal system secrets.

AI is advisory. Validate response shape, prohibit invented execution/hiring
claims, and maintain an evaluation set with expert-rated usefulness,
groundedness, bias, privacy and failure cases. Test live behavior in approved
staging with synthetic/nonconfidential data before advertising the feature.
Keep local rubric results distinctly labeled.

## Browser code runner boundary

Retain network-disabled opaque-origin execution and the two-second execution
deadline. Validate message source/token, bound input/output serialization and
terminate on errors/timeouts. Evaluate memory-pressure behavior and cleanup in
supported browsers; a CPU timeout alone is not a reliable memory sandbox.

Keep runner-specific CSP allowances isolated from the application origin's
policy. Do not loosen app-wide CSP to `unsafe-eval` just because the isolated
runner needs dynamic evaluation. Consider a separate cookieless runner origin
only if independent review shows it improves the browser boundary.

Examples remain client-visible and client-executed, so their results can be
tampered with and are not authoritative assessment evidence. If a paid promise
requires hidden tests or multiple languages, defer it until a separate remote
execution design covers containers/microVMs, network denial, resource quotas,
image supply chain, tenant isolation and independent assessment.

## UX and accessibility requirements

Make upgrade prompts contextual: explain the unavailable action, included
benefit, price link and what happens to existing work. Do not block free exports
with a paywall or repeatedly interrupt a user who declined an upgrade.

Every premium screen needs explicit states for signed out, unverified, Free,
active Pro, payment processing, payment recovery, quota exhausted, expired,
suspended, offline, conflicting edit, queued job, failed job and completed work.
Never display a success toast before durable save/payment completion.

Meet WCAG 2.2 AA for critical flows: keyboard navigation, focus visibility/order,
form labels/errors, contrast, reduced motion, zoom, responsive layouts, captions
and screen-reader announcements. Payment/auth redirects should return focus
and context. Source editors, diagrams and drag actions need keyboard alternatives.

Maintain mobile usability for reading, planning, account and checkout flows.
Do not promise full desktop code-editing ergonomics on a narrow phone viewport.
Public SEO can use approved metadata, canonical URLs, sitemap and prerendered
marketing/library pages; private routes are noindex and not analytics payloads.

## Acceptance scenarios

| ID | Observable outcome |
| --- | --- |
| FEAT-01 | Public bundles, source maps, previews/search and unauthorized API responses contain no protected-content sentinel or unrevealed answer bank |
| FEAT-02 | Free/Pro/grace/expired matrices hold for direct API calls, nested course resources, tutor retrieval, media and archives |
| FEAT-03 | Editing curriculum leaves historical quiz reports, option order and course completion stable; corrections are explicit |
| FEAT-04 | Save failure, offline reload, conflicting tab and stale AI completion preserve the newest user draft and expose actionable state |
| FEAT-05 | Mocks/custom quizzes/plans/projects retain current resume, canonical scoring, baseline/patch and progress behavior after normalized storage migration |
| FEAT-06 | Concurrent last-unit requests, repeated keys, worker crashes and delayed responses never double-consume allowance or exceed reservation limits |
| FEAT-07 | Monthly/annual window boundaries, leap years, renewal, cancel/resume and resubscription do not invent extra allowance |
| FEAT-08 | Provider failure/invalid output/access loss produces no fake success or undisclosed fallback; actual provider cost is still tracked |
| FEAT-09 | All paid-advertised content has review/source/version metadata and no misleading company, accreditation, video or AI claims |
| FEAT-10 | Code timeout/output/memory-pressure/message-boundary cases and critical keyboard/screen-reader/mobile flows meet the approved release policy |
