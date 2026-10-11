# 10 - Protected content and versioned assessments

**Status: W05 engineering checkpoint, not paid-service authorization.** This
release preserves the existing free/premium flags, original resource IDs,
curriculum, sources, runnable examples, and local demo workflows. Service mode
remains fail-closed; managed identity, billing-backed entitlements, editorial
approval, and operational launch gates remain separate work.

## Public/private contract

`shared/catalog.ts`, `shared/courses.ts`, and the instructional modules under
`shared/content/` are authoring/server/test authority. Their location does not
make them browser-safe. The browser uses `shared/public-catalog.ts`, generated
by `scripts/generate-public-content.ts` from an explicit field allowlist:

| Surface | Published discovery fields | Delivered only through the server |
| --- | --- | --- |
| Lessons | ID, title, group, duration, summary, premium flag, objectives, source IDs and next-step IDs | Sections, prose, instructional code/diagrams, exercise |
| Exercises | ID/title/track/difficulty, free description or explicit premium preview, reference flags/counts, case summary | Requirements, starter source, runnable examples, worked sections/implementations, rubric keyword groups |
| Quizzes | Topic titles/counts and question IDs/topic membership | Prompts/options in owned sessions, keys/explanations after saved answers or completed owned reports |
| Courses | Course/unit/step titles, descriptions, resource IDs and navigation | Premium clip bytes and captions |

Public objectives and case summaries are intentional previews, not complete
lessons or worked answers. Search, course navigation, company planning, progress
helpers, and premium pool counts use only these fields. Domain grading moved to
`server/content/grading.ts`; client progress helpers no longer import the bank.
The public source-reference registry remains browser-safe.

Run `npm run content:metadata` after authoring changes and commit its generated
output. `npx tsx scripts/generate-public-content.ts --check` rejects stale output.
The normal development/build commands regenerate it. Do not hand-edit metadata
or add full bodies through a new client helper. The Vite build rejects any
private catalog/course/content/server module in the browser graph, including
transitive imports. Development file serving also denies those private modules.
Production never serves `dist-server/` as a static directory.

## Reader and media APIs

| Endpoint | Authorization and shape |
| --- | --- |
| `GET /api/content/lessons/:track/:id` | Free lesson public; premium lesson requires an authenticated, currently premium actor; returns that lesson |
| `GET /api/content/problems/:id` | Same resource policy; practice brief excludes all rubric keywords, worked cases, and solution implementations |
| `GET /api/content/problems/:id?project=:ownedId` | Validates both current owner and matching project/problem; permits existing project acceptance briefs for the read-only snapshot workflow after expiry; never unlocks worked solutions |
| `GET /api/content/references/:id` | Same resource policy; authorized worked reference without rubric keywords |
| `GET /api/content/media/:course/:file` | Validates the exact course/video/file mapping and course access on each request; WebM ranges and VTT captions use the same boundary |

All API responses are `private, no-store`. Body DTOs carry a SHA-256
`X-Content-Version` header for the delivered current representation. This
fingerprint is not a cache permission or an entitlement proof.

The premium concurrency clip/captions moved from `public/media/` to
`server/media/`. The build copies them to `dist-server/media/`; runtime-only
releases and containers deploy them with the server. The media generator keeps
the private placement. Existing free clips remain public. The course player,
captions, and download link use the authorized premium endpoint; hiding the
course screen is not the protection.

Reader fetches are aborted when their identity/access key changes. Old
representations are not rendered under a new account or expired entitlement.
Failures display explicit errors and a retry action rather than an empty lesson
or invented content. Practice still preserves unsaved drafts; authoring briefs
provide the same starters and browser-runner cases as before.

The local retrieval tutor now searches only accessible lessons and rechecks
premium access before saving a paid excerpt. Configured AI is not a new
privileged content-retrieval path; its input remains the user's supplied context.

## Server-owned topic quiz lifecycle

1. `POST /api/quiz-sessions { topic }` authenticates the owner, validates a known
   topic or their actual review membership, checks the 50-unfinished-session
   cap, and pins the server-selected ordered question set.
2. `GET /api/quiz-sessions/:id` returns only the next unanswered prompt/options,
   revision, counts, and version. It never returns future keys/explanations.
   `GET /api/quiz-sessions` lists only this owner's unfinished sessions.
3. `POST /api/quiz-sessions/:id/answer` requires the exact next question, an
   integer choice or explicit skip `-1`, and the current revision. The answer
   is immutable once committed. The response includes feedback for that
   committed question only and a safe view of the next question.
4. `POST /api/quiz-sessions/:id/finish` requires every issued question to be
   answered/skipped. It grades the pinned snapshot, writes the owned report,
   updates review/recognition, and completes the session in one transaction.
   Replay does not award recognition again, including after archive trimming.

Checking or skipping now saves before revealing the explanation. This is an
intentional UX change: reload resumes the next unanswered question even if the
user had not pressed Next. The active session ID is in the URL, and the quiz
library exposes resumable sessions. A stale tab receives 409; its selection is
not silently written over a newer answer. Foreign-owned IDs return 404.

The legacy `/api/quiz` final-submission contract remains compatible for existing
callers. It validates canonical current questions and review ownership, stores
explicit skips, pins that submission's ordered snapshot, and exposes no answer
keys in its state response. The new browser no longer uses it as its session
protocol. This compatibility path is not a certification or anti-cheating exam.

## Custom quizzes and reports

New custom sessions pin the server-selected order at creation. The existing
revision/answer/finish routes now read that snapshot instead of re-resolving
the current catalog. `GET /api/custom-quizzes/:id/question` returns the next
safe prompt. `POST .../answer?feedback=true` saves and returns that question's
feedback; the existing state-only response remains available for old callers.
New custom answers/finishes still require active premium access.

`GET /api/quiz-reports/:id` accepts only this owner's completed topic/custom
reports. Completed owned reports and their versioned explanations/citations
remain available after expiry. UI JSON exports include those snapshots.
`GET /api/export` includes all retained versioned completed reports alongside
the existing owned state; incomplete custom sessions do not disclose future
keys. Report IDs alone are not an authorization capability.
Account export also includes the owner's resumable topic-session progress and
feedback for already committed questions, never future answer keys.

Reports pin the full authored question representation: prompt, option order,
key, explanation, difficulty, source IDs, and resolved citation
titles/publishers/URLs/research dates. Changes to any of these
produce a different SHA-256 version. The report's score and selected question
order remain the ones actually answered. Regular report records explicitly
retain question IDs because PostgreSQL JSONB object-key order is not a sequence.
The immutable snapshot itself is authoritative for the rendered order.
Snapshot citations render without re-resolving today's source registry.

## Storage and migrations

PostgreSQL migration **2, `versioned-assessments`**, adds:

- `content_versions(id,value)`: bounded authored question-array snapshots keyed
  by SHA-256; insert-once publication, never an update/upsert of snapshot bytes.
- `assessment_sessions`: owned session ID, topic, snapshot FK, answers, revision,
  completion time; owner/completion index and user-deletion cascade.

SQLite creates the equivalent local tables while retaining its existing state
format. Both dialects use the same repository and transactional API.
PostgreSQL updates acquire the account lock before session/state changes, so
different pools/replicas reject competing stale answers. Session completion,
owned report persistence, review changes, and recognition all commit or roll
back together. Content snapshots contain authored content, not personal answers.

The dry-run-first SQLite importer includes selected-owner assessment progress
and exactly its referenced content versions. It validates hashes, question
schemas, saved scores/order, and sequential progress; accounts still enter as
Free without passwords/auth sessions. Identical already-published content is
shared only after byte equality; account/session ID collisions still roll back
the entire import. Backups predating these optional tables remain supported.

The runtime reads saved snapshot bytes rather than trusting a browser version
or looking up current keys. It verifies the content hash and selected ID set;
missing/inconsistent versioned content is an explicit error, not a current-bank
fallback. Migration 1 is unchanged. Existing PostgreSQL deployments must run
the controlled migration command before starting this release; startup only
validates migration history.

## Legacy data and rollout

Historical topic/custom records without a version remain readable using their
saved selected IDs when those current questions still exist. Their response
and UI explicitly say `legacy-unversioned`; this is not proof of historical
keys/explanations. Saved answers and scores are not recomputed. Missing legacy
questions cause a diagnostic 409 for the explanation endpoint, but do not
prevent export of the account's original answers/scores.

An unversioned unfinished custom quiz pins matching current questions on its
first new answer. This cannot reconstruct what the old browser originally
displayed; retain that limitation during any approved legacy migration.
New issued sessions/reports are versioned from their inception.

Deploy browser and server artifacts together. Migrate PostgreSQL before
restarting replicas. Do not drop snapshot/session tables or downgrade the
schema while new quiz versions are authoritative. No existing customer data
was imported and no old historical versions were invented.

## Evidence and remaining work

`npm run test:content` checks actual browser artifacts, a deliberately forbidden
Vite entry, direct reader/media authorization, no-store/byte ranges, session
ordering, concurrent revision rejection, content changes after issuance,
restart, archive ownership/expiry, exports, and unavailable legacy questions.
Database tests additionally use separate PostgreSQL pools and verify JSONB
ordering. Browser coverage checks saved-answer reload, private development
module denial, reader outage/retry/expiry, real premium video decoding, and all
existing learning/practice/course/premium workflows.
Browser contexts have distinct synthetic client addresses through an explicitly
trusted loopback-only test proxy, so suite growth does not exhaust a shared
authentication bucket. Production rate limits remain enabled and unchanged.
The container restore rehearsal verifies both versioned report bytes and an
unfinished session's committed progress in a fresh restored runtime.

This is release-authored content with lazily persisted assessment snapshots,
not an editorial CMS, independently reviewed curriculum, signed media CDN, or
content-licensing approval. Practice/mock/project brief history still uses the
current corresponding authored brief; their saved user files/transcripts and
feedback remain owned records. Editorial correction policy, a production access
manifest, archive retention/storage budgets, staff publication permissions, and
real subscription authority remain W06/W10/W12 work. The remaining large browser
chunk is not hidden by suppressing Vite's warning.
