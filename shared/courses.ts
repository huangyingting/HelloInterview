import type { Course, CourseStep } from './types';
import { systemDesignLessons } from './content/system-design-lessons';
import { problems, quizTopics } from './catalog';

const reading = (track: string, id: string, title: string): CourseStep => ({ id: `${track}-${id}`, type: 'lesson', title, resource: `${track}/${id}`, to: `/learn/${track}/${id}` });
const quiz = (id: string, title: string): CourseStep => ({ id: `quiz-${id}`, type: 'quiz', title, resource: id, to: `/quiz/${id}` });
const practice = (track: string, id: string, title: string): CourseStep => ({ id: `practice-${id}`, type: 'practice', title, resource: id, to: `/practice/${track}/${id}` });
const video = (course: string, title: string): CourseStep => ({ id: `video-${course}`, type: 'video', title, resource: course, to: `/learn/courses/${course}/video/${course}` });

export const courses: Course[] = [
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
