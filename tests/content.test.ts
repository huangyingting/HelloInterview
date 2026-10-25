import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { problems, quizQuestions, quizTopics, tracks } from '../shared/catalog';
import { courses } from '../shared/courses';
import { contentResearchDate, contentSources, getContentSource } from '../shared/content/sources';
import { systemDesignQuestions } from '../shared/content/system-design-questions';
import { aiEngineeringLessons } from '../shared/content/ai-engineering-lessons';
import { aiEngineeringQuestions } from '../shared/content/ai-engineering-questions';
import { aiEngineeringCaseStudies } from '../shared/content/ai-engineering-cases';
import { problems as publicProblems, questionIndex, tracks as publicTracks } from '../shared/public-catalog';
import { gradeQuiz } from '../server/content/grading';
import { publishedQuestion, readQuestionSnapshot } from '../server/content/schema';

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
  assert.equal(tracks.reduce((count, track) => count + track.lessons.length, 0), 94);
  assert.equal(problems.length, 67);
  assert.equal(quizQuestions.length, 549);
  assert.equal(quizTopics.length, 62);
  assert.match(contentResearchDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('current README inventory matches the canonical curriculum and course copy distinguishes saved quizzes', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const row = (label: string) => readme.split('\n').find(line => line.startsWith(`| ${label} |`))!;
  const allLessons = tracks.flatMap(track => track.lessons);
  assert.match(row('Learning'), new RegExp(`${allLessons.length} original lessons`));
  assert.match(row('Learning'), new RegExp(`${publicTracks.flatMap(track => track.lessons).filter(lesson => lesson.activities?.lab).length} lessons with interactive labs`));
  assert.match(row('Courses'), new RegExp(`${courses.length} structured paths`));
  assert.match(row('Practice'), new RegExp(`${problems.length} original exercises`));
  assert.match(row('Quizzes'), new RegExp(`${quizTopics.length} topics and ${quizQuestions.length} questions`));
  assert.ok(!readme.includes('illustrative community entries'));
  for (const course of courses) {
    assert.doesNotMatch(course.description, /premium-demo|knowledge checks/);
  }
});

test('AI engineering adds a complete original path without replacing the existing ML resources', () => {
  const track = tracks.find(track => track.id === 'ml-system-design')!;
  assert.equal(track.lessons.length, 24);
  assert.deepEqual(track.lessons.slice(0, 4).map(lesson => lesson.id), ['introduction', 'feature-engineering', 'evaluation', 'embeddings']);
  assert.equal(track.lessons.find(lesson => lesson.id === 'embeddings')!.premium, true);
  assert.deepEqual(quizQuestions.filter(question => /^ml-\d$/.test(question.id)).map(question => ({ id: question.id, options: question.options, correct: question.correct })), [
    { id: 'ml-1', options: ['It always removes labels', 'It can allow future or related information to leak into evaluation', 'It makes every model identical', 'It is impossible to implement'], correct: 1 },
    { id: 'ml-2', options: ['Only the training loss', 'Serving latency and harmful outcomes', 'Source file count', 'The number of model parameters alone'], correct: 1 },
    { id: 'ml-3', options: ['A future cancellation event', 'An outcome only known next week', 'A prior activity count available at the decision timestamp', 'A later refund decision'], correct: 2 },
  ]);
  const course = courses.find(course => course.id === 'ai-engineering')!;
  const steps = course.units.flatMap(unit => unit.steps);
  assert.equal(course.track, track.id);
  assert.ok(!course.premium);
  assert.equal(steps.length, 18);
  assert.equal(new Set(steps.map(step => step.id)).size, 18);
  assert.equal(steps.filter(step => step.type === 'lesson').length, 8);
  assert.equal(steps.filter(step => step.type === 'quiz').length, 6);
  assert.equal(steps.filter(step => step.type === 'practice').length, 4);
  for (const lesson of aiEngineeringLessons) {
    assert.ok(!lesson.premium);
    assert.ok(steps.some(step => step.type === 'lesson' && step.resource === `${track.id}/${lesson.id}` && step.to === `/learn/${track.id}/${lesson.id}`));
  }
  for (const study of aiEngineeringCaseStudies) {
    assert.ok(problems.some(problem => problem.id === study.problemId && problem.track === track.id && problem.workedCase === study && !problem.premium));
    assert.ok(steps.some(step => step.type === 'practice' && step.resource === study.problemId && step.to === `/practice/${track.id}/${study.problemId}`));
  }
  assert.match(course.description, /not official company questions/);
  assert.match(getContentSource('ai-interview-topic-map')!.url, /f07f8f47d32004f29ead658b14382a27dc7cb2f4/);
});

test('AI lessons are substantive, sourced and linked to their own quizzes and worked exercises', () => {
  assert.equal(aiEngineeringLessons.length, 8);
  for (const lesson of aiEngineeringLessons) {
    const text = lesson.sections.flatMap(section => [section.body, ...(section.bullets ?? [])]).join(' ');
    assert.ok(words(text) >= 500, lesson.id);
    assert.ok(lesson.sections.length >= 4);
    assert.ok(lesson.sections.every(section => section.title && words(section.body) >= 60), lesson.id);
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.equal(lesson.minutes, Math.max(3, Math.ceil(words(text) / 200)));
    citations(lesson.sourceIds, 2);
    assert.ok(quizTopics.some(topic => topic.id === lesson.quizTopic && topic.track === 'ml-system-design'));
    assert.ok(lesson.relatedProblemIds?.length);
    for (const id of lesson.relatedProblemIds ?? []) assert.ok(aiEngineeringCaseStudies.some(study => study.problemId === id));
    assert.equal(tracks.flatMap(track => track.lessons).filter(candidate => candidate.id === lesson.id).length, 1, `${lesson.id} must be globally unambiguous`);
  }
});

test('AI knowledge checks have original prompts, balanced answer positions and canonical grading', () => {
  assert.equal(aiEngineeringQuestions.length, 24);
  assert.equal(new Set(aiEngineeringQuestions.map(question => normalized(question.prompt))).size, 24);
  for (const question of aiEngineeringQuestions) {
    assert.match(question.id, /^ai-eng-\d{3}$/);
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(normalized)).size, 4);
    assert.ok(words(question.explanation) >= 45, question.id);
    assert.ok(['Easy', 'Medium', 'Hard'].includes(question.difficulty!));
    citations(question.sourceIds, 2);
  }
  const topics = [...new Set(aiEngineeringQuestions.map(question => question.topic))];
  assert.equal(topics.length, 6);
  for (const id of topics) {
    const pool = aiEngineeringQuestions.filter(question => question.topic === id);
    assert.equal(pool.length, 4);
    assert.deepEqual(pool.map(question => question.correct), [0, 1, 2, 3]);
    assert.equal(quizTopics.find(topic => topic.id === id)!.count, 4);
    assert.ok(courses.find(course => course.id === 'ai-engineering')!.units.some(unit => unit.steps.some(step => step.type === 'quiz' && step.resource === id)));
    assert.deepEqual(gradeQuiz(id, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: 4, total: 4, missed: [] });
    assert.equal(gradeQuiz(id, Object.fromEntries(pool.map(question => [question.id, (question.correct + 1) % 4]))).score, 0);
  }
});

test('AI case studies provide detailed decisions, valid local links and independently checked arithmetic', () => {
  assert.equal(aiEngineeringCaseStudies.length, 4);
  assert.equal(new Set(aiEngineeringCaseStudies.map(study => study.diagram)).size, 4);
  const expectedResults: Record<string, number[]> = {
    'ai-knowledge-assistant': [2400000, 14.7456, 1.39],
    'ai-support-agent': [3600, 288],
    'ai-inference-gateway': [0.75, 12, 16],
    'ai-document-review': [108000, 5, 162],
  };
  for (const study of aiEngineeringCaseStudies) {
    const text = [...study.sections.flatMap(section => [section.body, ...(section.bullets ?? [])]), ...study.followUps.map(item => item.answer)].join(' ');
    assert.ok(words(text) >= 750, study.problemId);
    assert.ok(study.assumptions.length >= 3);
    assert.ok(study.sections.length >= 4);
    assert.ok(study.diagram.includes('\n') && study.diagram.length > 80);
    assert.ok(study.followUps.length >= 3);
    assert.equal(new Set(study.followUps.map(item => item.question)).size, study.followUps.length);
    assert.ok(study.followUps.every(item => words(item.answer) >= 45));
    assert.ok(study.lessonIds.length >= 3);
    assert.ok(study.lessonIds.every(id => aiEngineeringLessons.some(lesson => lesson.id === id)));
    citations(study.sourceIds, 3);
    assert.deepEqual(study.calculations.map(calculation => calculation.result), expectedResults[study.problemId]);
    for (const calculation of study.calculations) {
      assert.ok(calculation.factors.length && calculation.factors.every(factor => Number.isFinite(factor) && factor > 0));
      assert.ok(Number.isFinite(calculation.divisor) && calculation.divisor > 0);
      const expected = calculation.factors.reduce((product, factor) => product * factor, 1) / calculation.divisor;
      assert.ok(Math.abs(expected - calculation.result) <= 0.010001, `${study.problemId}: ${calculation.label}`);
      assert.ok(calculation.unit.length >= 2 && words(calculation.assumption) >= 4);
    }
  }
});

test('dated AI citations are pinned into reports without redating existing research', () => {
  assert.equal(getContentSource('http-cache')!.researchDate, '2026-10-08');
  assert.equal(getContentSource('llm-evals')!.researchDate, '2026-10-23');
  assert.equal(getContentSource('does-not-exist'), undefined);
  const question = publishedQuestion(aiEngineeringQuestions[0]);
  assert.deepEqual(question.sources?.map(source => source.researchDate), ['2026-10-23', '2026-10-23']);
  const serialized = JSON.stringify([question]);
  const version = createHash('sha256').update(serialized).digest('hex');
  assert.deepEqual(readQuestionSnapshot(serialized, version), [question]);
  assert.throws(() => publishedQuestion({ ...question, sourceIds: ['does-not-exist'] }), /unknown source/);
  assert.equal(publishedQuestion(quizQuestions.find(question => question.id === 'api-1')!).sources![0].researchDate, '2026-10-08');
});

test('public AI discovery contains cross-links but not lesson bodies, rubric keywords or answer keys', () => {
  const track = publicTracks.find(track => track.id === 'ml-system-design')!;
  for (const lesson of aiEngineeringLessons) {
    const metadata = track.lessons.find(item => item.id === lesson.id)!;
    assert.ok(metadata && !Object.hasOwn(metadata, 'sections') && !Object.hasOwn(metadata, 'exercise'));
    assert.deepEqual(metadata.relatedProblemIds, lesson.relatedProblemIds);
  }
  for (const study of aiEngineeringCaseStudies) {
    const metadata = publicProblems.find(item => item.id === study.problemId)!;
    assert.ok(metadata.hasWorkedCase && !metadata.hasSolution && !metadata.runnable);
    assert.equal(metadata.calculationCount, study.calculations.length);
    assert.ok(!Object.hasOwn(metadata, 'workedCase') && !Object.hasOwn(metadata, 'keywords'));
  }
  for (const question of aiEngineeringQuestions) {
    assert.deepEqual(questionIndex.find(item => item.id === question.id), { id: question.id, topic: question.topic });
  }
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
