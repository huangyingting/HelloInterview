import assert from 'node:assert/strict';
import test from 'node:test';
import { problems, quizQuestions, quizTopics, tracks } from '../shared/catalog';
import { assessAnswer, courseCompletion, courseStepComplete, currentStreak, emptyState, gradeQuiz, hasPremium } from '../shared/domain';
import { courses } from '../shared/courses';

test('catalog has unique IDs, original lesson bodies and valid quizzes', () => {
  assert.equal(new Set(tracks.map(t => t.id)).size, tracks.length);
  assert.equal(new Set(problems.map(p => p.id)).size, problems.length);
  assert.equal(new Set(quizQuestions.map(q => q.id)).size, quizQuestions.length);
  for (const track of tracks) {
    assert.equal(new Set(track.lessons.map(l => l.id)).size, track.lessons.length);
    for (const lesson of track.lessons) {
      assert.ok(lesson.sections.length >= 2);
      assert.ok(lesson.exercise.length > 30);
    }
  }
  for (const q of quizQuestions) assert.ok(q.correct >= 0 && q.correct < q.options.length);
  assert.ok(quizTopics.every(t => t.count >= 3));
});
test('quiz scores are canonical and missing answers join review', () => {
  const result = gradeQuiz('api-design', { 'api-1': 1, 'api-2': 0, 'api-3': -1 });
  assert.deepEqual(result, { score: 1, total: 3, missed: ['api-2', 'api-3'] });
  assert.throws(() => gradeQuiz('api-design', { 'cache-1': 0 }), /belong/);
  assert.throws(() => gradeQuiz('api-design', { 'api-1': 99 }), /Invalid/);
  assert.throws(() => gradeQuiz('review', {}), /empty/);
});
test('review only grades the submitted known review questions', () => {
  assert.deepEqual(gradeQuiz('review', { 'cache-1': 2 }), { score: 1, total: 1, missed: [] });
});
test('streak handles today, yesterday, gaps, duplicates and year boundaries', () => {
  const now = new Date('2026-01-02T06:00:00Z');
  assert.equal(currentStreak(['2026-01-02', '2026-01-01', '2025-12-31'], now), 3);
  assert.equal(currentStreak(['2026-01-01', '2025-12-31', '2025-12-31'], now), 2);
  assert.equal(currentStreak(['2025-12-31'], now), 0);
  assert.equal(currentStreak([], now), 0);
});
test('premium access expires and lifetime does not', () => {
  const state = emptyState(), now = Date.parse('2026-10-08T00:00:00Z');
  assert.equal(hasPremium(state, now), false);
  state.plan = 'month';
  state.planExpiresAt = '2026-10-07T23:59:59Z';
  assert.equal(hasPremium(state, now), false);
  state.planExpiresAt = '2026-10-09T00:00:00Z';
  assert.equal(hasPremium(state, now), true);
  state.plan = 'lifetime'; state.planExpiresAt = null;
  assert.equal(hasPremium(state, now), true);
});
test('local feedback explicitly reports rubric source and bounded scores', () => {
  const problem = problems[0];
  const minimal = assessAnswer(problem, '');
  const detailed = assessAnswer(problem, `${problem.keywords.map(k => k[0]).join(' ')} ${'Explain the decision and trade-off. '.repeat(30)}`);
  assert.equal(minimal.source, 'rubric');
  assert.equal(minimal.score, 0);
  assert.ok(detailed.score > minimal.score && detailed.score <= 100);
  assert.match(detailed.summary, /not an AI/);
});
test('courses reference valid original lessons, quizzes, practice and unique media', () => {
  for (const course of courses) {
    const steps = course.units.flatMap(u => u.steps);
    assert.equal(new Set(steps.map(s => s.id)).size, steps.length);
    for (const step of steps) {
      if (step.type === 'lesson') assert.ok(tracks.some(t => t.lessons.some(l => `${t.id}/${l.id}` === step.resource)));
      if (step.type === 'quiz') assert.ok(quizTopics.some(t => t.id === step.resource));
      if (step.type === 'practice') assert.ok(problems.some(p => p.id === step.resource));
    }
  }
});
test('course completion requires all step types and completed rather than draft practice', () => {
  const course = courses.find(c => c.id === 'low-level-design')!, state = emptyState();
  assert.deepEqual(courseCompletion(course, state), { total: 6, complete: 0 });
  state.read = ['low-level-design/introduction', 'low-level-design/design-principles', 'low-level-design/state-machines'];
  state.watched = ['low-level-design'];
  state.quizzes = [{ id: 'quiz', topic: 'design-principles', answers: {}, score: 0, total: 3, completedAt: '2026-10-08' }];
  assert.deepEqual(courseCompletion(course, state), { total: 6, complete: 5 });
  assert.equal(courseStepComplete(course.units.at(-1)!.steps.at(-1)!, state), false);
});
