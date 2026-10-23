import type { Lesson, Problem, QuizQuestion, Track, TrackId } from './types';
import { systemDesignLessons } from './content/system-design-lessons';
import { additionalSystemDesignProblems, systemDesignCaseStudies } from './content/system-design-cases';
import { systemDesignQuestions } from './content/system-design-questions';
import { codingLessons } from './content/coding-lessons';
import { codingProblems } from './content/coding-problems';
import { codingQuestions } from './content/coding-questions';
import { lowLevelDesignLessons } from './content/low-level-design-lessons';
import { additionalLowLevelDesignProblems, lowLevelDesignSolutions } from './content/low-level-design-cases';
import { lowLevelDesignQuestions } from './content/low-level-design-questions';
import { aiEngineeringLessons } from './content/ai-engineering-lessons';
import { aiEngineeringProblems, aiEngineeringCaseStudies } from './content/ai-engineering-cases';
import { aiEngineeringQuestions } from './content/ai-engineering-questions';
import { aiLabLessons } from './content/ai-lab-lessons';
import { aiLabProblems } from './content/ai-lab-problems';
import { aiLabQuestions } from './content/ai-lab-questions';

const lesson = (
  id: string, title: string, group: string, summary: string,
  sections: Lesson['sections'], exercise: string, premium = false,
): Lesson => ({ id, title, group, summary, sections, exercise, premium, minutes: 6 + sections.length * 2 });

export const tracks: Track[] = [
  {
    id: 'system-design', title: 'System Design', short: 'Build systems that scale',
    description: 'Turn an ambiguous problem into a clear, defensible architecture.',
    color: '#147d71',
    lessons: systemDesignLessons,
  },
  {
    id: 'code', title: 'Coding & Algorithms', short: 'See the pattern, solve the problem',
    description: 'Understand algorithms with interactive visualizations and executable practice.',
    color: '#5971c4',
    lessons: codingLessons,
  },
  {
    id: 'low-level-design', title: 'Low-Level Design', short: 'Make your code easy to change',
    description: 'Translate requirements into cohesive objects, contracts, and reliable code.',
    color: '#b37a4c',
    lessons: lowLevelDesignLessons,
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
    id: 'ml-system-design', title: 'ML & AI System Design', short: 'Connect models to reliable products',
    description: 'Design data, retrieval, bounded agents, evaluation, and serving around useful models.',
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
      ...aiEngineeringLessons,
      ...aiLabLessons,
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
export const practiceTracks = ['system-design', 'low-level-design', 'ml-system-design', 'ai-coding', 'behavioral', 'code-review', 'code'];
export const practiceLabels: Record<string, string> = {
  'system-design': 'System Design', 'low-level-design': 'Low-Level Design',
  'ml-system-design': 'AI System Design',
  'ai-coding': 'AI-Assisted Coding', behavioral: 'Behavioral', 'code-review': 'Code Review',
  code: 'Coding & Algorithms',
};

const originalProblems: Problem[] = [
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

const caseStudies = [...systemDesignCaseStudies, ...aiEngineeringCaseStudies];
export const problems: Problem[] = [...originalProblems, ...additionalSystemDesignProblems, ...codingProblems, ...additionalLowLevelDesignProblems, ...aiEngineeringProblems, ...aiLabProblems].map(problem => ({
  ...problem, workedCase: caseStudies.find(study => study.problemId === problem.id) ?? problem.workedCase,
  solution: lowLevelDesignSolutions[problem.id] ?? problem.solution,
}));

const originalQuizQuestions: QuizQuestion[] = [
  {id:'api-1',topic:'api-design',prompt:'A client retries a create-payment request after a timeout. What best prevents a duplicate charge?',options:['A longer timeout','A durable idempotency key','A cache of recent GET requests','A random delay'],correct:1,difficulty:'Easy',sourceIds:['stripe-idempotency'],explanation:'A durable idempotency key identifies the logical operation, allowing a retry to recover an existing outcome instead of creating a second charge. The server must associate it atomically with compatible parameters and durable state. A longer timeout or random delay changes timing, not identity. Key retention and the payment provider boundary limit the guarantee, so document both.'},
  {id:'api-2',topic:'api-design',prompt:'Which pagination approach is usually most stable for a frequently growing timeline?',options:['Increasing offset only','A cursor based on a stable ordering key','Returning every result','Random page boundaries'],correct:1,difficulty:'Easy',sourceIds:['pg-indexes'],explanation:'A cursor based on a stable ordering key anchors the next query to a position rather than to the shifting count of preceding records. Include a unique tie-breaker when timestamps can match. This avoids some offset-related duplication, but does not itself freeze a changing dataset. Specify snapshot or live traversal semantics and authorize the filters represented by the cursor.'},
  {id:'api-3',topic:'api-design',prompt:'Where should authorization be enforced?',options:['Only in the interface','At each server operation that accesses protected resources','Only when an account is created','Only on the first page load'],correct:1,difficulty:'Easy',sourceIds:['owasp-object-auth'],explanation:'Each protected server operation must verify that the authenticated actor may perform the requested action on the specific object. A hidden button and an unpredictable identifier do not enforce this rule. Rights may change after login, so an initial check is insufficient. Scope reads, updates, list results, and derived representations to the current authorization contract.'},
  {id:'cache-1',topic:'caching',prompt:'What is the source of truth in a cache-aside design?',options:['The cache','The browser','The backing datastore','Whichever response arrives first'],correct:2,difficulty:'Easy',sourceIds:['redis-eviction','http-cache'],explanation:'The backing datastore remains authoritative in a cache-aside design. A missing entry can be reconstructed from it, while cache entries are disposable copies governed by a freshness policy. The quickest response is not automatically the correct state. Define update invalidation, tenant-aware keys, expiry, and failure behavior so an optimization does not quietly become an independent source of truth.'},
  {id:'cache-2',topic:'caching',prompt:'Many requests refresh one expired hot key at once. What is this called?',options:['A cache stampede','A database migration','A network partition','A cursor collision'],correct:0,difficulty:'Easy',sourceIds:['sre-overload','redis-eviction'],explanation:'A cache stampede is a burst of refresh work when many callers encounter the same missing or expired entry. Request coalescing can reduce concurrent refreshes, and expiry jitter can reduce synchronized expiration across keys. Neither replaces backend admission limits during a cold start. Serving stale data is another possible mitigation only when the operation permits that freshness tradeoff.'},
  {id:'cache-3',topic:'caching',prompt:'Which result normally needs the strictest freshness?',options:['An archived product photo','A public biography','A current permission check','An old release note'],correct:2,difficulty:'Easy',sourceIds:['owasp-object-auth','http-cache'],explanation:'A stale permission decision can disclose protected information or allow a revoked action, making its freshness policy especially important. Public descriptive content can often tolerate more delay, but that depends on the product. Authorization caching needs a defined revocation boundary and failure policy; a generic long TTL is not justified merely because caching other reads improved performance.'},
  {id:'data-1',topic:'data-modeling',prompt:'What is a cost of adding a database index?',options:['It always removes transactions','Extra storage and write work','Every read becomes slower','Primary keys become invalid'],correct:1,difficulty:'Easy',sourceIds:['pg-indexes'],explanation:'An index stores another access structure and requires maintenance when relevant rows change. It can improve suitable lookups while consuming storage and adding write work. Its usefulness depends on predicates, ordering, cardinality, and the query planner, not simply its existence. Compare representative query plans and write costs before adding many overlapping indexes to the schema.'},
  {id:'data-2',topic:'data-modeling',prompt:'Two writers must not reserve the same seat. Which mechanism is strongest?',options:['A client warning','A read followed by an unchecked write','A database invariant enforced atomically','An analytics event'],correct:2,difficulty:'Easy',sourceIds:['pg-isolation'],explanation:'The check and ownership update must be protected as one authoritative operation, using appropriate constraints, conditional writes, locking, or transaction semantics. Two application reads can both observe availability before either unchecked write commits. Choose the invariant and concurrency mechanism together, then test competing writers. The client warning and analytics record can describe behavior but cannot prevent conflicting ownership.'},
  {id:'data-3',topic:'data-modeling',prompt:'What should primarily guide an initial schema design?',options:['The longest table names','Access patterns and required invariants','The color of the dashboard','A random set of indexes'],correct:1,difficulty:'Easy',sourceIds:['pg-indexes','pg-isolation'],explanation:'The expected reads, writes, and invariants reveal useful keys, relationships, constraints, and indexes. Start by tracing representative operations and identifying which state must change together. Then evaluate query plans and contention under those access patterns. Naming conventions can improve clarity, but they do not determine whether the schema supports the product contract or protects concurrent operations.'},
  {id:'queue-1',topic:'queues',prompt:'Why should a worker tolerate duplicate messages?',options:['Queues never acknowledge messages','Failure can happen after a side effect but before acknowledgment','Every message is always delivered twice','Retries are forbidden'],correct:1,difficulty:'Easy',sourceIds:['rabbitmq-acks','outbox'],explanation:'A worker can complete a business effect and crash before acknowledging consumption. The broker may then redeliver the message because it cannot infer that the effect completed. Use durable deduplication or an idempotent effect at the correct boundary. A publisher confirmation is different from a consumer acknowledgement, and neither alone proves that an arbitrary external operation happened exactly once.'},
  {id:'queue-2',topic:'queues',prompt:'Which metric directly reveals a processing backlog that users will feel?',options:['Font size','Age of the oldest unprocessed job','Number of source files','A random sample identifier'],correct:1,difficulty:'Easy',sourceIds:['sre-monitoring','sre-overload'],explanation:'Oldest-job age reveals how long pending work has been waiting, directly connecting backlog to delayed completion. Queue depth alone is less interpretable when job costs or worker throughput vary. Observe arrival rate, completion rate, retries, and processing latency alongside age. Also define whether delayed scheduled jobs belong in the metric so an intentional future schedule is not mistaken for overdue work.'},
  {id:'queue-3',topic:'queues',prompt:'What should happen to a job that repeatedly fails after bounded retries?',options:['Silently discard it','Retry in a tight loop forever','Move it to a dead-letter path with visibility','Mark it as successful'],correct:2,difficulty:'Easy',sourceIds:['rabbitmq-acks','sre-overload'],explanation:'A visible dead-letter path preserves repeatedly failing work for diagnosis and controlled recovery after the retry budget is exhausted. Record the operation identity and failure reason, restrict access to sensitive payloads, and alert on meaningful accumulation. Redriving work needs the same duplicate-safety contract as ordinary delivery. Moving a job aside is not equivalent to successfully completing its business effect.'},
  {id:'pointer-1',topic:'two-pointers',prompt:'In a sorted array, the two-pointer sum is below the target. Which move is appropriate?',options:['Move the right pointer left','Move the left pointer right','Move both pointers randomly','Stop immediately'],correct:1,difficulty:'Easy',sourceIds:['mit-algorithms','nist-algorithms'],explanation:'Moving the left pointer right can increase the sum because the array is sorted in nondecreasing order. For the current left value, every available right position is no larger than the current one, so none can reach a target above the current sum. The move eliminates an impossible family of candidates; it is not merely a guess based on a favorable example.'},
  {id:'pointer-2',topic:'two-pointers',prompt:'What is the search complexity for a sorted two-sum input?',options:['O(n²)','O(n) time and O(1) auxiliary space','O(2ⁿ)','O(1) time for every input'],correct:1,difficulty:'Easy',sourceIds:['mit-algorithms','nist-algorithms'],explanation:'The two pointers move inward without revisiting eliminated positions, so there are at most a linear number of advances. Searching an already-sorted array therefore uses O(n) time and constant auxiliary storage when returning one pair or its existence. This bound excludes any earlier sorting cost and does not apply to enumerating every pair, whose output can itself be quadratic.'},
  {id:'pointer-3',topic:'two-pointers',prompt:'What does an invariant help you explain?',options:['Why eliminated candidates cannot be answers','Which font looks best','Why tests are unnecessary','Why sorting has no cost'],correct:0,difficulty:'Easy',sourceIds:['mit-algorithms','nist-algorithms'],explanation:'An invariant states what remains true before and after each iteration. Together with the movement rule, it explains why a discarded candidate cannot be a required answer and why the remaining search still contains any valid solution. You also need initialization, termination, and the result contract. Passing a few examples supports debugging but does not replace that correctness argument or the complexity analysis.'},
  {id:'object-1',topic:'design-principles',prompt:'What is a useful sign of high cohesion?',options:['A class owns unrelated concerns','Related responsibilities change together','Every method is static','There are no tests'],correct:1,difficulty:'Easy',sourceIds:['fowler-tell','fowler-di'],explanation:'High cohesion groups behavior and data that participate in the same responsibility and tend to evolve for related reasons. That makes a meaningful change easier to localize and inspect. Evaluate concrete change scenarios rather than counting methods or assuming static functions solve ownership. A class can have several operations when they jointly protect one lifecycle and its invariants.'},
  {id:'object-2',topic:'design-principles',prompt:'Which dependency direction improves domain testability?',options:['Domain logic depends on a concrete remote service','Domain logic depends on a small contract implemented by adapters','All layers import each other','Tests always require production data'],correct:1,difficulty:'Easy',sourceIds:['fowler-di','fowler-unit'],explanation:'A domain-facing capability can describe the business observations and updates needed without requiring provider-specific construction or network access. Adapters implement that contract and can be supplied directly. A faithful test double supports deterministic domain tests, while integration tests still establish actual database or provider guarantees. A small interface does not eliminate coupling if its semantics remain unspecified.'},
  {id:'object-3',topic:'design-principles',prompt:'When is composition particularly helpful?',options:['When policies vary independently','When every class needs a deeper hierarchy','When all interfaces must be removed','When behavior should be hidden from tests'],correct:0,difficulty:'Easy',sourceIds:['fowler-di','js-classes'],explanation:'Composition allows independently varying policies to be supplied without multiplying inheritance combinations. For example, a session owner can use a pricing function while retaining its own lifecycle checks. The collaborator still needs a defined contract for inputs, units, results, and failures. Use this boundary for a demonstrated variation rather than building machinery for every hypothetical future change.'},
  {id:'ml-1',topic:'evaluation',prompt:'Why can a random split be misleading for time-dependent data?',options:['It always removes labels','It can allow future or related information to leak into evaluation','It makes every model identical','It is impossible to implement'],correct:1,explanation:'A split must reflect the prediction setting. Temporal or entity-aware splits can prevent misleading leakage.'},
  {id:'ml-2',topic:'evaluation',prompt:'What is a useful online guardrail for a recommendation model?',options:['Only the training loss','Serving latency and harmful outcomes','Source file count','The number of model parameters alone'],correct:1,explanation:'A product experiment should monitor user and operational risks, not just an offline model score.'},
  {id:'ml-3',topic:'evaluation',prompt:'Which feature is valid at prediction time?',options:['A future cancellation event','An outcome only known next week','A prior activity count available at the decision timestamp','A later refund decision'],correct:2,explanation:'Valid features must exist when the prediction is made; future outcomes introduce leakage.'},
];

export const quizQuestions: QuizQuestion[] = [...originalQuizQuestions, ...systemDesignQuestions, ...codingQuestions, ...lowLevelDesignQuestions, ...aiEngineeringQuestions, ...aiLabQuestions];

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
