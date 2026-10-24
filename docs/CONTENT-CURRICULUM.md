# Original researched interview curricula

The first substantial content expansion focuses on System Design; the second
builds a Coding & Algorithms flagship; the third expands Low-Level Design.
AI & ML now includes architecture, runnable labs, and native visual courses.
Behavioral, AI-Assisted Coding, and Negotiation remain starter libraries. This is
independently written instructional material, not copied Hello Interview
content, an official company solution bank, or evidence of interview readiness.

## Delivered inventory and measured depth

| Material | Count | Counted instructional words | Per-item range |
| --- | ---: | ---: | ---: |
| System Design lessons | 24 | 13,945 | 564-593 |
| Worked designs | 16 | 17,408 | 1,055-1,122 |
| System Design question explanations | 180 | 12,420 | 55-79 |
| Total | | 43,773 | |

Lesson counts include section prose and instructional bullets. Case counts
include section prose/bullets and follow-up answers. Question counts include
answer explanations only. Headings, summaries, objectives, exercises, scope
assumptions, numerical annotations, diagrams, code, question prompts, and
answer choices are excluded. Thus the totals do not count navigation or
metadata as teaching depth.

The whole application now contains seven tracks, 94 lessons, 67 practice
problems, 49 quiz topics, 507 questions, and thirteen courses. The System Design flagship accounts
for 24 lessons, 16 problems, 12 topics, and 180 questions. Four original short
animated clips and three journal articles remain unchanged.

## Learning progression

1. **Frame the contract:** interview structure, requirements/invariants,
   capacity estimation, APIs.
2. **Protect state and reads:** data modeling/indexes, transactions, application
   caching, HTTP caching.
3. **Distribute work and ownership:** queues, event streams, replication,
   sharding.
4. **Operate under a budget:** load balancing, rate limiting, reliability,
   observability.
5. **Specialized paths:** authorization/security, object storage, search
   projections, real-time delivery.
6. **Evolve and defend:** event-time processing, multi-region recovery,
   migrations, and evidence-based tradeoffs.

`/learn/courses/system-design-complete` connects all 24 readings, 12 whole-topic
quizzes, and 16 guided exercises in **52 steps**. It is explicitly a text-based
curriculum, not a new long-form video course. Some steps use the existing local
premium-demo entitlement. The original four curricula and their identifiers
remain unchanged.

## Worked-design library

`/learn/system-design/cases` links to the actual write-up for each exercise:

| Existing exercises, now with worked references | New exercises with worked references |
| --- | --- |
| Short-link service | Object storage |
| Document synchronization | Video delivery |
| Ticket reservations | Notification platform |
| Team chat | Payment ledger |
| Activity feed | API gateway |
| Distributed job scheduler | Metrics platform |
| | Search service |
| | Collaborative editor |
| | Location matching |
| | Webhook delivery |

Every worked design contains scoped hypothetical assumptions, an original
ASCII architecture sketch, three independently specified capacity calculations,
failure and recovery reasoning, alternatives, three detailed follow-ups, six
related lessons, and public references. **All 48 calculations** expose numeric
factors, a divisor, result, unit, and explanatory assumptions. They are teaching
models, not measurements of real production services. Reading a reference does
not mark its practice attempt complete.

The write-up is offered in the practice listing and before starting a workspace,
not as a new link that silently discards an actively edited draft. Diagrams
scroll within their own container on small screens.

## Question bank and history compatibility

There are 15 questions for each of requirements, capacity estimation, API
design, caching, data modeling, queues, replication, sharding, reliability,
security, observability, and tradeoffs.

The expansion adds **168** static questions while preserving the 12 existing
System Design prompts/options/answer indices. Their explanations were expanded
and sourced. The original nine other-discipline prompts/options/answer indices
remain unchanged; the three pointer explanations are now expanded and sourced
by the Coding expansion. New System Design
questions have 44 Easy, 80 Medium, and 44 Hard items; their correct positions
are evenly distributed at 42 per index. Every System Design topic includes
at least two Easy and two Hard questions.

Existing lesson/problem/question identities, problem rubrics, and old course
definitions are preserved. Archived normal reports now render only the
question IDs recorded in their saved answers, rather than displaying new
questions as retroactively skipped. Stored scores/totals are not rewritten.
Custom archives continue to use their saved selected IDs. New whole-topic
attempts cover all 15 current questions; premium customization remains a
separate canonical saved-session workflow.
New normal reports persist every graded question ID, including an explicit
skip for an omitted API answer, so their explanations and totals stay aligned.
Review reports still snapshot only the submitted review subset.

## Research method and public references

Research date: **2026-10-08**. The typed registry in
`shared/content/sources.ts` holds 32 public references, including the 19 used
for System Design, six added for Coding, and seven added for Low-Level Design. Concepts were
checked against provider/protocol documentation, then synthesized into original
prose, hypothetical examples, diagrams, and questions. No vendor diagram,
premium lesson, reference-site video, or third-party solution was imported.

| Authority | Public reference areas |
| --- | --- |
| IETF | [HTTP semantics](https://httpwg.org/specs/rfc9110.html), [HTTP caching](https://httpwg.org/specs/rfc9111.html), [WebSocket](https://www.rfc-editor.org/rfc/rfc6455) |
| PostgreSQL | [Isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html), [recovery/archiving](https://www.postgresql.org/docs/current/continuous-archiving.html) |
| Google SRE | [Monitoring](https://sre.google/sre-book/monitoring-distributed-systems/), [overload](https://sre.google/sre-book/handling-overload/), [SLOs](https://sre.google/workbook/implementing-slos/) |
| Stripe | [Idempotency](https://docs.stripe.com/api/idempotent_requests), [webhooks](https://docs.stripe.com/webhooks) |
| AWS | [S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html), [transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) |
| OWASP | [Object-level authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) |
| Redis | [Eviction](https://redis.io/docs/latest/develop/reference/eviction/) |
| RabbitMQ | [Publisher confirms and consumer acknowledgements](https://www.rabbitmq.com/docs/confirms) |
| Apache Kafka | [Design and guarantee boundaries](https://kafka.apache.org/41/design/design/) |
| Apache Flink | [Event time and watermarks](https://nightlies.apache.org/flink/flink-docs-stable/docs/concepts/time/) |
| Jepsen | [Consistency models](https://jepsen.io/consistency) |

Source links are further reading and concept provenance, not an assertion that
a publisher endorsed the example architecture. Live documentation may change.
The application does not fetch external pages during a lesson or quiz.

## Editorial and product limitations

There has been **no independent human expert review** or controlled assessment
of hiring outcomes. Automated checks validate shape, depth, links, and arithmetic,
not the universal correctness of every architectural choice. A real workload,
engine version, regulatory requirement, or operational environment can change
the appropriate answer. Confirm version-specific guarantees in the cited
documentation before using a design in production.

The curriculum is a useful initial handbook and casebook, not full parity with
the reference platform. It does not add a verified company-report corpus,
long-form videos, a live IDE, production payments, or equivalent content depth
in the remaining four disciplines. The static catalog is currently bundled in
the client; its increased payload is a known delivery tradeoff, not a server-side
content publishing or editorial management system.

## Verification

`tests/content.test.ts` enforces exact 24/16/180 inventory, unique identities and
prompts/options, >=500 instructional words per lesson, >=750 per case,
>=45 per explanation, valid sources/resources, difficulty coverage,
answer-position distribution, and every case calculation.

Browser coverage checks source-linked paragraph rendering, discovery and
enrollment, real write-ups, calculations/figures/follow-ups, search, legacy
topic/custom archives, and mobile light/dark rendering without page overflow.
The existing domain, provider/restart, and complete browser suites also run.

## Coding & Algorithms expansion

A fresh authenticated Playwright pass examined the dashboard and seven
learning-area outlines. Coding was the largest clearly observed gap: the
reference outline exposed two pointers, sliding windows, intervals, stacks,
linked lists, binary search, heaps, DFS/BFS, backtracking, graphs, dynamic
programming, greedy reasoning, tries, prefix sums, and matrices. Those
navigation observations informed coverage only; no premium lesson, proprietary
solution, question bank, or video was reproduced. The user was unavailable for
the scope choice, so the recommended Coding-first expansion was used.

The local expansion provides **24 substantial lessons, 24 original executable
exercises, 12 quiz topics, and 180 Coding questions**. It adds 19 lessons and
177 questions net while preserving the original five lesson IDs/titles and
three pointer prompts/options/correct indices. Only the previously gated
`dynamic-programming` lesson remains premium-marked. The prior five curricula
and original practice definitions remain intact.

| Coding material | Count | Counted instructional words | Per-item range |
| --- | ---: | ---: | ---: |
| Lessons | 24 | 14,267 | 575-608 |
| Worked-solution reasoning | 24 | 8,710 | 354-376 |
| Question explanations | 180 | 10,771 | 55-65 |
| Total | | 33,748 | |

The same prose/bullet/explanation-only counting rules apply; code, diagrams,
contracts, objectives, complexity metadata, prompts, and options are excluded.
Together the two flagships contain **77,521 counted instructional words**.
Coding has **146 independently specified example fixtures**. Its 177 new
questions comprise 35 Easy, 106 Medium, and 36 Hard items; answer positions
0-3 occur 47, 47, 47, and 36 times, respectively. The three retained pointer
questions complete the 180-question Coding bank.

### Progression and routes

`/learn/courses/coding-complete` has **60 unique steps**: 24 readings, 12
whole-topic quizzes, and 24 practice exercises, with no new video claims.

1. Contracts, complexity, arrays/hashing, and two-pointer elimination.
2. Windows, prefix sums, interval boundaries, stacks, and monotonic stacks.
3. Linked lists, binary-search boundaries/feasibility, heaps, and trees.
4. Graph traversal, shortest unweighted routes, topological order, and union-find.
5. Backtracking, coin-change DP, subsequence DP, and greedy selection.
6. Tries, matrix components, bit constraints, and solution verification.

`/practice/code` is a dedicated algorithm workspace, not a redirect to
AI-assisted project tasks. `/learn/code/solutions` and
`/practice/code/:id/writeup` provide the actual worked solutions. The list and
pre-session onboarding link to these readers; an active editor does not add a
reference link that discards an unsaved draft. Related lessons, practice, quiz
links, course enrollment, navigation, and global search are wired together.
Only the five supported algorithm labs appear on their corresponding lessons;
unrelated chapters no longer fall back to a two-pointer visualizer.

### Runnable exercises and reference boundaries

Each exercise has a bounded valid-input domain, deterministic JSON output,
at least six independently specified examples, at least 300 solution-prose
words, complexity assumptions, related lessons, and public sources. The
reference implementation is original synchronous JavaScript `solve(input)`.
Examples cover boundaries such as empty collections, duplicate/equal values,
unreachable targets, graph cycles, and touching half-open intervals. Depending
on the contract, identifiers such as `__proto__` and `constructor` are valid
keys, and nondecreasing subsequences deliberately count equal values.

The reader reveals code only on request and does not execute it. Practice
execution reuses the existing network-disabled browser worker inside an
opaque-origin frame with a two-second limit. **The backend never executes
submitted user code.** Tests execute only checked-in trusted reference code,
not arbitrary submissions. They verify example outputs, serialization,
input immutability, repeat calls, and independently computed small-case
oracles. Example passes and coverage-based feedback are not universal
correctness proofs, mastery claims, or an exhaustive hidden-test judge.

### Coding sources and editorial checks

Research date: **2026-10-08**. Six public references were added to the shared
registry:

| Authority | Reference |
| --- | --- |
| MIT OpenCourseWare | [Introduction to Algorithms](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/) |
| NIST | [Dictionary of Algorithms and Data Structures](https://xlinux.nist.gov/dads/) |
| V8 | [Stable Array.prototype.sort](https://v8.dev/features/stable-sort) |
| MDN | [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map), [Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number), [bitwise AND](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Bitwise_AND) |

JavaScript `Map` has a specification-level average sublinear access requirement,
not a mandated O(1) implementation; expected hash-table bounds must state their
model. Built-in sort is stable and mutating, but its algorithm and complexity
are not specified. Copying input consumes auxiliary space. Number safe-integer
bounds and signed 32-bit bitwise conversions are separate constraints. The
lessons explicitly distinguish nonnegative sum windows, unweighted BFS,
active-versus-completed DFS, output size, recursion depth, LIS/LNDS equality,
and ASCII contracts from Unicode grapheme handling.

`tests/coding.test.ts` enforces the promised scope, depth, references, identity
compatibility, fixture execution, difficulty/answer-position coverage, and
complete course coverage. Public browser tests cover actual reader discovery,
mobile light/dark layouts, and every reference through the production browser
runner; the existing authenticated content workflow also covers course
enrollment, saved executable drafts, and old-versus-new pointer quiz archives.
The Coding expansion's delivered build passed 29 domain/content checks, seven provider/restart
checks, and 33 browser workflows. A real production 3/3 pointer report was
created before the upgrade and remains 3/3 afterward; a new attempt grades
15/15. The saved coding draft, course enrollment, and both reports also
survived a second production-process restart without replacing the SQLite
database. All 50 original-application screenshot files and manifest entries
were verified.

Like the System Design material, this is a source-informed draft without
independent human expert certification. It does not upgrade the remaining five
disciplines, videos, verified company reports, or production-provider services.

## Low-Level Design expansion

The recommended next expansion provides **12 substantial lessons, eight
worked references, four new runnable exercises, eight quiz topics, and 80
questions**. It adds eight lessons, four problems, 77 questions, seven topics,
and one course net. The four original lesson identities/titles, original four
problem definitions/starters/rubrics, three original question prompts/options/
answer indices, and all six existing curricula are preserved.

| Low-Level Design material | Count | Counted instructional words | Per-item range |
| --- | ---: | ---: | ---: |
| Lessons | 12 | 6,323 | 511-540 |
| Worked-model reasoning | 8 | 3,118 | 382-398 |
| Question explanations | 80 | 4,383 | 51-61 |
| Total | | 13,824 | |

Counts include instructional section bodies/bullets and answer explanations,
including prose that explains model contracts. Separate requirements lists,
headings, objectives, links, code, diagrams, complexity metadata, prompts, and
choices are excluded. Across System Design, Coding, and Low-Level Design,
the expanded corpus has **91,345 counted instructional words**.

### Learning progression and practice boundaries

`/learn/courses/low-level-design-complete` connects **28 unique steps**:
12 readings, eight whole-topic quizzes, and eight practice exercises.
It has no new videos, and retains the existing concurrency lesson and limiter
exercise's premium-demo gates. The original six-step object design course
and concurrency course remain available.

1. Requirements, object identity/value modeling, responsibility and dependency direction.
2. Interfaces, lifecycle transitions, error categories, and uncertain outcomes.
3. Shared ownership, collection/resource bounds, and appropriately scoped patterns.
4. Persistence boundaries, independent tests, and a complete design walkthrough.

The new reader library is `/learn/low-level-design/solutions`; actual references
live at `/practice/low-level-design/:id/writeup`. Discovery, related lessons,
course enrollment, practice links, and a dedicated Object designs search
category are wired together. Coding solutions remain in their separate search
category, and active editors do not gain links that discard unsaved drafts.

| Preserved open-ended briefs with narrowed reference protocols | New runnable `solve(input)` exercises |
| --- | --- |
| Parcel lockers: allocation, pickup, inclusive expiry | Inventory ledger: conserved stock and identity lifecycle |
| Parking garage: session ownership and injected pricing | LRU cache: touching/non-touching queries and eviction |
| Board game: turn, victory, draw and rejected moves | Approval workflow: versioned edges and historical receipts |
| Rate limiter: bounded fixed-window admission | File catalog: hierarchical kinds and nonrecursive deletion |

Each reference has six independently specified traces, an original object
sketch, four reasoning sections, explicit valid-input bounds, complexity
assumptions, and public references. **All 48 cases** pass trusted-reference
checks and the actual isolated browser-worker serialization protocol.
Only the four new problems attach those traces as executable acceptance cases.
The original parcel starter and other open-ended briefs are not silently
reinterpreted as runnable solve harnesses.

The references are sequential, synchronous teaching models. They do not prove
real database compare-and-swap, overlapping allocation correctness, durable
receipts, provider payment, distributed cache freshness, or actual filesystem
safety. Parcel pickup identifiers are deliberately predictable teaching IDs,
not production credentials. The approval table is not a full SCXML engine.
The file catalog does not perform filesystem I/O.

### Questions, public sources and verification

Each of design principles, object modeling, interfaces, state machines, error
contracts, concurrency, collections, and testing designs has ten questions.
The full LLD bank contains **18 Easy, 46 Medium, and 16 Hard** questions.
The 77 new questions place correct answers at indices 0-3 **20, 19, 19, 19**
times; the original three maintain their old positions. Source-informed
explanations explicitly distinguish local encapsulation from authorization,
logical expiry from cleanup, and sequential traces from concurrent guarantees.

Seven public primary references were added on **2026-10-08**:

| Authority | Reference |
| --- | --- |
| MDN | [Classes and encapsulation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes) |
| Martin Fowler | [Dependency injection](https://martinfowler.com/articles/injection.html), [Tell-Don't-Ask](https://martinfowler.com/bliki/TellDontAsk.html), [Unit testing](https://martinfowler.com/bliki/UnitTest.html) |
| PostgreSQL | [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html), [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html) |
| W3C | [SCXML state/event semantics](https://www.w3.org/TR/scxml/) |

No proprietary lesson or third-party implementation was copied. Fowler's
discussion does not prohibit useful queries; unit tests need not mock every
pure collaborator. A PostgreSQL CHECK is not an arbitrary cross-row invariant,
and row locks do not universally protect absent predicates. Reference-protocol
claims stay separate from those real infrastructure mechanisms.

`tests/low-level-design.test.ts` verifies exact scope, >=500 words per lesson,
>=350 reasoning words per model, >=45 words per explanation, resolved resources,
preserved contracts/gates, all fixtures, repeated calls, and input immutability.
Four independent oracles use recomputed array-based stock accounting, array
recency, declarative workflow edges/receipts, and a nested directory tree.
They compare **4,800 deterministic trace prefixes** against the references.
Additional checks cover last-cell victory, pricing edges, exact expiry, and
hard active-key admission limits. Browser coverage exercises discovery, real
reference code, responsive light/dark readers, old-versus-new quiz archives,
saved runnable drafts, and enrollment.

The delivered expansion passes **38 domain/content checks, seven provider/
restart checks, and 36 browser workflows**. A genuine production 3/3 object
design report was created before upgrading the question bank; it remains a
three-question archive afterward, while a new whole-topic attempt grades
10/10. The actual session, course enrollment, saved inventory-code draft,
and both reports survived another production-process restart using the same
SQLite database. All **57 original-application screenshots** and unique
manifest entries were verified. Temporary QA authentication state was removed.

This expansion remains original, source-informed material without independent
human expert review or reference-platform parity. At that milestone, Behavioral,
AI-Assisted Coding, ML System Design, and Negotiation remained starter-depth;
the AI expansion below supersedes the ML status. The approximately 1.55 MB
minified / 480 KB gzip static-client measurement above is historical, not a
budget or measurement of the current deferred-content Next.js build.

## AI courses and native Dojo-topic diagrams

The ML & AI System Design track now has 24 lessons, eight practice exercises,
and 17 quiz topics. Existing short ML lessons, premium flags, question IDs,
architecture exercises, runnable labs, and enrolled-course step contracts are
preserved. Six courses share this track: the AI engineering architecture path,
retrieval and agent execution follow-ups, and three visual follow-ups.

| New path | New lessons | Whole-topic quizzes | Existing bridge and practice |
| --- | --- | --- | --- |
| `/learn/courses/model-behavior` | Attention mechanics; decoding controls | 2, four questions each | LLM foundations; knowledge-assistant architecture |
| `/learn/courses/inference-economics` | KV capacity; streaming service levels | 2, four questions each | Inference serving; inference-gateway architecture |
| `/learn/courses/prompt-contracts` | Context contracts; structured proposals | 2, four questions each | AI safety; context packer and tool-proposal labs |

These add six original lessons (587-601 instructional words each), 24 original
question explanations, six step-through SVG flow diagrams, and five local
interactive visual labs. The first two paths have six steps; the third has
seven. A lesson or practice resource completed elsewhere contributes to every
course referencing it, following the existing shared-progress model.
Manipulating a diagram or calculator does not mark a lesson read or complete
practice. Explicit reading, canonical quiz reports, and completed practice
attempts continue to determine course progress.

### Provenance and reuse boundary

The explicitly requested sibling `../llmdojo` was inspected at revision
`3e9e39a6655962e18a99de2e2b6e8497841bcef4`. Its module/topic titles and named
visualization concepts informed the selection. It stores captured SSR trees
and compiled client bundles, so **none of its page prose, diagrams, bundles,
assets, dynamic module loader, account data, or authentication bridge is
imported or executed here**. This is independent Studio material, not a port of
the upstream course or a claim of affiliation or certification.

Course and lesson references retain that pinned topic-map link. Technical
definitions are separately grounded in PyTorch attention, Hugging Face
generation/cache documentation, OpenAI structured-output documentation,
OWASP, and the existing serving/evaluation sources. New references record
2026-10-24 without changing research dates of earlier sources.

### Diagram and calculation contracts

`ContentSection.flow` is a typed ordered sequence with node titles and detailed
step explanations. `LearningFlow` renders text-only React SVG nodes with unique
marker IDs, direct selection, back/next/reset controls, live detail, and an
ordered text alternative. The bounded horizontal viewport follows the selected
step without animation. There is no arbitrary SVG, HTML, Mermaid execution, or
graph import path. Existing ASCII references and the saved architecture editor
remain unchanged.

`ContentSection.visualization` selects one of five statically registered,
lazy-loaded labs. `shared/ai-visuals.ts` owns their pure calculations and rejects
invalid ranges instead of returning invented success values:

- **Causal attention:** synthetic pre-scaled scores; softmax of the visible
  prefix only; masked future positions remain exactly zero. It is not a model
  weight inspector, a full transformer, or a causal explanation of an answer.
- **Sampling:** stable temperature scaling, top-k selection, renormalization,
  top-p prefix, then renormalization. Ties preserve original order. Other
  runtimes can order transforms differently; this is not factual confidence.
- **KV cache:** `2 * layers * kvHeads * headDimension * tokens * sequences *
  bytesPerElement`, reported in binary MiB/GiB. The uniform full-attention
  payload model excludes weights, activations, paging, scales, sharing,
  replication, and allocator overhead. It cannot establish device fit.
- **Streaming:** queue plus prefill includes first-token production; final
  time adds `(outputTokens - 1) * interval`. A deadline pass is only a timing
  classification, not measured quality-qualified goodput or a GPU benchmark.
- **Context:** reserve instructions/schema, history, and output first, then
  greedily pack unique eligible synthetic evidence in order, skipping oversized
  items. Overcommitted fixed reservations produce an explicit error and no
  packed evidence. The fixture eligibility switch is not real authorization
  and its supplied token costs do not implement a tokenizer.

All calculations and controls are local, credential-free, network-free
experiments. They do not call a model or mutate account progress. Content still
loads through the existing content API and normal account actions still use
the existing authenticated service.

`tests/dojo.test.ts` checks content depth, references, grading, metadata
separation, safe SVG text, independent causal rows and invariants, sampling
mass/cutoffs/ties, byte arithmetic, timing boundaries, context overflow, and
invalid input. `tests/dojo.spec.ts` covers discovery, all flow controls, actual
calculator results, no provider calls or progress writes, 320px light/dark
reflow, reduced motion, and forced colors. The final Dojo scenario in
`tests/product.spec.ts` verifies enrollment, explicit reading, saved sourced
quiz reports, and persistent shared-resource course progress.
