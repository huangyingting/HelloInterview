import type { Course, CourseStep } from './types';

const reading = (track: string, id: string, title: string): CourseStep => ({ id: `${track}-${id}`, type: 'lesson', title, resource: `${track}/${id}`, to: `/learn/${track}/${id}` });
const quiz = (id: string, title: string): CourseStep => ({ id: `quiz-${id}`, type: 'quiz', title, resource: id, to: `/quiz/${id}` });
const practice = (track: string, id: string, title: string): CourseStep => ({ id: `practice-${id}`, type: 'practice', title, resource: id, to: `/practice/${track}/${id}` });
const video = (course: string, title: string): CourseStep => ({ id: `video-${course}`, type: 'video', title, resource: course, to: `/learn/courses/${course}/video/${course}` });

export const courses: Course[] = [
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
