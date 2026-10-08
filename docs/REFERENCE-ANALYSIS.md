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

The application has **57 original desktop/mobile screenshots** with routes and
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
| `31-premium-studio.png`, `32-adaptive-mock.png`, `33-mock-report.png` | Original premium hub, coverage-adaptive follow-up, and completed report |
| `34-custom-quiz-builder.png`, `35-custom-quiz-results.png` | Persistent custom quiz selection and canonical results |
| `36-prep-plan.png` | Company-focused schedule tied to actual progress |
| `37-project-workbench.png`, `38-project-diff.png`, `40-project-review.png` | Source snapshot, real example checks, exact patch, and saved review |
| `39-mobile-premium.png` | Responsive premium workflows |
| `41-worked-design-library.png`, `42-worked-design.png`, `43-complete-design-course.png`, `44-mobile-worked-design.png` | Substantial original System Design content and responsive readers |
| `45-complete-coding-course.png`, `46-coding-practice.png`, `47-coding-solutions.png` | Complete original Coding path, dedicated practice, and solution discovery |
| `48-coding-solution.png`, `49-coding-workspace.png`, `50-mobile-coding-solution.png` | Revealed original reference code, saved executable draft, and mobile reader |
| `51-object-design-library.png`, `52-object-design-lesson.png`, `53-inventory-reference.png`, `54-complete-object-design-course.png` | Original object-model library, sourced lessons, worked ledger and 28-step path |
| `55-inventory-workspace.png`, `56-mobile-object-reference.png`, `57-mobile-object-dark.png` | Saved runnable stateful exercise and responsive reference-protocol readers |

### Follow-up authenticated content-coverage pass

The latest content expansion adds eight **private** viewport captures: the
dashboard and all seven learning areas. They remain outside the repository in
the session's `files/reference-more/` directory. Cached cookies were used only
in that separate HTTPS browser session, never by the local application.
All seven learning visits returned HTTP 200. The actual routes were followed
from dashboard navigation rather than assumed to match local URLs.

| Observed learning area | Visible outline families |
| --- | --- |
| Coding | Two pointers, sliding windows, intervals, stacks, linked lists, binary search, heaps, DFS/BFS, backtracking, graphs, DP, greedy, tries, prefix sums, matrices |
| Low-level design | Foundations, concurrency, problem breakdowns |
| ML system design | Foundations, features, embeddings, generalization, evaluation, breakdowns |
| Behavioral | Course and story-builder navigation |
| AI coding | Overview, fundamentals, patterns, open-ended sessions, breakdowns |
| Negotiation | A small introductory outline |
| System Design | Foundations, concepts, breakdowns, patterns, technology deep dives, real-world analyses |

Visible learning links are navigation observations, **not authoritative lesson
counts**. This pass informed topic coverage, not proprietary lesson bodies.
Coding was selected as the recommended next flagship while the user was
unavailable for a scope choice. Its local 24 lessons, 24 original executable
exercises/solutions, 180 questions, and 60-step path are independent material,
not claims of reference catalog parity or expert-certified interview readiness.

The subsequent recommended Low-Level Design expansion adds 12 substantial
lessons, eight original worked models, four new runnable stateful exercises,
80 questions, and a 28-step path. It draws on public primary references and
the previously observed outline families, not another extraction of proprietary
lessons. The original four open-ended briefs stay intact; their narrowed
reference protocols are distinguished from executable acceptance cases.

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
| Seven learning disciplines | `/learn`, `/learn/:track` | Implemented; 74 original lessons, including 24 substantial sourced lessons each in System Design and Coding and 12 in Low-Level Design; other four tracks remain starter-depth |
| Topic outline and lesson reader | `/learn/:track/:lesson` | Implemented; read state, bookmarks, comments, previous/next links |
| Coding visualizations | `/learn/code` and coding lessons | Implemented; two pointers, sliding window, binary search, BFS, Fibonacci DP |
| Premium learning locks | Premium-marked lessons/courses | Partial; local entitlement gates, not paid reference access |
| Structured course catalog | `/learn/courses` | Implemented; seven original courses, including 52-step System Design, 60-step Coding and 28-step Low-Level Design paths; not reference catalog parity |
| Mixed-media curriculum | `/learn/courses/:id` | Implemented; enroll, combine step progress, resume next incomplete step |
| Course video lessons | `/learn/courses/:id/video/:id` | Partial; actual playback/captions/speed/download, four ~9-second original animations, no equivalent long-form video catalog |
| Course completion record | Course completion action | Implemented locally; downloadable original SVG only after all steps; no accreditation claim |
| System design problem catalog | `/practice/system-design` | Implemented; original prompts, filters, difficulty, reading state, history |
| Worked architecture references | `/learn/system-design/cases`, `/practice/system-design/:id/writeup` | Implemented original content; 16 sourced worked designs, hypothetical workloads, 48 checkable calculations and follow-ups |
| Algorithm practice and references | `/practice/code`, `/learn/code/solutions`, `/practice/code/:id/writeup` | Implemented original content; 24 runnable JS exercises, substantial solutions, bounded contracts, example fixtures, complexity analysis and public sources; not an exhaustive online judge |
| Low-level design catalog and references | `/practice/low-level-design`, `/learn/low-level-design/solutions` | Implemented; eight worked models with 48 reference traces, four new runnable exercises and four preserved open-ended briefs; sequential examples do not prove production concurrency |
| Guided practice setup | `/practice/:track/:problem` | Implemented; same-tab local workspace, unlike reference new-page entry |
| Design editor | System-design session | Implemented locally; nodes, movement, directed edges, removal, undo connection, JSON export; reference full editor parity unverified |
| Saved sessions and feedback | `/history`, attempt query parameter | Implemented; drafts/history, stale-score invalidation, local rubric or optional provider |
| AI-assisted coding | `/practice/ai-coding` | Partial; original JavaScript editor and example-case runner, no equivalent provider/IDE integration |
| BYOE / repository / IDE bridge | `/premium/projects` | Partial; original snapshot import/edit/browser examples/review/patch export implemented, but no live repository/IDE/terminal bridge |
| Code review practice | `/practice/code-review` | Implemented; original code, line references, written review and feedback; reference dataset/assessment parity unverified |
| Behavioral session setup | `/practice/behavioral` | Implemented; micro/mini/full sessions, company/level context, browser speech synthesis |
| Behavioral adaptive conversation | `/premium/mock`, `/premium/mock/:id` | Implemented original topic-gap follow-ups and saved reports, also across technical disciplines; reference private interviewing pipeline remains unverified |
| Behavioral story bank | `/learn/behavioral/stories` | Implemented; private STAR create/edit/delete/export |
| Quiz topic library | `/quiz` | Implemented; 33 topics and 443 questions, including 180 sourced questions each in System Design and Coding plus 80 in Low-Level Design; no reference content parity claim |
| Quiz session, grading, explanations | `/quiz/:topic` | Implemented; canonical server-side scoring, skips, explanations, results/history |
| Personalized quiz review | `/quiz/review` | Implemented; missed questions retained until correctly reviewed |
| Premium quiz customization | `/quiz/custom`, `/quiz/custom/:id` | Implemented original mixed-topic/missed-only builder, saved order/answers, canonical score, resume, results and export |
| Question library | `/community/questions` | Partial; local publishing/browsing and illustrative entries, no production interview-report dataset |
| Preparation stories | `/community/stories` | Partial; local contributions, labeled fictional examples, no copied testimonials |
| Peer design libraries | `/community/submissions/:track` | Implemented locally; system/low-level design submissions, no reference content corpus |
| Discussions and comments | `/community/discussion`, resource comments | Implemented; local posts, comments/replies, reversible votes/follows, pagination |
| Company/level guides | `/guides/:company/:level` | Partial; original generic planning advice, not verified insider/current interview loops |
| Company-focused preparation | `/premium/studio`, `/premium/plans`, `/premium/plans/:id` | Implemented original curated exercise packs and progress-aware schedules with reflections, not official company content |
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
74 lessons, 59 practice exercises, 33 quiz topics/443 questions, seven courses,
four captioned original animations, and three articles.
The System Design flagship supplies 24 substantial lessons and 16 worked
designs; Coding adds 24 substantial lessons and 24 executable exercises with
original reference solutions. Low-Level Design supplies 12 substantial lessons
and eight worked models, including four new runnable exercises.
See [the researched curricula](CONTENT-CURRICULUM.md) for measured
depth, sources, compatibility behavior, and editorial limitations.

## Verification and remaining blockers

TypeScript checking and the Vite production build pass. Domain/content checks
cover all three expanded inventories and trusted algorithm/stateful references.
Playwright covers 36 end-user workflows. The seven provider/restart fixture tests check
configured tutoring/feedback, invalid upstream output, provider outage, and
session/state persistence after a real application-process restart, premium
mock/project grading, stale-response/access-ending protection, and persistence
of every new premium record type. Live AI
provider behavior remains unverified.

Browser checks include actual video advancement/end state, premature certificate
rejection and final download, JavaScript results/infinite-loop termination,
saved edits invalidating old feedback, course continuation, community
pagination/vote reversal, mobile overflow, and credential/user-ownership
boundaries. These checks validate the local implementation, not full reference
parity or production security. See [the premium workflow design](PREMIUM-WORKFLOWS.md)
for original algorithms, access rules, data limits, and integration boundaries.

Full parity would require authorized access to the locked reference workflows,
permission and source material for any desired proprietary content/datasets,
and separately provisioned and verified production AI, identity, email, payment,
support, and development-tool integrations. Inspection alone cannot supply those
services, recover private algorithms, or establish internal technology choices.

The application is a working local foundation with documented gaps, **not a
completed feature-for-feature replacement for Hello Interview**.
