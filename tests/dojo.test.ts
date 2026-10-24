import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dojoLessons } from '../shared/content/dojo-lessons';
import { dojoQuestions } from '../shared/content/dojo-questions';
import { contentSources } from '../shared/content/sources';
import { courses } from '../shared/courses';
import { problems, quizTopics, tracks } from '../shared/catalog';
import { tracks as publicTracks } from '../shared/public-tracks';
import { courses as publicCourses } from '../shared/public-courses';
import { gradeQuiz } from '../server/content/grading';
import { causalAttention, contextBudget, kvCacheBytes, samplingDistribution, softmax, streamMetrics } from '../shared/ai-visuals';
import { LearningFlow } from '../src/components/LearningFlow';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const words = (value: string) => value.trim().split(/\s+/).length;
test('three independent Dojo-topic paths connect native lessons, checks, existing practice and visible provenance', () => {
  assert.equal(dojoLessons.length, 6);
  const topics = dojoLessons.map(lesson => lesson.id);
  assert.deepEqual(dojoLessons.flatMap(lesson => lesson.sections.flatMap(section => section.visualization ?? [])), ['attention', 'sampling', 'kv-cache', 'streaming', 'context-budget']);
  for (const [id, count] of [['model-behavior', 6], ['inference-economics', 6], ['prompt-contracts', 7]] as const) {
    const course = courses.find(course => course.id === id)!;
    const steps = course.units.flatMap(unit => unit.steps);
    assert.equal(steps.length, count);
    assert.equal(new Set(steps.map(step => step.id)).size, count);
    assert.equal(steps.filter(step => step.type === 'lesson').length, 3);
    assert.equal(steps.filter(step => step.type === 'quiz').length, 2);
    assert.equal(course.track, 'ml-system-design');
    assert.ok(!course.premium && course.sourceIds?.includes('dojo-topic-map'));
    assert.deepEqual(publicCourses.find(item => item.id === id), course);
    for (const step of steps) {
      if (step.type === 'lesson') assert.ok(tracks.flatMap(track => track.lessons.map(lesson => ({ track, lesson }))).some(({ track, lesson }) => `${track.id}/${lesson.id}` === step.resource && !lesson.premium));
      if (step.type === 'practice') assert.ok(problems.some(problem => problem.id === step.resource && !problem.premium));
    }
  }
  assert.match(contentSources['dojo-topic-map'].url, /3e9e39a6655962e18a99de2e2b6e8497841bcef4$/);
  for (const lesson of dojoLessons) {
    const text = lesson.sections.map(section => section.body).join(' ');
    assert.ok(words(text) >= 500, lesson.id);
    assert.equal(lesson.minutes, Math.max(3, Math.ceil(words(text) / 200)));
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.equal(tracks.flatMap(track => track.lessons).filter(item => item.id === lesson.id).length, 1);
    assert.ok(lesson.relatedProblemIds?.every(id => problems.some(problem => problem.id === id)));
    assert.equal(lesson.sections.filter(section => section.flow).length, 1);
    for (const id of lesson.sourceIds ?? []) assert.ok(Object.hasOwn(contentSources, id));
    const publicLesson = publicTracks.find(track => track.id === 'ml-system-design')!.lessons.find(item => item.id === lesson.id)!;
    assert.ok(publicLesson && !Object.hasOwn(publicLesson, 'sections') && !Object.hasOwn(publicLesson, 'exercise'));
  }
  assert.equal(dojoQuestions.length, 24);
  assert.equal(new Set(dojoQuestions.map(question => question.prompt)).size, 24);
  for (const topic of topics) {
    const pool = dojoQuestions.filter(question => question.topic === topic);
    assert.deepEqual(pool.map(question => question.correct), [0, 1, 2, 3]);
    assert.equal(quizTopics.find(item => item.id === topic)!.count, 4);
    assert.deepEqual(gradeQuiz(topic, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: 4, total: 4, missed: [] });
    for (const question of pool) {
      assert.ok(words(question.explanation) >= 45);
      assert.equal(new Set(question.options).size, 4);
      assert.ok(question.sourceIds?.length && question.sourceIds.every(id => Object.hasOwn(contentSources, id)));
    }
  }
});

test('authored flow diagrams are bounded, connected sequences with safe text and a complete accessible alternative', () => {
  for (const lesson of dojoLessons) for (const section of lesson.sections) if (section.flow) {
    const flow = section.flow;
    assert.equal(flow.steps.length, 4);
    assert.equal(new Set(flow.steps.map(step => step.id)).size, 4);
    assert.ok(flow.steps.every(step => step.title.length <= 24 && words(step.detail) >= 10));
    const html = renderToStaticMarkup(createElement(LearningFlow, { flow }));
    assert.match(html, /role="img"/);
    assert.match(html, /aria-current="step"/);
    for (const step of flow.steps) assert.ok(html.includes(step.title));
    assert.ok(html.includes(flow.steps[0].detail.replaceAll('&', '&amp;')));
  }
  const html = renderToStaticMarkup(createElement(LearningFlow, { flow: {
    title: '<script>alert(1)</script>', summary: 'Plain text, never injected SVG.',
    steps: [{ id: 'plain', title: '<img src=x>', detail: 'The renderer treats titles and descriptions as text.' }],
  } }));
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x>'));
});

test('causal attention matches independently normalized prefixes and ignores every future score', () => {
  const scores = [[1, 100, 200], [Math.log(2), Math.log(3), 999], [0, Math.log(2), Math.log(3)]];
  const before = JSON.stringify(scores), rows = causalAttention(scores);
  assert.deepEqual(rows[0], [1, 0, 0]);
  close(rows[1][0], 2 / 5); close(rows[1][1], 3 / 5); assert.equal(rows[1][2], 0);
  rows[2].forEach((value, index) => close(value, [1 / 6, 2 / 6, 3 / 6][index]));
  assert.equal(JSON.stringify(scores), before);
  for (let size = 1; size <= 8; size++) {
    const matrix = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => ((row * 7 + column * 3) % 9) - 4));
    const actual = causalAttention(matrix);
    const changed = matrix.map((row, query) => row.map((value, key) => key > query ? 1e300 : value));
    assert.deepEqual(causalAttention(changed), actual);
    actual.forEach((row, query) => {
      close(row.reduce((sum, value) => sum + value, 0), 1);
      const denominator = matrix[query].slice(0, query + 1).reduce((sum, value) => sum + Math.exp(value), 0);
      row.forEach((value, key) => close(value, key <= query ? Math.exp(matrix[query][key]) / denominator : 0));
    });
  }
});

test('decoding uses stable normalization and a declared top-k then nucleus prefix with deterministic ties', () => {
  const input = [Math.log(4), Math.log(2), 0];
  const result = samplingDistribution(input, 1, 3, 1);
  result.after.forEach((value, index) => close(value, [4 / 7, 2 / 7, 1 / 7][index]));
  assert.deepEqual(samplingDistribution(input, 1, 2, 0.6).after, [1, 0, 0]);
  assert.deepEqual(samplingDistribution([1, 1, 1, 1], 1, 3, 0.5).after, [0.5, 0.5, 0, 0]);
  assert.deepEqual(softmax([10000, 10000]), [0.5, 0.5]);
  close(softmax([1, 2])[0], softmax([1001, 1002])[0]);
  for (const temperature of [0.05, 0.1, 0.5, 1, 2, 5]) for (let k = 1; k <= 3; k++) for (const p of [0.01, 0.25, 0.6, 0.9, 1]) {
    const { before, after } = samplingDistribution(input, temperature, k, p);
    close(before.reduce((sum, value) => sum + value, 0), 1);
    close(after.reduce((sum, value) => sum + value, 0), 1);
    assert.ok(after.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    const count = after.filter(value => value > 0).length;
    assert.ok(count >= 1 && count <= k);
    const shortlistMass = before.slice(0, k).reduce((sum, value) => sum + value, 0);
    const selectedMass = before.slice(0, count).reduce((sum, value) => sum + value, 0) / shortlistMass;
    assert.ok(selectedMass >= p - 1e-12);
    if (count > 1) assert.ok(before.slice(0, count - 1).reduce((sum, value) => sum + value, 0) / shortlistMass < p);
    if (k === 1) assert.deepEqual(after, [1, 0, 0]);
  }
});

test('KV units, concurrency and precision match independent binary byte counts', () => {
  const shape = { layers: 32, kvHeads: 8, headDimension: 128, tokens: 4096, sequences: 1, bytesPerElement: 2 };
  assert.equal(kvCacheBytes(shape), 536870912);
  assert.equal(kvCacheBytes(shape) / 2 ** 30, 0.5);
  assert.equal(kvCacheBytes({ ...shape, tokens: 8192, sequences: 2 }), 2147483648);
  assert.equal(kvCacheBytes({ ...shape, kvHeads: 1 }), 67108864);
  assert.equal(kvCacheBytes({ ...shape, bytesPerElement: 1 }), 268435456);
  for (const layers of [1, 4, 32]) for (const heads of [1, 8, 32]) for (const sequences of [1, 3]) {
    let elements = 0;
    for (let layer = 0; layer < layers; layer++) for (let head = 0; head < heads; head++) elements += 2 * 128 * 1024 * sequences;
    assert.equal(kvCacheBytes({ ...shape, layers, kvHeads: heads, tokens: 1024, sequences }), elements * 2);
  }
});

test('stream timelines include first token once and handle exact deadlines without inventing quality', () => {
  assert.deepEqual(streamMetrics(100, 400, 40, 50, 2460), { firstToken: 500, decode: 1960, total: 2460, meetsDeadline: true });
  assert.equal(streamMetrics(100, 400, 40, 50, 2459).meetsDeadline, false);
  assert.deepEqual(streamMetrics(100, 400, 40, 1, 500), { firstToken: 500, decode: 0, total: 500, meetsDeadline: true });
  for (let tokens = 1; tokens <= 100; tokens++) {
    const arrivals = Array.from({ length: tokens }, (_, index) => 35 + 77 + index * 13);
    assert.equal(streamMetrics(35, 77, 13, tokens, 10000).total, arrivals.at(-1));
  }
});

test('context packing uses reserved capacity, skips ineligible and oversized items and exposes overcommit', () => {
  const items = [{ id: 'a', tokens: 900, eligible: true }, { id: 'b', tokens: 300, eligible: false }, { id: 'c', tokens: 800, eligible: true }, { id: 'd', tokens: 250, eligible: true }];
  assert.deepEqual(contextBudget(4096, 1024, 512, 1024, items), { available: 1536, used: 1150, selected: ['a', 'd'], remaining: 386, overcommitted: false });
  assert.deepEqual(contextBudget(1024, 512, 512, 1, items), { available: -1, used: 0, selected: [], remaining: -1, overcommitted: true });
  assert.deepEqual(contextBudget(1, 1, 0, 0, [{ id: 'zero', tokens: 0, eligible: true }]), { available: 0, used: 0, selected: ['zero'], remaining: 0, overcommitted: false });
  const snapshot = JSON.stringify(items);
  for (let budget = 0; budget <= 20; budget++) {
    const small = items.map((item, index) => ({ ...item, tokens: index + 1 }));
    const selected: string[] = [];
    let consumed = 0;
    for (const item of small.filter(item => item.eligible)) {
      if (budget - consumed >= item.tokens) { selected.push(item.id); consumed += item.tokens; }
    }
    assert.deepEqual(contextBudget(budget + 10, 4, 3, 3, small), { available: budget, used: consumed, selected, remaining: budget - consumed, overcommitted: false });
  }
  assert.equal(JSON.stringify(items), snapshot);
});

test('visual math rejects invalid ranges and nonfinite values instead of returning success-shaped fallbacks', () => {
  assert.throws(() => softmax([]), RangeError);
  assert.throws(() => softmax([Infinity]), RangeError);
  assert.throws(() => softmax([1], 0), RangeError);
  assert.throws(() => causalAttention([[1, 2], [1]]), RangeError);
  assert.throws(() => causalAttention([[NaN]]), RangeError);
  assert.throws(() => samplingDistribution([1, 2], 1, 0, 1), RangeError);
  assert.throws(() => samplingDistribution([1, 2], 1, 3, 1), RangeError);
  assert.throws(() => samplingDistribution([1, 2], 1, 2, 0), RangeError);
  const shape = { layers: 32, kvHeads: 8, headDimension: 128, tokens: 4096, sequences: 1, bytesPerElement: 2 };
  for (const field of Object.keys(shape) as (keyof typeof shape)[]) for (const bad of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => kvCacheBytes({ ...shape, [field]: bad }), RangeError);
  assert.throws(() => kvCacheBytes({ layers: 256, kvHeads: 256, headDimension: 512, tokens: 1048576, sequences: 1024, bytesPerElement: 4 }), RangeError);
  assert.throws(() => streamMetrics(0, 0, 10, 0, 100), RangeError);
  assert.throws(() => streamMetrics(-1, 0, 10, 1, 100), RangeError);
  assert.throws(() => contextBudget(0, 0, 0, 0, []), RangeError);
  assert.throws(() => contextBudget(100, 0, 0, 0, [{ id: 'x', tokens: 1, eligible: true }, { id: 'x', tokens: 2, eligible: true }]), RangeError);
});
