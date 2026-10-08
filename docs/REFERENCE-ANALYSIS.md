# Reference analysis and implementation comparison

## Scope and result

Playwright inspected public and authenticated Hello Interview workflows using
the supplied cached cookie export. The result is **Interview Studio**, an
independent, original application implementing comparable core user journeys.

**Full parity is not established.** Some reference functionality was locked by
premium access; provider-backed workflows and destructive/paid actions were not
exercised end to end. The original local content, short videos, and seed
community data do not reproduce the reference catalog or production datasets.

No purchases, bookings, community posts, or paid-provider submissions were made
on the reference account. Starting reference quiz/practice onboarding created
some unsubmitted session records. Inspection was limited to ordinary browser
actions and observable responses, not source access or backend probing.

## Evidence and screenshots

The reference inspection produced **43 private screenshots**, initial route
observations, interaction observations, and a deeper course/story/practice pass.
These artifacts remain in the session's private `files/reference/` directory,
outside this application's workspace and Git history.

Evidence files:

- `observations-*.json`: routes, response status/headers, visible controls,
  navigation links, script indicators, and request observations.
- `interactions.json`: safe practice/quiz/search entry interactions.
- `deep-observations.json`: course curriculum, story bank, practice popups,
  setup flows, and access limitations.

Account details, cookie values, authenticated reference screenshots, and
proprietary text are intentionally not reproduced in this report.

The application has **30 original desktop/mobile screenshots** with routes and
descriptions in [screenshots/manifest.json](screenshots/manifest.json).
Representative views:

| Local screenshot | What it shows |
| --- | --- |
| `01-landing.png` | Original public visual design and entry points |
| `02-dashboard.png` | Personal preparation dashboard |
| `04-system-design-lesson.png` | Lesson outline, progress, bookmark, discussion |
| `05-coding-visualization.png` | Interactive algorithm explanation |
| `06-course.png`, `07-course-video.png` | Structured curriculum and original video player |
| `09-design-workspace.png` | Architecture components, directed connections, saved draft |
| `13-quiz-question.png` | Original quiz question flow |
| `14-community-questions.png` | Local filtering and question discovery |
| `20-pricing.png`, `21-gift.png` | Clearly labeled demo commerce/access workflows |
| `26-mobile-dashboard.png`, `29-mobile-dark-theme.png` | Responsive and theme variants |
| `30-enrolled-dashboard.png` | Course progress and next-step continuation |

## Observable reference stack

Browser evidence supports the following conclusions, not a complete backend
architecture reconstruction:

| Component | Observation | Confidence and boundary |
| --- | --- | --- |
| React frontend | React markers and component-driven browser behavior | High; does not reveal component source |
| Next.js | `/_next/` script assets and `x-powered-by: Next.js` response header | High; deployment model/version unconfirmed |
| nginx layer | Response header `server: nginx/1.22.1` | High for the visible header; does not identify cloud/hosting provider |
| tRPC-shaped API | `/trpc/...` calls for profile/bootstrap, learning, practice, quizzes, tutor, community-related state | High for observable endpoint shape; server code/type generation not available |
| Session-based identity | Session-cookie indicators and authenticated browser bootstrapping | High for sessions; authentication vendor/implementation unconfirmed |
| Sentry integration | Sentry browser CDN assets | High for loaded assets; telemetry configuration not inspected |
| Google identity library | Google identity script loaded | High for loaded SDK; OAuth completion not exercised |
| Facebook scripts | Facebook script resources loaded | High for resources; their purpose/configuration unconfirmed |
| Database and ORM | No reliable browser evidence | Unknown; do not infer Postgres, Prisma, MongoDB, etc. |
| AI provider/model | No reliable provider identity from safe browser observation | Unknown |
| Payments and email | Visible plan/gift flows, but no completed transaction or delivery | Provider/integration internals unconfirmed |
| Hosting and backend language | Framework/proxy signals alone are insufficient | Unknown |

Observed API responsibilities included `profile/getClientBootstrap`, course
enrollment, design-practice progress, learning read status, tutor messages/chats,
alerts, behavioral limits/history, coding/BYOE tasks, code-review problem details,
quiz/review state, karma/streak state, and personalized checklists.
`POST /trpc/quiz/createQuiz` was observed during quiz entry. These are workflow
clues, not proof of backend schemas or internal algorithms.

## How the observed workflows work

**Entry and navigation.** Public visitors see a marketing-oriented layout.
Authenticated `/` navigation redirects to the dashboard. Learning, practice,
community, quizzes, and utility/account actions form separate navigation groups.
Dashboard progress and targets personalize the next step.

**Learning.** Topic-specific outlines organize readable pages, progress markers,
comments, and premium locks. Coding explanations include interactive
visualizations. Structured courses combine video, reading, quizzes, and practice
into an enrolled curriculum rather than only a collection of articles.

**Practice.** Problem lists expose difficulty, reading status, write-ups,
entry actions, and history. System/low-level design entry opens a new browser
page. The reference screenshot named `design-workspace.png` still shows guided
onboarding with Back/Next; it is not evidence of inspecting the full live editor
or AI assessment. Coding and code-review entry expose different setup/task
surfaces. Behavioral preparation includes session choices and a story bank.

**Behavioral story builder.** The observed start route is
`/learn/behavioral/story-builder`; the bank is
`/learn/behavioral/story-builder/stories`. A guessed `/create` route returned a
reference 404. The local application uses its own functional story-bank routes
instead of claiming that guess was a working reference page.

**Quizzes.** Onboarding creates a quiz session, then displays questions.
History/review-related requests indicate persisted attempts and missed-question
review. The reference question bank is much larger than the original local one.

**Community.** Questions, preparation stories, peer designs, and discussion have
different browsing purposes. Company/type/level/region filters, premium locks,
search, contribution entry, and engagement controls were visible. No reference
community content was posted during inspection.

**Plans and gifts.** Plan comparison and premium entry lead toward checkout.
The gift flow exposes duration, quantity, delivery by email/link, and scheduled
delivery options. Transaction and delivery completion were not performed.

**Supporting pages.** Company/level guides, articles, global search, FAQ, and
support connect discovery, explanation, and account help. Real/current company
interview-loop accuracy and actual support delivery cannot be verified solely
by inspecting their entry pages.

## Feature-by-feature comparison

Status definitions:

- **Implemented:** functional comparable local workflow, not identical content,
  scale, algorithms, or production operations.
- **Partial:** local workflow exists but important reference/production behavior
  is missing or unverified.
- **Unavailable:** no equivalent connected implementation.

| Reference surface | Interview Studio route / workflow | Status and explicit differences |
| --- | --- | --- |
| Public homepage | `/` | Implemented; original name, copy, assets, and design |
| Authenticated dashboard | `/dashboard` | Implemented; targets, progress, streak, recognition, enrolled course continuation |
| Seven learning disciplines | `/learn`, `/learn/:track` | Implemented; 30 original lessons, not catalog/content parity |
| Topic outline and lesson reader | `/learn/:track/:lesson` | Implemented; read state, bookmarks, comments, previous/next links |
| Coding visualizations | `/learn/code` and coding lessons | Implemented; two pointers, sliding window, binary search, BFS, Fibonacci DP |
| Premium learning locks | Premium-marked lessons/courses | Partial; local entitlement gates, not paid reference access |
| Structured course catalog | `/learn/courses` | Implemented; four original courses, not reference catalog parity |
| Mixed-media curriculum | `/learn/courses/:id` | Implemented; enroll, combine step progress, resume next incomplete step |
| Course video lessons | `/learn/courses/:id/video/:id` | Partial; actual playback/captions/speed/download, four ~9-second original animations, no equivalent long-form video catalog |
| Course completion record | Course completion action | Implemented locally; downloadable original SVG only after all steps; no accreditation claim |
| System design problem catalog | `/practice/system-design` | Implemented; original prompts, filters, difficulty, reading state, history |
| Low-level design catalog | `/practice/low-level-design` | Implemented; original exercises and contracts/code/explanation workspace |
| Guided practice setup | `/practice/:track/:problem` | Implemented; same-tab local workspace, unlike reference new-page entry |
| Design editor | System-design session | Implemented locally; nodes, movement, directed edges, removal, undo connection, JSON export; reference full editor parity unverified |
| Saved sessions and feedback | `/history`, attempt query parameter | Implemented; drafts/history, stale-score invalidation, local rubric or optional provider |
| AI-assisted coding | `/practice/ai-coding` | Partial; original JavaScript editor and example-case runner, no equivalent provider/IDE integration |
| BYOE / repository / IDE bridge | No connected bridge | Unavailable; setup entry observed but external workflow not implemented |
| Code review practice | `/practice/code-review` | Implemented; original code, line references, written review and feedback; reference dataset/assessment parity unverified |
| Behavioral session setup | `/practice/behavioral` | Implemented; micro/mini/full sessions, company/level context, browser speech synthesis |
| Behavioral adaptive conversation | Multi-question local sessions | Partial; deterministic question sequence, not the reference adaptive interviewing pipeline |
| Behavioral story bank | `/learn/behavioral/stories` | Implemented; private STAR create/edit/delete/export |
| Quiz topic library | `/quiz` | Implemented; seven original topics, 21 questions, smaller than reference |
| Quiz session, grading, explanations | `/quiz/:topic` | Implemented; canonical server-side scoring, skips, explanations, results/history |
| Personalized quiz review | `/quiz/review` | Implemented; missed questions retained until correctly reviewed |
| Question library | `/community/questions` | Partial; local publishing/browsing and illustrative entries, no production interview-report dataset |
| Preparation stories | `/community/stories` | Partial; local contributions, labeled fictional examples, no copied testimonials |
| Peer design libraries | `/community/submissions/:track` | Implemented locally; system/low-level design submissions, no reference content corpus |
| Discussions and comments | `/community/discussion`, resource comments | Implemented; local posts, comments/replies, reversible votes/follows, pagination |
| Company/level guides | `/guides/:company/:level` | Partial; original generic planning advice, not verified insider/current interview loops |
| Editorial/articles | `/blog`, `/blog/:id` | Implemented; three original articles, not reference editorial parity |
| Global search | `/search`, Ctrl/Cmd+K | Implemented; searches original library, practice, courses, company choices and local posts |
| Tutor | `/tutor` | Partial; labeled local retrieval by default; optional provider tested with fixture, not live/reference AI |
| Signup/login/account | `/login`, `/account` | Partial; working local password accounts/demo, no social OAuth, email verification, magic links, or recovery |
| Plans/subscriptions | `/pricing`, `/premium/checkout` | Partial; explicit demo entitlements/expiry, no real payments, renewal, cancellation/billing provider |
| Gifts | `/premium/gift` | Partial; generated one-use local access codes, no quantity purchase or scheduled email delivery |
| Support | `/support` | Partial; saved local tickets only, no production support routing/delivery |
| FAQ/legal/about/changelog | `/faq`, `/privacy`, `/terms`, `/security`, `/aboutus`, `/learn/changelog` | Implemented as original documentation for this local application |
| Alerts and production personalization | No equivalent production service | Partial/unavailable; local progress-based continuation and recognition only |
| Mobile, themes, accessibility basics | Shared shell and responsive pages | Implemented; browser-checked mobile layouts, focus/skip link, no claim of full WCAG certification |

## Original local architecture

The implementation intentionally uses a simpler stack rather than pretending
to recover the reference's private source:

1. React and React Router render the responsive single-page interface.
2. Vite builds the frontend; Express embeds Vite middleware in development and
   serves the built frontend and same-origin REST API in production.
3. SQLite stores users, hashed sessions, per-user state, community interactions,
   gifts, and support tickets. Shared TypeScript types/domain rules keep scoring,
   expiry, review, and course progress consistent.
4. An opaque-origin iframe and network-disabled worker execute synchronous
   JavaScript with deadlines. The server does not execute submitted code.
5. Optional server-side OpenAI-compatible Chat Completions calls support tutoring
   and practice feedback. Malformed/unavailable provider responses surface
   errors and do not silently become rubric success.

The supplied `.cred` is not an application dependency. Private reference
artifacts are not deployment assets. Original content counts are seven tracks,
30 lessons, 21 practice exercises, seven quizzes/21 questions, four courses,
four captioned original animations, and three articles.

## Verification and remaining blockers

TypeScript checking and the Vite production build pass. Domain coverage includes
eight tests. Playwright covers 19 end-user workflows. The provider fixture checks
configured tutoring/feedback, invalid upstream output, provider outage, and
session/state persistence after a real application-process restart. Live AI
provider behavior remains unverified.

Browser checks include actual video advancement/end state, premature certificate
rejection and final download, JavaScript results/infinite-loop termination,
saved edits invalidating old feedback, course continuation, community
pagination/vote reversal, mobile overflow, and credential/user-ownership
boundaries. These checks validate the local implementation, not full reference
parity or production security.

Full parity would require authorized access to the locked reference workflows,
permission and source material for any desired proprietary content/datasets,
and separately provisioned and verified production AI, identity, email, payment,
support, and development-tool integrations. Inspection alone cannot supply those
services, recover private algorithms, or establish internal technology choices.

The application is a working local foundation with documented gaps, **not a
completed feature-for-feature replacement for Hello Interview**.
