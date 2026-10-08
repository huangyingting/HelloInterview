import type { Lesson, Problem, QuizQuestion, Track, TrackId } from './types';

const lesson = (
  id: string, title: string, group: string, summary: string,
  sections: Lesson['sections'], exercise: string, premium = false,
): Lesson => ({ id, title, group, summary, sections, exercise, premium, minutes: 6 + sections.length * 2 });

export const tracks: Track[] = [
  {
    id: 'system-design', title: 'System Design', short: 'Build systems that scale',
    description: 'Turn an ambiguous problem into a clear, defensible architecture.',
    color: '#147d71',
    lessons: [
      lesson('introduction', 'A practical design interview', 'Foundations', 'A repeatable path from requirements to trade-offs.', [
        { title: 'Start with the user', body: 'A design is only useful when it solves a specific user problem. Ask who uses the system, which actions matter, and what a successful request looks like.', bullets: ['Name two essential user journeys.', 'Separate functional behavior from reliability and performance goals.', 'Confirm what is intentionally out of scope.'] },
        { title: 'Make assumptions visible', body: 'Estimate the number of users, requests per second, and stored bytes. Treat these estimates as a tool for comparing designs rather than as trivia.' },
        { title: 'Walk through one request', body: 'Draw the simplest end-to-end flow first. Explain where information is validated, stored, and returned. Add complexity only to address a stated requirement.' },
        { title: 'Defend the trade-off', body: 'Every optimization moves a cost somewhere else. A cache reduces database load but introduces staleness. An asynchronous queue absorbs bursts but adds delay.' },
      ], 'Sketch a document-sharing service. Identify one read path, one write path, and one failure you would handle.'),
      lesson('api-design', 'Designing useful APIs', 'Core concepts', 'Contracts that clients can depend on.', [
        { title: 'Model resources, not database tables', body: 'An API should describe what a client can do. Choose stable identifiers and explicitly document pagination, authorization, and errors.', code: 'POST /documents\nGET /documents/:id\nGET /documents?cursor=next&limit=25' },
        { title: 'Make retries safe', body: 'A client may not know whether a timed-out request succeeded. An idempotency key associates repeated attempts with one operation.', bullets: ['Validate input at the boundary.', 'Use explicit status codes.', 'Keep response shapes stable across versions.'] },
        { title: 'Plan for growth', body: 'Cursor pagination avoids repeatedly scanning the beginning of a growing list. Rate limits protect shared capacity and should include retry guidance.' },
      ], 'Design create, read, and list endpoints for a team task board.'),
      lesson('caching', 'Caching without surprises', 'Core concepts', 'Faster reads, with an explicit freshness budget.', [
        { title: 'Cache-aside', body: 'Read the cache first. On a miss, read the source of truth and store the result with a bounded lifetime. The database remains authoritative.' },
        { title: 'Invalidation is a product decision', body: 'The acceptable age of a result depends on the user journey. A profile picture can be slightly stale; a permission check usually cannot.', bullets: ['Use tenant-aware cache keys.', 'Add expiry jitter to avoid synchronized misses.', 'Measure hit rate and backend latency together.'] },
        { title: 'Avoid a stampede', body: 'When a hot entry expires, many requests may refresh it at once. Coalesce refreshes or serve a recent stale value while one request updates the cache.' },
      ], 'Choose a caching strategy for a restaurant menu and for remaining event tickets. Explain why they differ.'),
      lesson('data-modeling', 'Data modeling and indexes', 'Core concepts', 'Work backward from the reads and writes you must support.', [
        { title: 'Begin with access patterns', body: 'Write down the most common queries and their filters. Then select keys, indexes, and relationships that keep those queries predictable.' },
        { title: 'An index has a price', body: 'Indexes accelerate lookups but consume space and slow writes. Composite index ordering should reflect equality predicates and sort order.', code: 'CREATE INDEX tasks_by_team_status\nON tasks(team_id, status, created_at);' },
        { title: 'Protect invariants', body: 'Use database constraints and transactions for rules that must survive concurrent writers. Application checks alone can race.' },
      ], 'Model tasks, team memberships, and comments. Add an index for the newest open tasks in one team.'),
      lesson('queues', 'Queues and asynchronous work', 'Architecture patterns', 'Separate accepting work from completing it.', [
        { title: 'Decouple slow operations', body: 'A request can enqueue a job and return its identifier. Workers process jobs independently, letting the system absorb temporary bursts.' },
        { title: 'Assume duplicate delivery', body: 'A worker can finish a side effect and fail before acknowledging a message. Deduplicate with a durable operation identifier.', bullets: ['Retry transient failures with backoff.', 'Send exhausted jobs to a dead-letter queue.', 'Monitor age of the oldest unprocessed job.'] },
        { title: 'Choose ordering deliberately', body: 'Global ordering limits throughput. Partitioning by account or document often provides the ordering users actually need.' },
      ], 'Design a reliable email delivery pipeline, including retry and duplicate handling.'),
      lesson('replication', 'Replication and consistency', 'Advanced topics', 'Keep availability and correctness in the same conversation.', [
        { title: 'Read replicas', body: 'Replicas can scale reads and provide redundancy, but they may lag behind writes. Use a primary read when the user must immediately observe a change.' },
        { title: 'Define the invariant', body: 'Consistency is easiest to reason about for a concrete rule. A seat must not be sold twice; a reaction count can converge later.' },
        { title: 'Design for partial failure', body: 'Network failures do not prove another node is dead. Timeouts, leases, and fencing tokens help prevent competing writers from corrupting shared state.' },
      ], 'Compare consistency needs for account balances and a public activity feed.', true),
      lesson('sharding', 'Partitioning a growing dataset', 'Advanced topics', 'Distribute data without losing control of hot keys.', [
        { title: 'Choose a partition key', body: 'A useful key spreads load while keeping frequent operations local. A tenant identifier is convenient, but a single large tenant can dominate a shard.' },
        { title: 'Plan rebalancing', body: 'Virtual partitions make it possible to move small ranges of data between physical nodes. Keep routing metadata versioned.' },
        { title: 'Know your cross-shard operations', body: 'Global joins and transactions become more expensive. Denormalization or asynchronous materialized views can reduce coordination.' },
      ], 'Partition an analytics event store and describe how you would handle one unusually busy customer.', true),
    ],
  },
  {
    id: 'code', title: 'Coding & Algorithms', short: 'See the pattern, solve the problem',
    description: 'Understand algorithms with interactive visualizations and executable practice.',
    color: '#5971c4',
    lessons: [
      lesson('two-pointers', 'Two pointers', 'Array patterns', 'Replace repeated search with a coordinated pair of positions.', [
        { title: 'A sorted array gives you direction', body: 'For a target sum in a sorted array, start at both ends. If the sum is too small, move the left pointer; if it is too large, move the right pointer.' },
        { title: 'State the invariant', body: 'Each move eliminates pairs that cannot satisfy the target. This lets you inspect a linear number of pairs rather than every combination.', code: 'while (left < right) {\n  const sum = values[left] + values[right];\n  if (sum === target) return [left, right];\n  if (sum < target) left++;\n  else right--;\n}' },
        { title: 'Account for complexity', body: 'The search is O(n) with O(1) extra space when input is already sorted. Sorting beforehand changes the overall time and may change original indices.' },
      ], 'Use the visualization below to find a pair that adds to 17. Explain each pointer movement.'),
      lesson('sliding-window', 'Sliding windows', 'Array patterns', 'Maintain a small summary as a range changes.', [
        { title: 'Reuse adjacent work', body: 'For fixed-size window sums, subtract the element leaving the window and add the element entering it. Recomputing each sum wastes work.' },
        { title: 'Variable-size windows', body: 'Extend the right edge, then move the left edge until the constraint holds. This works when shrinking the window predictably restores validity.' },
        { title: 'Choose the summary', body: 'A sum, frequency map, or distinct count may be enough. The summary must support both adding and removing an element efficiently.' },
      ], 'Find the longest substring without repeated characters, and explain what the frequency map stores.'),
      lesson('binary-search', 'Binary search on an invariant', 'Search', 'Halve the space by proving which half cannot contain the answer.', [
        { title: 'Define the boundary', body: 'Decide whether you are finding an exact value, the first true predicate, or the last feasible value. A clear contract prevents off-by-one errors.' },
        { title: 'Shrink every iteration', body: 'Keep a half-open search interval. Every branch must make the interval smaller.', code: 'let left = 0, right = values.length;\nwhile (left < right) {\n  const mid = left + Math.floor((right - left) / 2);\n  if (values[mid] < target) left = mid + 1;\n  else right = mid;\n}\nreturn left;' },
      ], 'Find the insertion position for 8 in [1, 3, 6, 9, 12].'),
      lesson('graph-search', 'Graph traversal', 'Graphs', 'Track a frontier and avoid visiting the same state twice.', [
        { title: 'Breadth-first search', body: 'A queue explores states by distance from the starting point. For equal-cost edges, the first discovered path is a shortest path.' },
        { title: 'Depth-first search', body: 'A stack or recursion follows one path before returning. This is useful for reachability, connected components, and structural analysis.' },
        { title: 'Represent the visited state', body: 'Mark a node when adding it to the frontier, not after removing it. Otherwise several parents may enqueue the same node.' },
      ], 'Choose BFS or DFS for the shortest route through an unweighted maze.'),
      lesson('dynamic-programming', 'Dynamic programming', 'Optimization', 'Cache overlapping subproblems instead of solving them again.', [
        { title: 'Describe the state', body: 'A state must contain exactly the information needed to make the next decision. Start with a recurrence before choosing an implementation.' },
        { title: 'Base cases and transitions', body: 'Base cases anchor the recurrence. Each transition compares valid choices and combines results from smaller states.' },
        { title: 'Reduce space carefully', body: 'A rolling array works when only a small set of preceding states is needed. Keep the full table when reconstructing the solution.' },
      ], 'Define the state and recurrence for minimum coins needed to make a target amount.', true),
    ],
  },
  {
    id: 'low-level-design', title: 'Low-Level Design', short: 'Make your code easy to change',
    description: 'Translate requirements into cohesive objects, contracts, and reliable code.',
    color: '#b37a4c',
    lessons: [
      lesson('introduction', 'From requirements to responsibilities', 'Foundations', 'A small, explicit object model beats a web of clever abstractions.', [
        { title: 'Identify behavior before classes', body: 'List the operations the application must support. Group related responsibilities and clarify which object owns each invariant.' },
        { title: 'Keep boundaries small', body: 'Separate business rules from persistence and input/output. This makes domain behavior testable without real infrastructure.' },
        { title: 'Show one complete use case', body: 'Walk through a representative operation, including validation and an error. A class diagram alone does not demonstrate a working design.' },
      ], 'Model a parcel locker service. Explain how one package is assigned to a compatible locker.'),
      lesson('design-principles', 'Cohesion and dependency direction', 'Object design', 'Put change behind a stable contract.', [
        { title: 'One reason to change', body: 'A class should group responsibilities that evolve together. Formatting an invoice and deciding its tax are different reasons to change.' },
        { title: 'Prefer composition', body: 'Composing a pricing policy often models variation more clearly than creating a deep inheritance hierarchy.' },
        { title: 'Invert infrastructure dependencies', body: 'Business logic depends on a repository contract. An adapter implements that contract for the selected database.' },
      ], 'Refactor a checkout service so discount policies can be tested separately.'),
      lesson('concurrency', 'Concurrency and shared state', 'Concurrency', 'Protect invariants across overlapping operations.', [
        { title: 'A check is not an atomic update', body: 'Two requests can both observe an available resource before either reserves it. Protect the check-and-update operation as one unit.' },
        { title: 'Minimize critical sections', body: 'Do not hold a lock while making slow network calls. Lock only the data mutation that must be indivisible.' },
        { title: 'Test competing operations', body: 'Tests should force overlapping requests. Use a database constraint or atomic operation when a process-local lock is not sufficient.' },
      ], 'Describe how to prevent two users from reserving the same parking space.', true),
      lesson('state-machines', 'Explicit state transitions', 'Patterns', 'Make illegal transitions impossible to miss.', [
        { title: 'Name the states', body: 'An order might be draft, submitted, paid, shipped, or cancelled. Each state admits only a defined set of operations.' },
        { title: 'Guard transitions', body: 'Validate the current state and event before persisting the next state. Store enough history to explain how the system arrived there.' },
      ], 'Define the legal states and transitions for a file upload.'),
    ],
  },
  {
    id: 'behavioral', title: 'Behavioral Interviews', short: 'Tell the story behind your impact',
    description: 'Build a bank of specific, honest stories and communicate your decisions clearly.',
    color: '#a165a9',
    lessons: [
      lesson('introduction', 'Make your experience concrete', 'Storytelling', 'Replace general claims with a specific moment, decision, and outcome.', [
        { title: 'Choose a real example', body: 'Select a situation where your actions affected the outcome. A smaller example you can explain deeply is stronger than a vague large project.' },
        { title: 'Use STAR as a map', body: 'Situation and task give context. Action explains what you personally did. Result describes what changed and what you learned.' },
        { title: 'Leave room for follow-ups', body: 'Begin with a concise two-minute version. Keep details about alternatives, disagreements, and measurements ready for deeper questions.' },
      ], 'Write a story about resolving ambiguity. Separate your actions from the actions of the team.'),
      lesson('conflict', 'Disagreement without blame', 'Common situations', 'Show how you evaluate another perspective and move the work forward.', [
        { title: 'State both perspectives fairly', body: 'A disagreement is rarely proof that one person was unreasonable. Explain the goals and constraints that shaped each position.' },
        { title: 'Show the decision process', body: 'Use evidence, a reversible experiment, or a shared success criterion to resolve the disagreement.' },
        { title: 'Reflect on the relationship', body: 'Explain how you maintained trust and what you would change next time.' },
      ], 'Describe a technical disagreement and the evidence that changed the decision.'),
      lesson('leadership', 'Leading beyond your own work', 'Growth', 'Make your influence visible without overstating ownership.', [
        { title: 'Describe the gap', body: 'Identify a team problem that was not being solved. Explain why addressing it mattered and who needed to be involved.' },
        { title: 'Enable others', body: 'Leadership can be a clear proposal, better documentation, mentoring, or coordination. Distinguish enabling the team from doing every task yourself.' },
        { title: 'Measure the effect', body: 'Use an honest indicator: fewer incidents, shorter lead time, or improved onboarding. Be clear about uncertainty in attribution.' },
      ], 'Build a story about improving how a team works.', true),
      lesson('failure', 'Learning from a setback', 'Common situations', 'Own your part, explain the recovery, and show a concrete change.', [
        { title: 'Avoid a disguised success story', body: 'Choose a meaningful setback. State your responsibility without exaggerating or shifting blame.' },
        { title: 'Separate recovery from prevention', body: 'Explain the immediate response, then the systemic change that reduced the chance of recurrence.' },
      ], 'Describe a project that missed its goal and one process you changed afterward.'),
    ],
  },
  {
    id: 'ai-coding', title: 'AI-Assisted Coding', short: 'Stay in control of the solution',
    description: 'Plan, inspect, and verify code produced with an assistant.',
    color: '#6a69b6',
    lessons: [
      lesson('introduction', 'You own the result', 'Foundations', 'Use an assistant to accelerate implementation, not to outsource judgment.', [
        { title: 'Orient before prompting', body: 'Inspect the project structure, conventions, entry points, and tests. Identify the smallest area that must change.' },
        { title: 'Give a bounded task', body: 'Specify desired behavior, constraints, relevant files, and acceptance tests. A precise request is easier to verify than a broad rewrite.' },
        { title: 'Review before accepting', body: 'Read the diff. Check error paths, data handling, and unintended behavior changes. Run the tests that measure the actual requirement.' },
      ], 'Write a bounded request for adding cursor pagination to an existing endpoint.'),
      lesson('verification', 'Verification beats confidence', 'Engineering workflow', 'Check the output, not how plausible the explanation sounds.', [
        { title: 'Reproduce first', body: 'Create a small failing case for the reported issue. Keep it unchanged while evaluating the fix.' },
        { title: 'Check the boundaries', body: 'Include empty inputs, duplicate values, malformed data, and concurrency when relevant.' },
        { title: 'Preserve the contract', body: 'New behavior should not silently remove old guarantees. Review callers and tests that depend on the interface.' },
      ], 'Create a test plan for an assistant-generated caching change.'),
      lesson('codebase-navigation', 'Navigate an unfamiliar codebase', 'Engineering workflow', 'Trace one user action from interface to persistence.', [
        { title: 'Follow the execution path', body: 'Find the entry point, request handler, domain operation, and data access. Read the tests around this path.' },
        { title: 'Reuse local patterns', body: 'Search for existing validation, error responses, and helpers before introducing another mechanism.' },
      ], 'Outline how you would investigate a task that disappears after a page refresh.', true),
    ],
  },
  {
    id: 'ml-system-design', title: 'ML System Design', short: 'Connect models to real products',
    description: 'Design the data, evaluation, and serving system around a useful model.',
    color: '#4c869a',
    lessons: [
      lesson('introduction', 'Start with the product metric', 'Foundations', 'A model score matters only when it improves the user outcome.', [
        { title: 'Define success and guardrails', body: 'Choose a product metric such as useful recommendations, and guardrails such as latency, coverage, and harmful outcomes.' },
        { title: 'Build a baseline', body: 'A simple heuristic provides a comparison point. Understand its failure modes before adding a more complex model.' },
        { title: 'Close the feedback loop', body: 'Record which predictions users saw and the later outcomes. This supports evaluation and future training.' },
      ], 'Design a baseline recommendation system for a technical reading app.'),
      lesson('feature-engineering', 'Features and leakage', 'Core concepts', 'Use only information that will exist at prediction time.', [
        { title: 'Define a prediction timestamp', body: 'Features must be available before the decision. Future outcomes accidentally included in training can make offline performance meaningless.' },
        { title: 'Keep training and serving aligned', body: 'Share transformations or validate equivalent outputs. Monitor missing values and feature distribution changes.' },
      ], 'Identify a leaking feature in a model that predicts whether a user will cancel a subscription.'),
      lesson('evaluation', 'Offline and online evaluation', 'Core concepts', 'Measure whether a model generalizes and whether the product improves.', [
        { title: 'Choose a meaningful split', body: 'Use a temporal or entity-aware split when random splitting would leak related examples across training and evaluation.' },
        { title: 'Look beyond averages', body: 'Evaluate important user groups and rare failures. A high overall score can hide poor performance for a smaller population.' },
        { title: 'Experiment carefully', body: 'Online tests need stable assignment, guardrails, and sufficient duration. Monitor operational behavior as well as product outcomes.' },
      ], 'Choose offline metrics and online guardrails for a spam detector.'),
      lesson('embeddings', 'Embedding retrieval', 'Serving', 'Find candidates efficiently, then rank them for the task.', [
        { title: 'Separate retrieval from ranking', body: 'Approximate nearest-neighbor search reduces millions of candidates to a manageable set. A more expensive ranker can then compare that set.' },
        { title: 'Version the representation', body: 'Mixing embeddings from incompatible model versions can damage relevance. Plan index updates and a rollback path.' },
      ], 'Design an embedding index refresh for newly published documents.', true),
    ],
  },
  {
    id: 'salary-negotiation', title: 'Salary Negotiation', short: 'Prepare for the offer conversation',
    description: 'Understand compensation, compare offers, and make a clear, professional ask.',
    color: '#a28a48',
    lessons: [
      lesson('introduction', 'Prepare before the offer', 'Negotiation', 'Know your priorities and what information you still need.', [
        { title: 'Compare the whole package', body: 'Base salary, bonus, equity, benefits, role scope, and location all affect an offer. Separate guaranteed compensation from uncertain future value.' },
        { title: 'Know your alternatives', body: 'Your decision should reflect genuine alternatives and priorities. Do not invent competing offers or misrepresent deadlines.' },
        { title: 'Keep the conversation collaborative', body: 'Express interest, ask clarifying questions, and make a specific request grounded in the responsibilities and market information you have.' },
      ], 'List three priorities for your next role and two questions about an equity grant.'),
      lesson('compensation', 'Understand equity and vesting', 'Compensation', 'Do not compare headline grant values without their assumptions.', [
        { title: 'Read the schedule', body: 'Check vesting frequency, cliffs, refresh policies, and what happens on departure. A four-year grant is not a yearly cash payment.' },
        { title: 'Separate liquid and illiquid value', body: 'Public shares, private options, and cash have different risks. Taxes and exercise costs can materially change the value.' },
      ], 'Compare two offers with different cash and equity mixes without assuming a future share price.'),
      lesson('counteroffer', 'Make a thoughtful counteroffer', 'Negotiation', 'Be specific, professional, and ready to explain your reasoning.', [
        { title: 'Confirm the details first', body: 'Get the full offer and understand its deadline. Resolve ambiguous terms before negotiating a headline number.' },
        { title: 'Prioritize one or two changes', body: 'A focused ask is easier to discuss. If base salary is constrained, ask whether another part of the package is flexible.' },
      ], 'Draft a short counteroffer that expresses interest and asks for a specific adjustment.'),
    ],
  },
];

export const companies = ['Meta', 'Google', 'Amazon', 'Microsoft', 'Apple', 'OpenAI', 'Anthropic', 'Stripe', 'Airbnb', 'Netflix'];
export const levels = ['Junior', 'Mid-level', 'Senior', 'Staff', 'Manager'] as const;
export const regions = ['Global', 'North America', 'Europe', 'Asia Pacific'] as const;
export const practiceTracks = ['system-design', 'low-level-design', 'ai-coding', 'behavioral', 'code-review'];
export const practiceLabels: Record<string, string> = {
  'system-design': 'System Design', 'low-level-design': 'Low-Level Design',
  'ai-coding': 'AI-Assisted Coding', behavioral: 'Behavioral', 'code-review': 'Code Review',
};

export const problems: Problem[] = [
  { id: 'short-links', track: 'system-design', title: 'A short-link service', difficulty: 'Easy', description: 'Design a service that creates short links and redirects visitors to the original destination.', requirements: ['Create a unique short identifier for a destination URL.', 'Redirect with low latency.', 'Handle expired and invalid links.', 'Prevent collisions and abusive destinations.'], keywords: [['api', 'endpoint', 'post'], ['database', 'storage', 'table'], ['cache', 'latency', 'redis'], ['collision', 'unique', 'hash'], ['rate limit', 'abuse', 'validate']] },
  { id: 'document-sync', track: 'system-design', title: 'Cloud document synchronization', difficulty: 'Easy', description: 'Keep a user’s documents synchronized across multiple devices, including offline changes.', requirements: ['Store document metadata and contents.', 'Upload and download changes efficiently.', 'Detect conflicting updates.', 'Retry failed transfers safely.'], keywords: [['metadata', 'version'], ['object storage', 'blob', 'chunk'], ['conflict', 'merge'], ['idempotent', 'retry'], ['notification', 'poll']] },
  { id: 'ticket-reservations', track: 'system-design', title: 'Event ticket reservations', difficulty: 'Medium', description: 'Design seat selection, temporary reservations, and purchase confirmation for popular events.', requirements: ['Search events and available seats.', 'Hold selected seats for a limited time.', 'Prevent double booking.', 'Recover from interrupted payment confirmation.'], keywords: [['search', 'index'], ['transaction', 'atomic', 'lock'], ['expire', 'ttl', 'reservation'], ['idempotent', 'payment'], ['queue', 'burst']] },
  { id: 'team-chat', track: 'system-design', title: 'A real-time team messenger', difficulty: 'Medium', description: 'Design direct and group messaging for distributed teams.', requirements: ['Deliver and persist messages.', 'Support reconnecting clients.', 'Maintain conversation order.', 'Provide unread counts and delivery status.'], keywords: [['websocket', 'connection'], ['sequence', 'order'], ['database', 'persist'], ['ack', 'delivery'], ['offline', 'reconnect']], premium: true },
  { id: 'activity-feed', track: 'system-design', title: 'A personalized activity feed', difficulty: 'Medium', description: 'Serve a chronological feed of updates from accounts a user follows.', requirements: ['Publish updates.', 'Read a paginated feed.', 'Handle accounts with many followers.', 'Enforce visibility permissions.'], keywords: [['fanout', 'fan-out'], ['cursor', 'pagination'], ['cache', 'timeline'], ['permission', 'privacy'], ['queue', 'async']] },
  { id: 'job-scheduler', track: 'system-design', title: 'A distributed job scheduler', difficulty: 'Hard', description: 'Execute scheduled jobs reliably across a fleet of workers.', requirements: ['Schedule one-off and recurring jobs.', 'Prevent simultaneous ownership.', 'Retry failed jobs.', 'Expose status and operational metrics.'], keywords: [['lease', 'lock', 'fencing'], ['idempotent', 'dedup'], ['retry', 'backoff'], ['queue', 'partition'], ['metric', 'monitor']], premium: true },
  { id: 'parcel-lockers', track: 'low-level-design', title: 'Parcel locker allocation', difficulty: 'Easy', description: 'Model lockers, packages, pickup codes, and expiration in a parcel collection system.', requirements: ['Assign a package to a compatible empty locker.', 'Generate a unique pickup code.', 'Release the locker after pickup.', 'Handle expired reservations.'], keywords: [['class', 'interface'], ['size', 'capacity'], ['state', 'available'], ['unique', 'code'], ['expire', 'clock']], starter: 'class Locker {\n  constructor(id, size) {\n    this.id = id;\n    this.size = size;\n    this.package = null;\n  }\n}\n\n// Design allocation and pickup operations here.\n' },
  { id: 'parking-garage', track: 'low-level-design', title: 'A parking garage', difficulty: 'Medium', description: 'Design space assignment, entry tickets, pricing, and checkout.', requirements: ['Support multiple vehicle sizes.', 'Allocate a compatible space.', 'Compute charges from parking duration.', 'Prevent overlapping reservations.'], keywords: [['class', 'interface'], ['strategy', 'policy'], ['ticket', 'duration'], ['lock', 'atomic'], ['test', 'error']] },
  { id: 'board-game', track: 'low-level-design', title: 'A turn-based board game', difficulty: 'Medium', description: 'Model players, legal moves, turns, and victory detection for a grid-based game.', requirements: ['Reject illegal moves.', 'Advance turns predictably.', 'Detect a winning state.', 'Allow replaying a move history.'], keywords: [['board', 'grid'], ['player', 'turn'], ['valid', 'illegal'], ['win', 'direction'], ['history', 'replay']] },
  { id: 'rate-limiter', track: 'low-level-design', title: 'A configurable rate limiter', difficulty: 'Hard', description: 'Implement a testable limiter with different policies and a controllable clock.', requirements: ['Define an explicit policy interface.', 'Return retry timing.', 'Handle concurrent callers.', 'Avoid unbounded memory growth.'], keywords: [['interface', 'strategy'], ['clock', 'time'], ['atomic', 'lock'], ['expire', 'cleanup'], ['retry', 'token']], premium: true },
  { id: 'conflict-story', track: 'behavioral', title: 'Navigate a technical disagreement', difficulty: 'Easy', description: 'Tell me about a time you disagreed with a technical decision. How did you resolve it?', requirements: ['Give a specific situation and your responsibility.', 'Explain both perspectives fairly.', 'Describe your personal actions.', 'Share the outcome and what you learned.'], keywords: [['situation', 'team', 'project'], ['task', 'responsible', 'goal'], ['i proposed', 'i measured', 'i built', 'i discussed'], ['result', 'improved', 'reduced', '%'], ['learned', 'next time', 'reflect']] },
  { id: 'leadership-story', track: 'behavioral', title: 'Influence without authority', difficulty: 'Medium', description: 'Describe a time you helped a team make progress without being its formal leader.', requirements: ['Identify the unmet need.', 'Describe who you brought together.', 'Explain your contribution.', 'Measure the impact and reflect.'], keywords: [['team', 'situation'], ['goal', 'task'], ['i', 'proposed', 'organized'], ['result', 'impact', '%'], ['learned', 'reflect']], premium: true },
  { id: 'setback-story', track: 'behavioral', title: 'Learn from a setback', difficulty: 'Medium', description: 'Tell me about a project that did not meet its goal. What did you do afterward?', requirements: ['Explain the original goal.', 'Own your role in the setback.', 'Describe the recovery.', 'Show a lasting improvement.'], keywords: [['goal', 'project'], ['i', 'responsibility'], ['recover', 'changed', 'fixed'], ['result', 'improved'], ['learned', 'next time']] },
  { id: 'mentoring-story', track: 'behavioral', title: 'Help someone grow', difficulty: 'Easy', description: 'Describe a time you helped a colleague learn something or become more effective.', requirements: ['Explain the colleague’s goal.', 'Describe how you identified their needs.', 'Share your concrete actions.', 'Reflect on the outcome.'], keywords: [['goal', 'colleague'], ['listen', 'need'], ['i', 'helped', 'paired'], ['result', 'improved'], ['learned', 'reflect']] },
  { id: 'priorities-story', track: 'behavioral', title: 'Choose between competing priorities', difficulty: 'Medium', description: 'Tell me about a time you had more important work than you could complete. How did you decide what to do?', requirements: ['Explain the competing goals.', 'Describe your prioritization criteria.', 'Show how you communicated the choice.', 'Share the outcome and reflection.'], keywords: [['goal', 'priority'], ['impact', 'risk'], ['communicate', 'stakeholder'], ['result', 'outcome'], ['learned', 'reflect']] },
  { id: 'task-board', track: 'ai-coding', title: 'Build a task-filtering helper', difficulty: 'Easy', description: 'Implement solve(input) to return the titles of incomplete tasks, sorted alphabetically. Input is an array of { title, completed } objects.', requirements: ['Exclude completed tasks.', 'Sort titles alphabetically.', 'Handle an empty input.', 'Keep the original input unchanged.'], keywords: [['filter'], ['sort'], ['map'], ['empty', 'test'], ['immutable', 'unchanged']], starter: 'function solve(input) {\n  // Return incomplete task titles in alphabetical order.\n  return [];\n}', testCases: [{input:[{title:'Write tests',completed:false},{title:'Deploy',completed:true},{title:'Add docs',completed:false}],expected:['Add docs','Write tests'],label:'Mixed tasks'}, {input:[],expected:[],label:'Empty input'}, {input:[{title:'Done',completed:true}],expected:[],label:'All completed'}] },
  { id: 'event-dedup', track: 'ai-coding', title: 'Deduplicate incoming events', difficulty: 'Medium', description: 'Implement solve(input) to keep the first event for each id, preserving input order.', requirements: ['Keep the earliest occurrence.', 'Preserve order.', 'Handle empty input.', 'Do not mutate the input.'], keywords: [['set', 'map'], ['order', 'first'], ['test', 'empty'], ['immutable', 'unchanged']], starter: 'function solve(input) {\n  return input;\n}', testCases: [{input:[{id:'a',value:1},{id:'a',value:2},{id:'b',value:3}],expected:[{id:'a',value:1},{id:'b',value:3}],label:'Duplicate IDs'}, {input:[],expected:[],label:'Empty input'}, {input:[{id:'x',value:4},{id:'y',value:5}],expected:[{id:'x',value:4},{id:'y',value:5}],label:'Distinct events'}] },
  { id: 'merge-intervals', track: 'ai-coding', title: 'Merge overlapping intervals', difficulty: 'Hard', description: 'Implement solve(input) to merge overlapping [start,end] intervals and return them in ascending order.', requirements: ['Handle unsorted input.', 'Merge nested and touching intervals.', 'Handle empty input.', 'Avoid modifying input.'], keywords: [['sort'], ['overlap', 'merge'], ['test', 'nested'], ['immutable', 'unchanged']], starter: 'function solve(input) {\n  return [];\n}', testCases: [{input:[[5,8],[1,3],[2,6]],expected:[[1,8]],label:'Overlapping intervals'}, {input:[],expected:[],label:'Empty input'}, {input:[[1,2],[2,4],[6,7]],expected:[[1,4],[6,7]],label:'Touching intervals'}], premium: true },
  { id: 'checkout-review', track: 'code-review', title: 'Review an order checkout', difficulty: 'Easy', description: 'Review the checkout function. Identify correctness and reliability problems, propose changes, and explain tests you would add.', requirements: ['Check input and authorization.', 'Consider money precision.', 'Identify retry and concurrency hazards.', 'Suggest focused tests.'], keywords: [['validate', 'input'], ['money', 'integer', 'precision'], ['idempotent', 'duplicate', 'retry'], ['transaction', 'atomic', 'concurrency'], ['test', 'error']], starter: 'async function checkout(user, cart, payment) {\n  const total = cart.reduce((sum, item) =>\n    sum + item.price * item.quantity, 0);\n  await payment.charge(user.card, total);\n  await saveOrder({ userId: user.id, cart, total });\n  return { success: true };\n}' },
  { id: 'cache-review', track: 'code-review', title: 'Review a profile cache', difficulty: 'Medium', description: 'Review this cache implementation for correctness, privacy, and resource use.', requirements: ['Inspect the cache key.', 'Consider concurrent requests.', 'Define expiration.', 'Handle backend failures explicitly.'], keywords: [['tenant', 'key', 'privacy'], ['expire', 'ttl'], ['coalesce', 'concurrent'], ['error', 'failure'], ['memory', 'bound']], starter: 'const cache = new Map();\nasync function getProfile(tenant, id) {\n  if (cache.has(id)) return cache.get(id);\n  const profile = await db.getProfile(tenant, id);\n  cache.set(id, profile);\n  return profile;\n}', premium: true },
  { id: 'upload-review', track: 'code-review', title: 'Review a file upload handler', difficulty: 'Hard', description: 'Inspect validation, storage boundaries, and failure handling in the upload handler.', requirements: ['Define acceptable input size.', 'Validate names and content.', 'Prevent overwriting unrelated files.', 'Report failure accurately.'], keywords: [['size', 'limit'], ['path', 'validate'], ['unique', 'overwrite'], ['error', 'failure'], ['test', 'content']], starter: 'async function upload(req) {\n  await storage.write(req.body.filename, req.body.data);\n  return { uploaded: true };\n}', premium: true },
];

export const quizQuestions: QuizQuestion[] = [
  {id:'api-1',topic:'api-design',prompt:'A client retries a create-payment request after a timeout. What best prevents a duplicate charge?',options:['A longer timeout','A durable idempotency key','A cache of recent GET requests','A random delay'],correct:1,explanation:'A durable idempotency key lets the server recognize the same operation and return its existing result.'},
  {id:'api-2',topic:'api-design',prompt:'Which pagination approach is usually most stable for a frequently growing timeline?',options:['Increasing offset only','A cursor based on a stable ordering key','Returning every result','Random page boundaries'],correct:1,explanation:'A cursor anchors traversal to an ordering position rather than the shifting number of preceding records.'},
  {id:'api-3',topic:'api-design',prompt:'Where should authorization be enforced?',options:['Only in the interface','At each server operation that accesses protected resources','Only when an account is created','Only on the first page load'],correct:1,explanation:'The server must check authorization for each protected operation; client-side restrictions are not a security boundary.'},
  {id:'cache-1',topic:'caching',prompt:'What is the source of truth in a cache-aside design?',options:['The cache','The browser','The backing datastore','Whichever response arrives first'],correct:2,explanation:'The backing datastore is authoritative. Cache entries are disposable copies with an explicit freshness policy.'},
  {id:'cache-2',topic:'caching',prompt:'Many requests refresh one expired hot key at once. What is this called?',options:['A cache stampede','A database migration','A network partition','A cursor collision'],correct:0,explanation:'A cache stampede is a synchronized burst of misses. Request coalescing and expiry jitter can mitigate it.'},
  {id:'cache-3',topic:'caching',prompt:'Which result normally needs the strictest freshness?',options:['An archived product photo','A public biography','A current permission check','An old release note'],correct:2,explanation:'Stale authorization data can expose protected information. Freshness needs follow the risk of the operation.'},
  {id:'data-1',topic:'data-modeling',prompt:'What is a cost of adding a database index?',options:['It always removes transactions','Extra storage and write work','Every read becomes slower','Primary keys become invalid'],correct:1,explanation:'Indexes must be stored and maintained as rows change, trading storage and write cost for faster access patterns.'},
  {id:'data-2',topic:'data-modeling',prompt:'Two writers must not reserve the same seat. Which mechanism is strongest?',options:['A client warning','A read followed by an unchecked write','A database invariant enforced atomically','An analytics event'],correct:2,explanation:'An atomic database operation or constraint protects the invariant under concurrent writers.'},
  {id:'data-3',topic:'data-modeling',prompt:'What should primarily guide an initial schema design?',options:['The longest table names','Access patterns and required invariants','The color of the dashboard','A random set of indexes'],correct:1,explanation:'The important reads, writes, and invariants determine useful keys, relationships, and constraints.'},
  {id:'queue-1',topic:'queues',prompt:'Why should a worker tolerate duplicate messages?',options:['Queues never acknowledge messages','Failure can happen after a side effect but before acknowledgment','Every message is always delivered twice','Retries are forbidden'],correct:1,explanation:'The side effect may succeed before a worker crashes. Deduplication or idempotent handling makes retry safe.'},
  {id:'queue-2',topic:'queues',prompt:'Which metric directly reveals a processing backlog that users will feel?',options:['Font size','Age of the oldest unprocessed job','Number of source files','A random sample identifier'],correct:1,explanation:'Oldest-message age measures how long work is waiting and exposes sustained lag.'},
  {id:'queue-3',topic:'queues',prompt:'What should happen to a job that repeatedly fails after bounded retries?',options:['Silently discard it','Retry in a tight loop forever','Move it to a dead-letter path with visibility','Mark it as successful'],correct:2,explanation:'A dead-letter path preserves failed work and gives operators an explicit recovery and inspection mechanism.'},
  {id:'pointer-1',topic:'two-pointers',prompt:'In a sorted array, the two-pointer sum is below the target. Which move is appropriate?',options:['Move the right pointer left','Move the left pointer right','Move both pointers randomly','Stop immediately'],correct:1,explanation:'Moving the left pointer toward a larger value can increase the sum; reducing the right value cannot help.'},
  {id:'pointer-2',topic:'two-pointers',prompt:'What is the search complexity for a sorted two-sum input?',options:['O(n²)','O(n) time and O(1) auxiliary space','O(2ⁿ)','O(1) time for every input'],correct:1,explanation:'Each pointer moves in one direction at most n times, and the algorithm stores only a few variables.'},
  {id:'pointer-3',topic:'two-pointers',prompt:'What does an invariant help you explain?',options:['Why eliminated candidates cannot be answers','Which font looks best','Why tests are unnecessary','Why sorting has no cost'],correct:0,explanation:'An invariant justifies each move and the correctness of eliminating part of the candidate space.'},
  {id:'object-1',topic:'design-principles',prompt:'What is a useful sign of high cohesion?',options:['A class owns unrelated concerns','Related responsibilities change together','Every method is static','There are no tests'],correct:1,explanation:'Cohesion groups behavior that belongs together and tends to evolve for the same reasons.'},
  {id:'object-2',topic:'design-principles',prompt:'Which dependency direction improves domain testability?',options:['Domain logic depends on a concrete remote service','Domain logic depends on a small contract implemented by adapters','All layers import each other','Tests always require production data'],correct:1,explanation:'A stable contract lets tests provide simple adapters and keeps infrastructure choices outside business rules.'},
  {id:'object-3',topic:'design-principles',prompt:'When is composition particularly helpful?',options:['When policies vary independently','When every class needs a deeper hierarchy','When all interfaces must be removed','When behavior should be hidden from tests'],correct:0,explanation:'Composed strategies allow independently varying policies without multiplying inheritance combinations.'},
  {id:'ml-1',topic:'evaluation',prompt:'Why can a random split be misleading for time-dependent data?',options:['It always removes labels','It can allow future or related information to leak into evaluation','It makes every model identical','It is impossible to implement'],correct:1,explanation:'A split must reflect the prediction setting. Temporal or entity-aware splits can prevent misleading leakage.'},
  {id:'ml-2',topic:'evaluation',prompt:'What is a useful online guardrail for a recommendation model?',options:['Only the training loss','Serving latency and harmful outcomes','Source file count','The number of model parameters alone'],correct:1,explanation:'A product experiment should monitor user and operational risks, not just an offline model score.'},
  {id:'ml-3',topic:'evaluation',prompt:'Which feature is valid at prediction time?',options:['A future cancellation event','An outcome only known next week','A prior activity count available at the decision timestamp','A later refund decision'],correct:2,explanation:'Valid features must exist when the prediction is made; future outcomes introduce leakage.'},
];

export const quizTopics = [...new Set(quizQuestions.map(q => q.topic))].map(id => {
  const track = tracks.find(t => t.lessons.some(l => l.id === id))!;
  const selected = track.lessons.find(l => l.id === id)!;
  return { id, title: selected.title, track: track.id, count: quizQuestions.filter(q => q.topic === id).length };
});

export function getTrack(id: string): Track | undefined {
  return tracks.find(t => t.id === id);
}
export function lessonKey(track: TrackId | string, id: string): string {
  return `${track}/${id}`;
}
