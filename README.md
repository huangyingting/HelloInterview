# Interview Studio

An original, locally runnable interview-preparation application inspired by the
observable workflows of Hello Interview. Built with React, TypeScript, Vite,
Express, and persistent SQLite or PostgreSQL.

**This is not Hello Interview, is not affiliated with it, and does not reproduce
its proprietary lessons, videos, branding, interview reports, or production
services. Full feature and content parity has not been achieved.**

See [the reference analysis and feature comparison](docs/REFERENCE-ANALYSIS.md)
for inspected workflows, technical evidence, implementation coverage, and gaps.
The [premium workflow design](docs/PREMIUM-WORKFLOWS.md) explains the original
adaptive interviews, custom quizzes, study plans, and project workbench.
The [researched curricula](docs/CONTENT-CURRICULUM.md) record the System Design,
Coding, and Low-Level Design expansions, sources, depth, and editorial limitations.

The [production application blueprint](docs/production/README.md) reviews the
current gaps and specifies the proposed architecture, social identity and account
lifecycle, billing and entitlements, premium features, operations, and phased
delivery plan. The [implementation progress](docs/production/07-delivery-roadmap.md#implementation-progress)
records shipped foundations; identity, commerce, and the remaining service
capabilities are still future work.

![Original Interview Studio landing page](docs/screenshots/01-landing.png)

## Run locally

Requirements:

- Node.js 24 and npm.
- Google Chrome for browser tests and media/screenshot generation. The default
  executable is `/usr/bin/google-chrome`; set `CHROME_PATH` for another location.
  CI uses Playwright-managed Chromium, installed with `npx playwright install chromium`.
- No reference-site credentials, external service keys, or payment account are
  needed for local use.

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Choose **Your Studio**, then **Try the local demo**,
or create a separate local account. Each demo entry creates a fresh account;
its session and progress persist until you sign out or its cookie expires.
Create an account if you want to sign back in after signing out.

For the new premium tools, open **Plans**, activate a clearly labeled local demo
plan, then choose **Open Premium Studio**. No payment or reference account is
used. Saved completed reports and project snapshots remain accessible when
the demo entitlement ends.

For the compiled frontend and server build:

```bash
npm run build
npm start
```

`npm run build` creates the browser assets in `dist/` and a standalone server
bundle in `dist-server/`. `npm start` runs that bundle with Node.js and serves
the frontend and API from the same process. Vite is loaded only by the development
server; the compiled runtime does not require `tsx`, TypeScript, esbuild, or Vite.

For a runtime-only installation, first build with all dependencies installed.
Deploy `dist/`, `dist-server/`, `package.json`, and `package-lock.json` together,
then run `npm ci --omit=dev` and `npm start` from the release directory. Keep
`.env` and the data directory private and outside the frontend assets. Do not
omit build dependencies before building.

**This is a production-format runtime, not a production-ready paid service.**
Local accounts, demo plans, and the existing service limitations remain.
PostgreSQL is available for persistence preparation; selecting it does not enable
managed identity, live billing, production entitlements, or operational launch.

## PostgreSQL persistence

SQLite remains the zero-configuration local default. To use PostgreSQL 16 or
newer, build the release, configure `DATABASE_URL` in the private environment,
and run the controlled migration command once before starting any replicas:

```bash
npm run build
npm run db:migrate
npm start
```

The runtime checks migration versions/checksums; it never applies PostgreSQL
migrations or seeds sample accounts/content during startup. Owned learning
collections are persisted as individual rows with transactional updates,
foreign keys, and owner indexes. Draft/story/reflection edits carry revisions
and return explicit conflicts instead of replacing newer work.

No local data is copied automatically. A legacy importer defaults to a
read-only dry run, requires an explicit approved account allowlist and matching
snapshot fingerprint to write, preserves original state bytes for reconciliation,
and excludes passwords, sessions, demo accounts, gifts, and paid-access authority.
Imported accounts require later verified identity recovery before signing in.
See [the persistence implementation and migration runbook](docs/production/08-persistence-implementation.md)
for schema details, API revisions, rehearsal, and cutover safeguards.

## What works

| Area | Local functionality |
| --- | --- |
| Learning | Seven tracks, 74 original lessons; 24 substantial sourced lessons each for System Design and Coding, plus 12 for Low-Level Design, objectives, exercises, outlines, progress, bookmarks, comments, and five algorithm labs |
| Courses | Seven structured paths, including 52-step System Design, 60-step Coding, and 28-step Low-Level Design text/quiz/practice paths |
| Practice | 59 original exercises; 16 worked System Design references, 24 executable Coding exercises, eight worked object models including four new runnable stateful exercises |
| Workspaces | Movable architecture nodes and directed connections, diagram export, saved drafts, history, explanation editor, timer, feedback |
| Coding | Dedicated algorithm practice, original reference implementations, complexity analysis, isolated JavaScript `solve(input)` example execution and deadline; code-review line references |
| Behavioral | Micro/mini/full sessions, company and level context, browser speech synthesis, private STAR story CRUD and export |
| Quizzes | 33 topics and 443 questions; System Design and Coding each have 180 sourced questions, plus 80 Low-Level Design questions, canonical scoring, explanations, history, and review |
| Premium mocks | Original topic-adaptive three/five-turn conversations, saved drafts/transcripts, optional AI grading, reports and export |
| Custom quizzes | Mixed-topic or missed-only sessions, preserved question order, resume, canonical scores and review-deck updates |
| Study plans | Company/level-focused two/four-week schedules, real progress integration, reflections and export |
| Project workbench | Imported source snapshots, immutable baselines, multi-file editing, isolated JS examples, reviews, exact patch and JSON export |
| Community | Local publishing, search, filters, sorting, pagination, reversible votes, follows, anonymous question display, comments, and replies |
| Discovery | Cross-library search, company/level planning guides, three original journal articles, retrieval-based study helper |
| Accounts | Local signup/login/logout, profile/password changes, interview targets, progress, streaks, recognition, account export |
| Access and support | Explicit local-only plan activation/expiry, one-use gift codes, plan reset, locally saved support tickets |
| Interface | Responsive desktop/mobile navigation, persisted light/dark theme, keyboard shortcuts, focus styles, visible errors |

## Content delivery and saved quiz versions

The browser imports a generated discovery catalog, not lesson bodies, worked
solutions, rubric keywords, or quiz keys. `npm run content:metadata` regenerates
the allowlisted titles/summaries/navigation metadata; development and builds run
it automatically. A Vite import boundary rejects private content dependencies.
Readers and runnable example briefs use authorized, private/no-store APIs.
The premium concurrency clip/captions live in the server release, not `dist/`,
and their endpoint authorizes every request, including byte ranges.

Topic quizzes now issue server-owned, resumable sessions. **Checking or skipping
commits an answer** before its explanation is returned; reload resumes at the
next unanswered question. Topic and custom sessions pin an immutable question
snapshot and use it for grading, report order, citations, and JSON exports even
after a curriculum update. Completed owned reports remain available after demo
premium expiry. Legacy reports without recorded versions are explicitly labeled;
their original answers/scores remain exportable rather than being rewritten.

See [the protected-content implementation runbook](docs/production/10-content-implementation.md)
for the public/private contract, endpoints, migration 2, version/legacy behavior,
and validation. This boundary still uses local demo authorization: W04/W06 must
replace that authority before service mode or payments can be enabled.

A course completion record requires every course step to be complete. It is a
local practice-completion record, not accreditation, hiring evidence, or proof
of mastery. Videos are short original animated walkthroughs, not a substitute
for the reference's video library.

## Researched System Design flagship

Open **Learn -> System Design -> Explore the course**, or browse
**[the worked designs](http://127.0.0.1:3000/learn/system-design/cases)**.
The flagship contains 24 lessons, 16 worked designs, and 180 questions informed
by 19 public primary references, including IETF, PostgreSQL, Google SRE, AWS,
Stripe, OWASP, Redis, RabbitMQ, Kafka, Flink, and Jepsen.

The corpus has **43,773 counted instructional words**: 13,945 in lessons,
17,408 in worked reasoning/follow-ups, and 12,420 in answer explanations.
These counts exclude headings, objectives, exercises, assumptions, diagrams,
question prompts, and answer choices. Workloads are hypothetical, not company
benchmarks. Sources are linked in the readers and quiz explanations.

This is an original, source-informed draft curriculum, **not expert-reviewed
material or a verified set of current company interview questions**.

## Researched Coding & Algorithms flagship

Open **Learn -> Coding & Algorithms -> Explore the course**, or browse
**[the worked solutions](http://127.0.0.1:3000/learn/code/solutions)** and
**[dedicated algorithm practice](http://127.0.0.1:3000/practice/code)**.
The 60-step path connects 24 substantial lessons, 12 quizzes containing 180
questions, and 24 original runnable exercises. It covers array patterns,
intervals, stacks, linked lists, binary search, heaps, trees, graph algorithms,
backtracking, dynamic programming, greedy reasoning, tries, matrices, and bits.

Each exercise includes an explicit bounded JSON contract, at least six example
cases, substantial solution reasoning, public sources, and a revealable original
JavaScript implementation. MIT OpenCourseWare, NIST, MDN, and V8 documentation
informed the original material; authenticated reference inspection informed
topic coverage, not copied lesson text. Example tests are **not an exhaustive
online judge**. Reading a reference does not complete an attempt, and local
rubric feedback does not establish algorithm correctness.

The Coding corpus contains **33,748 counted instructional words**: 14,267 in
lessons, 8,710 in solution reasoning, and 10,771 in question explanations, plus
146 executable example fixtures. Code and metadata are excluded. Together with
System Design, the two flagships contain **77,521 instructional words**.

## Researched Low-Level Design expansion

Open **Learn -> Low-Level Design -> Explore the course**, or browse
**[the worked object models](http://127.0.0.1:3000/learn/low-level-design/solutions)**.
The 28-step path connects 12 substantial lessons, eight quizzes with 80
questions, and eight original worked models: parcel lockers, parking, a grid
game, a limiter, an inventory ledger, an LRU cache, an approval workflow, and
an in-memory file catalog.

The last four are **new runnable JavaScript exercises**. The original four
open-ended briefs and starters are preserved; their reference-protocol examples
are not an acceptance harness for those starters. Each model has six specified
traces, an object sketch, substantial reasoning, and explicit complexity and
infrastructure limits. The inventory, cache, workflow, and catalog references
also have independent stateful test oracles.

This expansion contributes **13,824 counted instructional words**: 6,323 in
lessons, 3,118 in worked reasoning, and 4,383 in explanations. The three expanded
disciplines total **91,345 words**, excluding code and metadata. Seven new
primary references from MDN, Martin Fowler, PostgreSQL, and W3C bring the
shared registry to 32.

These are bounded sequential teaching models, **not verified production
transactions, payment providers, distributed caches, or filesystem services**.
The remaining four tracks are still starter-depth. The four short video clips,
generic company guides, and illustrative community entries are unchanged.
None of the expanded curricula has independent human expert review.

## Configuration and optional AI

```bash
cp .env.example .env
```

The defaults bind to loopback, use port 3000, and store data in `data/`.
`APP_MODE=local` preserves local workflows. `APP_MODE=service` deliberately
fails startup until managed identity and production authorization are implemented;
compiled serving does not grant permission to launch a public paid service.
`HOST`, `PORT`, `DATA_DIR`, and `COOKIE_SECURE` can be changed in `.env`.
Use `COOKIE_SECURE=true` only when serving over HTTPS.
Configuration is validated before opening the database or listening. `PORT`
must be an integer from 0 to 65535 (0 selects an ephemeral port); `HOST` must
be an IP address or hostname; `COOKIE_SECURE` must be exactly `true` or `false`.
`NODE_ENV` accepts `development`, `test`, or `production`; `npm start` selects
production static serving and fails clearly if the frontend build is missing.
It does not enable live payments or managed identity.

For private HTTPS staging, `PUBLIC_ORIGIN` fixes the expected canonical origin
and requires `COOKIE_SECURE=true`. `TRUST_PROXY` accepts only explicit proxy
IP/CIDR allowlists; forwarded protocol from untrusted peers is ignored.
`LOG_REQUESTS` controls JSON request completion records (on by default for
production-format serving). Records contain server-generated request IDs,
route templates, status and duration, not bodies, cookies, emails or query strings.
`GET /api/health` checks process liveness; `GET /api/ready` also checks database
connectivity and fails during draining.

## CI and private container staging

Application CI builds the release, runs unit/database/runtime/provider/browser
coverage against synthetic fixtures, verifies the non-root container, rehearses
an encrypted PostgreSQL dump/restore, and uploads compiled release artifacts.
Actions and container base images are pinned; no live provider keys are required.

```bash
docker build -t interview-studio:staging .
# Inject private POSTGRES_PASSWORD and DATABASE_URL through the environment.
# The URL must address database:5432/studio; encode special password characters.
docker compose -f compose.staging.yml up -d --wait
```

The staging compose file exposes the API only on loopback, persists PostgreSQL,
and requires successful controlled migrations before starting the API. It is
**private staging, not managed production infrastructure**. Do not expose local
demo authority to customers. The runtime image uses Node's non-root user and
can run with a read-only root filesystem when its local data directory is mounted.
See [the deployment and recovery runbook](docs/production/09-platform-implementation.md)
for release promotion, proxy boundaries, secrets, recovery and remaining gates.

AI base URLs must be absolute HTTP/HTTPS URLs without embedded credentials,
queries, or fragments. A trailing slash is normalized. Configuration is a
startup snapshot; changing `.env` requires a restart.

By default, practice feedback uses a labeled **local topic rubric**, and the
study helper retrieves passages from original lessons. They are not AI and are
not represented as AI.

To connect an OpenAI-compatible Chat Completions provider, configure:

```dotenv
OPENAI_API_KEY=your-provider-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
```

Restart the server after changing configuration. The API key stays server-side.
Configured tutoring sends your questions and selected lesson context to the
provider. Configured grading sends the practice prompt, requirements, level,
submitted explanation, and code. **Do not submit confidential information.**
Provider charges and data-retention policies are your responsibility.
Mock grading also sends prior answers and company/level context. Project review
sends your explanation, user-reported verification notes, and file diff.

Responses are validated, with explicit errors for provider failures rather
than a silent switch to local grading. The integration is verified against an
isolated local provider fixture; live provider behavior has not been verified
with a real key. Reference-site cookies are never used as provider credentials.

## Data and credential boundaries

- SQLite lives at `data/studio.sqlite`, using WAL mode. Accounts, hashed sessions,
  progress, drafts, stories, posts, comments, gifts, and support tickets persist
  across application restarts.
- Passwords use salted scrypt hashes. Session cookies are HttpOnly and SameSite
  Strict; the database stores their SHA-256 hashes.
- `.cred` was used only for the separate reference-browser inspection. The
  application does not load it. It is ignored by Git and blocked from HTTP
  serving, along with `.env`, Git metadata, and data paths.
- Private authenticated reference screenshots and observations remain outside
  the application. Only original-application screenshots are included here.
- `.env`, runtime databases, dependencies, build outputs, and test artifacts
  are excluded from version control.
- Back up the database before making changes or moving machines. Stop the
  application before taking a simple file-copy backup so the WAL is checkpointed.
  Do not publish the data directory.

The JavaScript runner uses a network-disabled worker in an opaque-origin
sandboxed iframe, with a two-second execution deadline. Submitted code is never
executed on the backend. Only synchronous JavaScript is supported; this is not
a production sandbox security audit.

## Validation and screenshots

```bash
npm run build
npm run test:unit
npm run test:server
npm run test:runtime
npm run test:ai
npm test
```

- Domain tests check catalogs, canonical scoring, review behavior, streaks,
  entitlements, rubric labels, and course-completion invariants.
- Configuration tests reject invalid settings and verify immutable startup
  snapshots. Server tests cover static serving, account isolation, restart
  persistence, startup errors, and graceful/bounded shutdown.
- `test:runtime` creates a disposable release with `npm ci --omit=dev`, verifies
  that development tooling is absent, and exercises the compiled server, `.env`
  loading, session persistence, and SIGTERM shutdown. It may require access to
  the npm registry/cache. It never copies your `.env` or runtime database.
- Server/runtime/provider test commands build their required artifacts first.
- Content tests enforce exact inventory, instructional-depth floors, valid
  source/resource links, difficulty/answer-position coverage, and the arithmetic
  of every worked-design capacity calculation.
- Provider-contract tests use a loopback fixture, check valid/malformed/outage
  responses and persisted sessions/state after an application restart. They
  require no real provider key and do not contact an external AI service.
- Playwright checks 30 end-user workflows, including actual video playback,
  completion-record download, isolated-code execution/timeout, persistence,
  community actions, premium conversations/quizzes/plans/imported projects,
  mobile layout, credential denial, and user isolation.
- Browser tests use port 3100 and a fresh UUID-named database under `data/tests/`
  for each run. Reports/traces are local ignored artifacts.

With the app running:

```bash
npm run screenshots
```

This captures 44 original-application desktop/mobile screenshots under
`docs/screenshots/`. The [manifest](docs/screenshots/manifest.json) records routes
and descriptions. Set `STUDIO_URL` to capture a different local instance.
The script creates a local demo account, demo entitlement, and original sample
practice/mock/quiz/plan/project records. It requires local feedback mode and
refuses configured AI to avoid external provider submissions or charges.

Regenerate the four original canvas-animated WebM clips and English VTT captions:

```bash
npm run media
```

## Architecture and limits

`src/` contains the React client; `shared/` holds original catalogs, types,
course definitions, and domain rules; `server/index.ts` implements the API and
SQLite persistence. Development embeds Vite middleware. Production serves
`dist/` with an SPA fallback.

**Not connected or equivalent to the reference:** real payments/subscriptions,
email delivery or password recovery, social OAuth, a production support team,
the reference community or proprietary datasets, live BYOE repository/IDE
connectivity, and the reference's adaptive AI pipeline. Original local adaptive
interviews and a snapshot workbench exist, but are not those private services.
Demo billing plans, gifts, support, and community
are explicitly local-only. The four generated videos and original catalogs are
much smaller than the reference's content library.

Do not expose this local prototype publicly without additional deployment
hardening, verified identity/email/payment integrations, moderation and abuse
controls, backups, observability, and appropriate content/data rights.
