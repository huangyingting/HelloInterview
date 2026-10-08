# Original researched System Design curriculum

The first substantial content expansion focuses on System Design. The other
six disciplines remain starter libraries, not completed textbooks. This is
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

The whole application now contains seven tracks, 47 lessons, 31 practice
problems, 15 quiz topics, 189 questions, and five courses. The flagship accounts
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
and sourced. The nine questions from other disciplines remain unchanged. New
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
`shared/content/sources.ts` holds 19 public primary references. Concepts were
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
in the remaining six disciplines. The static catalog is currently bundled in
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
