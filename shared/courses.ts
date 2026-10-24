import type { Course, CourseStep } from './types';
import { systemDesignLessons } from './content/system-design-lessons';
import { codingLessons } from './content/coding-lessons';
import { lowLevelDesignLessons } from './content/low-level-design-lessons';
import { aiEngineeringLessons } from './content/ai-engineering-lessons';
import { aiLabLessons } from './content/ai-lab-lessons';
import { dojoLessons } from './content/dojo-lessons';
import { problems, quizTopics } from './catalog';

const reading = (track: string, id: string, title: string): CourseStep => ({ id: `${track}-${id}`, type: 'lesson', title, resource: `${track}/${id}`, to: `/learn/${track}/${id}` });
const quiz = (id: string, title: string): CourseStep => ({ id: `quiz-${id}`, type: 'quiz', title, resource: id, to: `/quiz/${id}` });
const practice = (track: string, id: string, title: string): CourseStep => ({ id: `practice-${id}`, type: 'practice', title, resource: id, to: `/practice/${track}/${id}` });
const video = (course: string, title: string): CourseStep => ({ id: `video-${course}`, type: 'video', title, resource: course, to: `/learn/courses/${course}/video/${course}` });

export const courses: Course[] = [
  ...([
    { id: 'model-behavior', title: 'Model behavior: attention and decoding', description: 'Two original visual lessons, two knowledge checks, and an architecture exercise, with the existing LLM foundations as a bridge. Explore causal attention and sampling distributions locally. Topic-selected from the local LLM Dojo curriculum; no captured content or upstream runtime is imported.', lessons: ['attention-mechanics', 'decoding-controls'], bridge: 'llm-foundations', exercises: ['ai-knowledge-assistant'], sourceIds: ['dojo-topic-map', 'torch-attention', 'hf-generation'] },
    { id: 'inference-economics', title: 'Inference economics: memory and latency', description: 'Two original visual lessons, two knowledge checks, and a serving design exercise, connected to the existing inference lesson. Calculate KV payload and trace streaming latency without a GPU or provider account. Original Studio material, topic-selected from the local LLM Dojo curriculum.', lessons: ['kv-capacity', 'streaming-service-levels'], bridge: 'inference-serving', exercises: ['ai-inference-gateway'], sourceIds: ['dojo-topic-map', 'hf-kv-cache', 'sre-slos'] },
    { id: 'prompt-contracts', title: 'Prompt and context: evidence before actions', description: 'Two original visual lessons, two knowledge checks, and two existing runnable labs, connected to the AI safety lesson. Pack a context budget, trace proposal validation, and implement exact contracts. Original Studio material, topic-selected from the local LLM Dojo curriculum.', lessons: ['context-contracts', 'structured-proposals'], bridge: 'ai-safety', exercises: ['lab-context-packer', 'lab-tool-dispatch'], sourceIds: ['dojo-topic-map', 'structured-output-contracts', 'owasp-prompt-injection'] },
  ] satisfies { id: string; title: string; description: string; lessons: string[]; bridge: string; exercises: string[]; sourceIds: NonNullable<Course['sourceIds']> }[]).map(course => ({
    id: course.id, title: course.title, description: course.description, sourceIds: course.sourceIds, track: 'ml-system-design' as const,
    units: [
      { title: 'Explore the mechanism and check the contract', steps: course.lessons.flatMap(id => [
        reading('ml-system-design', id, dojoLessons.find(lesson => lesson.id === id)!.title),
        quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`),
      ]) },
      { title: 'Connect the visual model to product decisions', steps: [
        reading('ml-system-design', course.bridge, aiEngineeringLessons.find(lesson => lesson.id === course.bridge)!.title),
        ...course.exercises.map(id => practice('ml-system-design', id, problems.find(problem => problem.id === id)!.title)),
      ] },
    ],
  })),
  { id: 'ai-engineering', title: 'AI engineering: from evidence to reliable systems', description: 'Eight original lessons, six knowledge checks, and four worked architecture exercises. Build retrieval, bounded agents, inference, adaptation, and multimodal systems. Topic-informed by a public preparation catalog, not official company questions. No premium steps or live model access required.', track: 'ml-system-design', units: [
    { title: 'Establish the model, evidence, and quality contract', lessons: ['llm-foundations', 'rag-retrieval', 'llm-evaluation'], quizzes: ['llm-foundations', 'rag-retrieval', 'llm-evaluation'], exercises: ['ai-knowledge-assistant'] },
    { title: 'Give tools bounded authority', lessons: ['agent-workflows', 'ai-safety'], quizzes: ['agent-workflows'], exercises: ['ai-support-agent'] },
    { title: 'Operate within a measured serving budget', lessons: ['inference-serving'], quizzes: ['inference-serving'], exercises: ['ai-inference-gateway'] },
    { title: 'Adapt behavior and preserve multimodal evidence', lessons: ['model-adaptation', 'multimodal-systems'], quizzes: ['model-adaptation'], exercises: ['ai-document-review'] },
  ].map(unit => ({ title: unit.title, steps: [
    ...unit.lessons.map(id => reading('ml-system-design', id, aiEngineeringLessons.find(lesson => lesson.id === id)!.title)),
    ...unit.quizzes.map(id => quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`)),
    ...unit.exercises.map(id => practice('ml-system-design', id, problems.find(problem => problem.id === id)!.title)),
  ] })) },
  ...([
    { id: 'retrieval-engineering', title: 'Retrieval engineering: build, measure, improve', description: 'Three original lessons, two knowledge checks, and two runnable JavaScript labs. Follow the project-oriented progression of LLM Zoomcamp and Maxime Labonne\'s LLM Course through reproducible ingestion, evidence packing, and ranking experiments. No paid API or GPU required; independent Studio material, not upstream certification.', sourceIds: ['llm-course-roadmap', 'llm-zoomcamp', 'pgvector-search'], units: [
      { title: 'Prepare evidence and pack a bounded context', lessons: ['retrieval-ingestion', 'retrieval-ranking'], quizzes: ['retrieval-ranking'], exercises: ['lab-context-packer'] },
      { title: 'Measure the ranking before releasing it', lessons: ['retrieval-experiments'], quizzes: ['retrieval-experiments'], exercises: ['lab-retrieval-metrics'] },
    ] },
    { id: 'agent-engineering', title: 'Agent execution: tools, memory, recovery', description: 'Three original lessons, two knowledge checks, and two runnable JavaScript labs. Extend the Hugging Face Agents Course\'s tool-and-project progression with strict proposal checks, scoped memory, and recoverable operation histories. No paid API or GPU required; independent Studio material, not upstream certification.', sourceIds: ['hf-agents-course', 'mcp-tools', 'langgraph-persistence'], units: [
      { title: 'Define and validate the tool boundary', lessons: ['agent-tool-contracts'], quizzes: ['agent-tool-contracts'], exercises: ['lab-tool-dispatch'] },
      { title: 'Keep context useful and operations recoverable', lessons: ['agent-context-state', 'agent-recovery'], quizzes: ['agent-recovery'], exercises: ['lab-agent-reducer'] },
    ] },
  ] satisfies { id: string; title: string; description: string; sourceIds: NonNullable<Course['sourceIds']>; units: { title: string; lessons: string[]; quizzes: string[]; exercises: string[] }[] }[]).map(course => ({
    ...course, track: 'ml-system-design' as const,
    units: course.units.map(unit => ({ title: unit.title, steps: [
      ...unit.lessons.map(id => reading('ml-system-design', id, aiLabLessons.find(lesson => lesson.id === id)!.title)),
      ...unit.quizzes.map(id => quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`)),
      ...unit.exercises.map(id => practice('ml-system-design', id, problems.find(problem => problem.id === id)!.title)),
    ] })),
  })),
  { id: 'low-level-design-complete', title: 'Low-level design: the complete Studio path', description: '12 substantial lessons, eight knowledge checks, and eight original worked models. Four new JavaScript exercises complement four preserved open-ended briefs. Includes existing premium-demo concurrency and limiter steps; sequential references do not prove production concurrency.', track: 'low-level-design', units: [
    { title: 'Own the behavior and model the invariant', lessons: ['introduction','object-modeling','design-principles'], quizzes: ['object-modeling','design-principles'], exercises: ['parcel-lockers','parking-garage'] },
    { title: 'Make contracts and transitions observable', lessons: ['interfaces','state-machines','error-contracts'], quizzes: ['interfaces','state-machines','error-contracts'], exercises: ['board-game','lld-workflow-engine'] },
    { title: 'Coordinate ownership and bound resources', lessons: ['concurrency','collections','patterns'], quizzes: ['concurrency','collections'], exercises: ['rate-limiter','lld-lru-cache'] },
    { title: 'Persist, verify, and defend the design', lessons: ['persistence','testing-designs','design-walkthrough'], quizzes: ['testing-designs'], exercises: ['lld-inventory-ledger','lld-file-catalog'] },
  ].map(unit => ({ title: unit.title, steps: [
    ...unit.lessons.map(id => reading('low-level-design', id, lowLevelDesignLessons.find(lesson => lesson.id === id)!.title)),
    ...unit.quizzes.map(id => quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`)),
    ...unit.exercises.map(id => practice('low-level-design', id, problems.find(problem => problem.id === id)!.title)),
  ] })) },
  { id: 'coding-complete', title: 'Coding: the complete Studio path', description: '24 substantial lessons, 12 knowledge checks, and 24 runnable algorithm exercises with original reference solutions. JavaScript example runner; includes the existing premium-demo DP lesson, not a full online judge or video course.', track: 'code', units: [
    { title: 'Understand the contract and eliminate candidates', lessons: ['introduction', 'complexity', 'arrays-hashing', 'two-pointers'], quizzes: ['arrays-hashing', 'two-pointers'], exercises: ['alg-pair-load', 'alg-frequent-tags'] },
    { title: 'Maintain a changing range', lessons: ['sliding-window', 'prefix-sum', 'intervals', 'stacks'], quizzes: ['sliding-window', 'prefix-sum', 'stacks'], exercises: ['alg-window-budget', 'alg-prefix-queries', 'alg-merge-slots', 'alg-balanced-signals', 'alg-next-higher'] },
    { title: 'Navigate sequences, priorities, and trees', lessons: ['linked-lists', 'binary-search', 'heaps', 'trees'], quizzes: ['linked-lists', 'binary-search', 'heaps', 'trees'], exercises: ['alg-chain-reverse', 'alg-chain-cycle', 'alg-first-threshold', 'alg-peak-workload', 'alg-top-priorities', 'alg-tree-depth', 'alg-level-sums'] },
    { title: 'Reachability and dependencies', lessons: ['graph-search', 'graphs', 'topological-sort', 'union-find'], quizzes: ['graphs'], exercises: ['alg-network-route', 'alg-release-order', 'alg-cluster-count'] },
    { title: 'Explore and reuse smaller states', lessons: ['backtracking', 'dynamic-programming', 'dp-sequences', 'greedy'], quizzes: ['backtracking', 'dynamic-programming'], exercises: ['alg-subset-loads', 'alg-min-coins', 'alg-nondecreasing-route', 'alg-choose-slots'] },
    { title: 'Specialized representations and evidence', lessons: ['tries', 'matrices', 'bit-manipulation', 'testing-solutions'], quizzes: [], exercises: ['alg-prefix-directory', 'alg-island-count', 'alg-bit-count'] },
  ].map(unit => ({ title: unit.title, steps: [
    ...unit.lessons.map(id => reading('code', id, codingLessons.find(lesson => lesson.id === id)!.title)),
    ...unit.quizzes.map(id => quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`)),
    ...unit.exercises.map(id => practice('code', id, problems.find(problem => problem.id === id)!.title)),
  ] })) },
  { id: 'system-design-complete', title: 'System design: the complete Studio path', description: '24 substantial lessons, 12 knowledge checks, and 16 original design exercises with worked references. Source-informed text; includes premium-demo steps, not a new video library.', track: 'system-design', units: [
    { title: 'Frame a defensible contract', lessons: ['introduction', 'requirements', 'capacity-estimation', 'api-design'], quizzes: ['requirements', 'capacity-estimation', 'api-design'], cases: ['short-links'] },
    { title: 'Protect state and make reads efficient', lessons: ['data-modeling', 'transactions', 'caching', 'http-caching'], quizzes: ['data-modeling', 'caching'], cases: ['ticket-reservations', 'payment-ledger', 'document-sync'] },
    { title: 'Move work and distribute ownership', lessons: ['queues', 'event-streams', 'replication', 'sharding'], quizzes: ['queues', 'replication', 'sharding'], cases: ['job-scheduler', 'notification-platform', 'activity-feed'] },
    { title: 'Operate within a measured budget', lessons: ['load-balancing', 'rate-limiting', 'reliability', 'observability'], quizzes: ['reliability', 'observability'], cases: ['api-gateway', 'metrics-platform', 'webhook-delivery'] },
    { title: 'Build secure specialized paths', lessons: ['security', 'object-storage', 'search-indexing', 'realtime'], quizzes: ['security'], cases: ['object-storage', 'video-delivery', 'search-service', 'team-chat'] },
    { title: 'Evolve, recover, and defend the tradeoff', lessons: ['stream-processing', 'multi-region', 'migrations', 'tradeoffs'], quizzes: ['tradeoffs'], cases: ['collaborative-editor', 'location-matching'] },
  ].map(unit => ({ title: unit.title, steps: [
    ...unit.lessons.map(id => reading('system-design', id, systemDesignLessons.find(lesson => lesson.id === id)!.title)),
    ...unit.quizzes.map(id => quiz(id, `Check: ${quizTopics.find(topic => topic.id === id)!.title}`)),
    ...unit.cases.map(id => practice('system-design', id, problems.find(problem => problem.id === id)!.title)),
  ] })) },
  { id: 'system-design', title: 'A practical system design path', description: 'A structured journey from a single request to a defensible architecture. Read, watch, check, and practice.', track: 'system-design', units: [
    { title: 'Frame the problem', steps: [reading('system-design', 'introduction', 'A practical design interview'), video('system-design', 'Walk through one request')] },
    { title: 'Define the contract', steps: [reading('system-design', 'api-design', 'Designing useful APIs'), quiz('api-design', 'Check your API reasoning')] },
    { title: 'Make reads efficient', steps: [reading('system-design', 'caching', 'Caching without surprises'), quiz('caching', 'Check your freshness decisions')] },
    { title: 'Protect the state', steps: [reading('system-design', 'data-modeling', 'Data modeling and indexes'), quiz('data-modeling', 'Check the database invariants'), practice('system-design', 'short-links', 'Design a short-link service')] },
    { title: 'Separate slow work', steps: [reading('system-design', 'queues', 'Queues and asynchronous work'), quiz('queues', 'Check delivery and retries'), practice('system-design', 'activity-feed', 'Design an activity feed')] },
  ] },
  { id: 'low-level-design', title: 'Objects, contracts, and change', description: 'Build a small object model with explicit responsibilities and testable behavior.', track: 'low-level-design', units: [
    { title: 'Find the responsibilities', steps: [reading('low-level-design', 'introduction', 'From requirements to responsibilities'), video('low-level-design', 'A parcel reservation walkthrough')] },
    { title: 'Make the boundaries useful', steps: [reading('low-level-design', 'design-principles', 'Cohesion and dependency direction'), quiz('design-principles', 'Check your object design decisions')] },
    { title: 'Model the state', steps: [reading('low-level-design', 'state-machines', 'Explicit state transitions'), practice('low-level-design', 'parcel-lockers', 'Design a parcel locker allocator')] },
  ] },
  { id: 'behavioral', title: 'Experience into a clear conversation', description: 'Choose specific stories, explain your actions, and leave room for thoughtful follow-up questions.', track: 'behavioral', units: [
    { title: 'Tell one concrete story', steps: [reading('behavioral', 'introduction', 'Make your experience concrete'), video('behavioral', 'Situation, task, action, result')] },
    { title: 'Navigate a disagreement', steps: [reading('behavioral', 'conflict', 'Disagreement without blame'), practice('behavioral', 'conflict-story', 'Practice a technical disagreement')] },
    { title: 'Own a setback', steps: [reading('behavioral', 'failure', 'Learning from a setback'), practice('behavioral', 'setback-story', 'Practice a setback story')] },
  ] },
  { id: 'concurrency', title: 'Shared state, protected invariants', description: 'An original deep-dive course on competing operations, atomic updates, and visible failure handling.', track: 'low-level-design', premium: true, units: [
    { title: 'See the race', steps: [video('concurrency', 'Two requests, one resource'), reading('low-level-design', 'concurrency', 'Concurrency and shared state')] },
    { title: 'Protect the operation', steps: [reading('system-design', 'data-modeling', 'Data modeling and indexes'), practice('low-level-design', 'parking-garage', 'Design a parking reservation')] },
    { title: 'Make retries safe', steps: [reading('system-design', 'api-design', 'Designing useful APIs'), quiz('api-design', 'Check retry safety')] },
  ] },
];
