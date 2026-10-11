import assert from 'node:assert/strict';
import test from 'node:test';
import { problems, quizQuestions, quizTopics, tracks } from '../shared/catalog';
import { courses } from '../shared/courses';
import { contentResearchDate, contentSources } from '../shared/content/sources';
import { systemDesignQuestions } from '../shared/content/system-design-questions';
import { gradeQuiz } from '../server/content/grading';

const lessons = tracks.find(track => track.id === 'system-design')!.lessons;
const cases = problems.filter(problem => problem.track === 'system-design');
const topics = quizTopics.filter(topic => topic.track === 'system-design');
const questions = quizQuestions.filter(question => topics.some(topic => topic.id === question.topic));
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
function citations(ids: string[] | undefined, minimum = 1) {
  assert.ok(ids && ids.length >= minimum, 'Content needs public sources');
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.ok(Object.hasOwn(contentSources, id), `Unknown source: ${id}`);
    const source=Object.entries(contentSources).find(([key])=>key===id)?.[1];
    assert.ok(source);
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.ok(source.title && source.publisher);
  }
}

test('flagship inventory meets the exact promised scope without replacing other tracks', () => {
  assert.equal(lessons.length, 24);
  assert.equal(cases.length, 16);
  assert.equal(questions.length, 180);
  assert.equal(topics.length, 12);
  assert.equal(systemDesignQuestions.length, 168);
  assert.equal(tracks.length, 7);
  assert.equal(tracks.reduce((count, track) => count + track.lessons.length, 0), 74);
  assert.equal(problems.length, 59);
  assert.equal(quizQuestions.length, 443);
  assert.equal(quizTopics.length, 33);
  assert.match(contentResearchDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('every flagship lesson has substantive prose, valid objectives and usable next steps', () => {
  assert.equal(new Set(lessons.map(lesson => lesson.id)).size, 24);
  for (const lesson of lessons) {
    const text = lesson.sections.flatMap(section => [section.body, ...(section.bullets || [])]).join(' ');
    assert.ok(words(text) >= 500, `${lesson.id} falls below 500 instructional words`);
    assert.ok(lesson.sections.length >= 4);
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.ok(lesson.sections.every(section => section.title && words(section.body) >= 60));
    assert.equal(lesson.minutes, Math.max(3, Math.ceil(words(text) / 200)));
    citations(lesson.sourceIds, 2);
    assert.ok(topics.some(topic => topic.id === lesson.quizTopic));
    assert.ok(lesson.relatedProblemIds?.length);
    for (const id of lesson.relatedProblemIds) assert.ok(cases.some(problem => problem.id === id && problem.workedCase), `${lesson.id} links to missing case ${id}`);
  }
});

test('worked cases contain substantial original reasoning, complete references and detailed follow-ups', () => {
  assert.equal(new Set(cases.map(problem => problem.id)).size, 16);
  assert.equal(new Set(cases.map(problem => problem.workedCase?.diagram)).size, 16);
  for (const problem of cases) {
    const study = problem.workedCase;
    assert.ok(study, `${problem.id} needs a worked design`);
    assert.equal(study.problemId, problem.id);
    const text = [...study.sections.flatMap(section => [section.body, ...(section.bullets || [])]), ...study.followUps.map(followUp => followUp.answer)].join(' ');
    assert.ok(words(text) >= 750, `${problem.id} falls below 750 words excluding assumptions, metadata, code and diagrams`);
    assert.ok(study.assumptions.length >= 3);
    assert.ok(study.sections.length >= 4);
    assert.ok(study.diagram.includes('\n') && study.diagram.length > 80);
    assert.ok(study.followUps.length >= 3);
    assert.equal(new Set(study.followUps.map(followUp => followUp.question)).size, study.followUps.length);
    for (const followUp of study.followUps) assert.ok(words(followUp.answer) >= 45, `${problem.id} has a shallow follow-up`);
    assert.ok(study.lessonIds.length >= 3);
    for (const id of study.lessonIds) assert.ok(lessons.some(lesson => lesson.id === id), `${problem.id} links to missing lesson ${id}`);
    citations(study.sourceIds, 3);
  }
});

test('every case calculation has independently specified, correct arithmetic and explicit units', () => {
  for (const problem of cases) {
    const calculations = problem.workedCase!.calculations;
    assert.ok(calculations.length >= 2);
    assert.equal(new Set(calculations.map(calculation => calculation.label)).size, calculations.length);
    for (const calculation of calculations) {
      assert.ok(calculation.factors.length >= 1);
      assert.ok(calculation.factors.every(factor => Number.isFinite(factor) && factor > 0));
      assert.ok(Number.isFinite(calculation.divisor) && calculation.divisor > 0);
      assert.ok(Number.isFinite(calculation.result) && calculation.result > 0);
      const expected = calculation.factors.reduce((product, factor) => product * factor, 1) / calculation.divisor;
      assert.ok(Math.abs(expected - calculation.result) <= 0.010001, `${problem.id}: ${calculation.label}: ${calculation.result} != ${expected}`);
      assert.ok(calculation.unit.trim().length >= 2);
      assert.ok(words(calculation.assumption) >= 4, `${problem.id}: explain the numerical assumptions and unit conversion`);
    }
  }
});

test('the question bank has distinct prompts and choices, sourced explanations and useful difficulty coverage', () => {
  assert.equal(new Set(questions.map(question => question.id)).size, 180);
  assert.equal(new Set(questions.map(question => normalized(question.prompt))).size, 180);
  for (const question of questions) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(normalized)).size, 4, question.id);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
    assert.ok(words(question.explanation) >= 45, `${question.id} needs a substantive explanation`);
    assert.ok(['Easy', 'Medium', 'Hard'].includes(question.difficulty!));
    citations(question.sourceIds);
  }
  for (const topic of topics) {
    const pool = questions.filter(question => question.topic === topic.id);
    assert.equal(pool.length, 15, topic.id);
    assert.equal(topic.count, pool.length);
    assert.ok(lessons.some(lesson => lesson.id === topic.id));
    assert.ok(pool.filter(question => question.difficulty === 'Easy').length >= 2);
    assert.ok(pool.filter(question => question.difficulty === 'Hard').length >= 2);
    assert.deepEqual(gradeQuiz(topic.id, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: 15, total: 15, missed: [] });
  }
  assert.ok(systemDesignQuestions.every(question => question.id.startsWith('sd-')));
  for (let index = 0; index < 4; index++) assert.ok(systemDesignQuestions.filter(question => question.correct === index).length >= 25, `Correct answer position ${index} is underrepresented`);
});

test('legacy IDs and API answer shapes remain usable while the new course covers every flagship resource', () => {
  for (const id of ['introduction', 'api-design', 'caching', 'data-modeling', 'queues', 'replication', 'sharding']) assert.ok(lessons.some(lesson => lesson.id === id));
  for (const id of ['short-links', 'document-sync', 'ticket-reservations', 'team-chat', 'activity-feed', 'job-scheduler']) assert.ok(cases.some(problem => problem.id === id));
  for (const prefix of ['api', 'cache', 'data', 'queue', 'pointer', 'object', 'ml']) for (let index = 1; index <= 3; index++) assert.ok(quizQuestions.some(question => question.id === `${prefix}-${index}`));
  assert.deepEqual(quizQuestions.find(question => question.id === 'api-1')!.options, ['A longer timeout', 'A durable idempotency key', 'A cache of recent GET requests', 'A random delay']);
  assert.equal(quizQuestions.find(question => question.id === 'api-1')!.correct, 1);
  const course = courses.find(course => course.id === 'system-design-complete')!;
  const steps = course.units.flatMap(unit => unit.steps);
  assert.equal(steps.length, 52);
  assert.equal(new Set(steps.map(step => step.id)).size, 52);
  assert.equal(steps.filter(step => step.type === 'video').length, 0);
  for (const lesson of lessons) assert.ok(steps.some(step => step.type === 'lesson' && step.resource === `system-design/${lesson.id}`));
  for (const topic of topics) assert.ok(steps.some(step => step.type === 'quiz' && step.resource === topic.id));
  for (const problem of cases) assert.ok(steps.some(step => step.type === 'practice' && step.resource === problem.id));
  for (const id of ['system-design', 'low-level-design', 'behavioral', 'concurrency']) assert.ok(courses.some(course => course.id === id));
});
