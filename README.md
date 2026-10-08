# Interview Studio

An original, locally runnable interview-preparation application inspired by the
observable workflows of Hello Interview. Built with React, TypeScript, Vite,
Express, and persistent SQLite.

**This is not Hello Interview, is not affiliated with it, and does not reproduce
its proprietary lessons, videos, branding, interview reports, or production
services. Full feature and content parity has not been achieved.**

See [the reference analysis and feature comparison](docs/REFERENCE-ANALYSIS.md)
for inspected workflows, technical evidence, implementation coverage, and gaps.

![Original Interview Studio landing page](docs/screenshots/01-landing.png)

## Run locally

Requirements:

- Node.js 24 and npm.
- Google Chrome for browser tests and media/screenshot generation. The default
  executable is `/usr/bin/google-chrome`; set `CHROME_PATH` for another location.
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

For the production frontend build:

```bash
npm run build
npm start
```

`npm start` serves the built frontend and API from the same process. It needs the
installed tooling dependencies, including `tsx`; do not omit dev dependencies
with the current startup command.

## What works

| Area | Local functionality |
| --- | --- |
| Learning | Seven tracks, 30 original lessons, outlines, read progress, bookmarks, premium gates, comments, five interactive algorithm visualizations |
| Courses | Four structured paths combining lessons, original captioned videos, quizzes, and practice; enrollment and dashboard continuation |
| Practice | 21 original exercises across design, object design, AI-assisted coding, behavioral preparation, and code review |
| Workspaces | Movable architecture nodes and directed connections, diagram export, saved drafts, history, explanation editor, timer, feedback |
| Coding | Isolated JavaScript `solve(input)` execution with example cases and an execution deadline; code-review line references |
| Behavioral | Micro/mini/full sessions, company and level context, browser speech synthesis, private STAR story CRUD and export |
| Quizzes | Seven topics and 21 questions, server-side scoring, explanations, history, and a personalized missed-question review deck |
| Community | Local publishing, search, filters, sorting, pagination, reversible votes, follows, anonymous question display, comments, and replies |
| Discovery | Cross-library search, company/level planning guides, three original journal articles, retrieval-based study helper |
| Accounts | Local signup/login/logout, profile/password changes, interview targets, progress, streaks, recognition, account export |
| Access and support | Explicit local-only plan activation/expiry, one-use gift codes, plan reset, locally saved support tickets |
| Interface | Responsive desktop/mobile navigation, persisted light/dark theme, keyboard shortcuts, focus styles, visible errors |

A course completion record requires every course step to be complete. It is a
local practice-completion record, not accreditation, hiring evidence, or proof
of mastery. Videos are short original animated walkthroughs, not a substitute
for the reference's video library.

## Configuration and optional AI

```bash
cp .env.example .env
```

The defaults bind to loopback, use port 3000, and store data in `data/`.
`HOST`, `PORT`, `DATA_DIR`, and `COOKIE_SECURE` can be changed in `.env`.
Use `COOKIE_SECURE=true` only when serving over HTTPS.

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
npm run test:ai
npm test
```

- Domain tests check catalogs, canonical scoring, review behavior, streaks,
  entitlements, rubric labels, and course-completion invariants.
- Provider-contract tests use a loopback fixture, check valid/malformed/outage
  responses and persisted sessions/state after an application restart. They
  require no real provider key and do not contact an external AI service.
- Playwright checks 19 end-user workflows, including actual video playback,
  completion-record download, isolated-code execution/timeout, persistence,
  community actions, mobile layout, credential denial, and user isolation.
- Browser tests use port 3100 and a fresh UUID-named database under `data/tests/`
  for each run. Reports/traces are local ignored artifacts.

With the app running:

```bash
npm run screenshots
```

This captures 30 original-application desktop/mobile screenshots under
`docs/screenshots/`. The [manifest](docs/screenshots/manifest.json) records routes
and descriptions. Set `STUDIO_URL` to capture a different local instance.
The script creates a local demo account and a saved practice draft.

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
the reference community or proprietary datasets, BYOE repository/IDE workflows,
and the reference's adaptive AI pipeline. Plans, gifts, support, and community
are explicitly local-only. The four generated videos and original catalogs are
much smaller than the reference's content library.

Do not expose this local prototype publicly without additional deployment
hardening, verified identity/email/payment integrations, moderation and abuse
controls, backups, observability, and appropriate content/data rights.
