import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tracks, quizQuestions, quizTopics } from '../shared/catalog';
import { tracks as publicTracks } from '../shared/public-tracks';
import { lessonActivities } from '../shared/content/lesson-activities';
import { systemDesignLessons } from '../shared/content/system-design-lessons';
import { codingLessons } from '../shared/content/coding-lessons';
import { lowLevelDesignLessons } from '../shared/content/low-level-design-lessons';
import { practicalQuestions } from '../shared/content/practical-questions';
import { contentSources } from '../shared/content/sources';
import { algorithmExperiment, algorithmFixtureLabels } from '../shared/algorithm-experiments';
import { cachedRead, capacityEstimate, featureAvailability, queueEstimate, releaseGate, retrievalMetrics, storyBudget, tokenBucket, versionedWrite, vestingEstimate } from '../shared/curriculum-models';
import { gradeQuiz } from '../server/content/grading';
import { LessonCheck } from '../src/components/LessonCheck';
import type { AlgorithmExperimentKind } from '../shared/types';

const words = (text: string) => text.trim().split(/\s+/).length;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('all 94 lessons have authored traces, local checks, valid saved quizzes and honest lab discovery', () => {
  assert.equal(Object.keys(lessonActivities).length, 94);
  const checks = new Set<string>(), prompts = new Set<string>(), diagrams = new Set<string>();
  let labCount = 0;
  for (const track of tracks) for (const lesson of track.lessons) {
    const key = `${track.id}/${lesson.id}`;
    assert.ok(lessonActivities[key], key);
    const flow = lesson.sections.flatMap(section => section.flow ?? []);
    const check = lesson.sections.flatMap(section => section.check ?? []);
    assert.equal(flow.length, 1, key);
    assert.equal(check.length, 1, key);
    assert.ok(flow[0].steps.length >= 3 && flow[0].steps.length <= 4);
    assert.equal(new Set(flow[0].steps.map(step => step.id)).size, flow[0].steps.length);
    assert.ok(flow[0].steps.every(step => step.title.length <= 24 && words(step.detail) >= 10), key);
    assert.ok(!diagrams.has(flow[0].steps.map(step => step.detail).join(' ')), key);
    diagrams.add(flow[0].steps.map(step => step.detail).join(' '));
    assert.ok(!checks.has(check[0].id) && !prompts.has(check[0].prompt), key);
    checks.add(check[0].id); prompts.add(check[0].prompt);
    assert.equal(new Set(check[0].options).size, 3);
    assert.equal(check[0].options[check[0].correct], lessonActivities[key].question[1][0]);
    assert.ok(words(check[0].explanation) >= 15, key);
    assert.ok(quizTopics.some(topic => topic.id === lesson.quizTopic && topic.track === track.id), key);
    const metadata = publicTracks.find(item => item.id === track.id)!.lessons.find(item => item.id === lesson.id)!;
    assert.deepEqual(metadata.activities, {
      flow: true, check: true,
      lab: lesson.sections.some(section => !!section.lab || !!section.visualization)
        || (track.id === 'code' && ['two-pointers','sliding-window','binary-search','graph-search','dynamic-programming'].includes(lesson.id)),
    });
    if (metadata.activities!.lab) labCount++;
    for (const privateField of ['sections', 'exercise', 'check', 'lab', 'correct', 'explanation']) assert.ok(!Object.hasOwn(metadata, privateField));
  }
  assert.equal(checks.size, 94);
  assert.equal(labCount, 75);
});

test('enrichment preserves original source paragraphs, examples, flags, reading times and existing quiz assignments', () => {
  for (const [id, originals] of [['system-design', systemDesignLessons], ['code', codingLessons], ['low-level-design', lowLevelDesignLessons]] as const) {
    const published = tracks.find(track => track.id === id)!;
    for (const original of originals) {
      const lesson = published.lessons.find(lesson => lesson.id === original.id)!;
      assert.equal(lesson.minutes, original.minutes);
      assert.equal(lesson.premium, original.premium);
      assert.equal(lesson.quizTopic, original.quizTopic);
      assert.equal(lesson.exercise, original.exercise);
      assert.deepEqual(lesson.relatedProblemIds, original.relatedProblemIds);
      assert.deepEqual(lesson.sections.map(({ flow, check, lab, visualization, ...paragraph }) => paragraph), original.sections);
      assert.ok(original.sections.every(section => !section.flow && !section.check && !section.lab), 'Do not mutate exported source lessons.');
    }
  }
  assert.equal(tracks.find(track => track.id === 'ml-system-design')!.lessons.find(lesson => lesson.id === 'embeddings')!.premium, true);
  assert.equal(tracks.find(track => track.id === 'behavioral')!.lessons.find(lesson => lesson.id === 'leadership')!.premium, true);
});

test('42 new canonical questions have substantive sources and all old topic ownership remains unambiguous', () => {
  assert.equal(practicalQuestions.length, 42);
  assert.equal(new Set(practicalQuestions.map(question => question.prompt)).size, 42);
  for (const question of practicalQuestions) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(words(question.explanation) >= 45, question.id);
    assert.ok(question.sourceIds?.length && question.sourceIds.every(id => Object.hasOwn(contentSources, id)));
  }
  for (const topic of quizTopics) {
    const pool = quizQuestions.filter(question => question.topic === topic.id);
    assert.ok(pool.length >= 3);
    assert.equal(topic.count, pool.length);
    assert.ok(tracks.find(track => track.id === topic.track)!.lessons.some(lesson => lesson.id === topic.id || lesson.quizTopic === topic.id));
    assert.ok(tracks.find(track => track.id === topic.track)!.lessons.some(lesson => lesson.id === topic.lessonId));
    assert.deepEqual(gradeQuiz(topic.id, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: pool.length, total: pool.length, missed: [] });
  }
  assert.equal(quizTopics.length, 62);
  assert.equal(quizQuestions.length, 549);
  assert.equal(quizTopics.find(topic => topic.id === 'evaluation')!.count, 6);
});

test('local check renders an explicit choice without revealing an answer before submission or injecting markup', () => {
  const check = { id: 'safe', prompt: '<script>question</script>', options: ['A', 'B', 'C'], correct: 1, explanation: 'Private explanation until an attempt.' };
  const html = renderToStaticMarkup(createElement(LessonCheck, { check }));
  assert.ok(html.includes('&lt;script&gt;question&lt;/script&gt;') && !html.includes('<script>'));
  assert.ok(!html.includes(check.explanation));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.match(html, /disabled=""/);
  assert.match(html, /does not save a quiz score/);
});

test('capacity, backlog and token-bucket arithmetic preserve units and exact boundary policies', () => {
  const capacity = capacityEstimate(1000000, 6, 800, 3);
  near(capacity.average, 1000000 / 86400); near(capacity.peak, 6000000 / 86400);
  near(capacity.payloadMbps, 6000000 * 800 * 8 / (86400 * 1000000));
  assert.equal(capacity.storedGB, 72);
  assert.equal(capacityEstimate(0, 1, 800, 1).storedGB, 0);
  assert.deepEqual(queueEstimate(100, 80, 10, 200), { pending: 400, drainSeconds: null });
  assert.deepEqual(queueEstimate(100, 200, 1, 200), { pending: 100, drainSeconds: 1 });
  assert.deepEqual(queueEstimate(100, 200, 10, 200), { pending: 0, drainSeconds: 0 });
  assert.deepEqual(queueEstimate(0, 0, 10, 0), { pending: 0, drainSeconds: 0 });
  assert.deepEqual(tokenBucket(10, 2, 3, 10), { replenished: 6, accepted: 6, rejected: 4, remaining: 0 });
  assert.equal(tokenBucket(10, 2, 60, 10).replenished, 10);
  assert.equal(tokenBucket(10, 0, 60, 10).accepted, 0);
});

test('cache expiry and conditional writes distinguish policy freshness from authority without mutation', () => {
  assert.deepEqual(cachedRead(11, 10, false), { hit: true, returnedVersion: 1, authoritativeVersion: 2, stale: true });
  assert.deepEqual(cachedRead(10, 10, false), { hit: false, returnedVersion: 2, authoritativeVersion: 2, stale: false });
  assert.equal(cachedRead(60, 5, true).hit, false);
  const original = { version: 1, value: 'Original' };
  const first = versionedWrite(original, 1, 'A');
  assert.deepEqual(first, { accepted: true, state: { version: 2, value: 'A' } });
  assert.deepEqual(versionedWrite(first.state, 1, 'B'), { accepted: false, state: { version: 2, value: 'A' } });
  assert.deepEqual(original, { version: 1, value: 'Original' });
});

test('ranking denominators, feature availability and release gates expose absent evidence', () => {
  const result = retrievalMetrics(['b', 'a', 'd', 'c'], ['a', 'c', 'e']);
  assert.deepEqual(result, { hits: 2, precision: 0.5, recall: 2 / 3, reciprocalRank: 0.5 });
  assert.deepEqual(retrievalMetrics([], []), { hits: 0, precision: null, recall: null, reciprocalRank: 0 });
  assert.equal(retrievalMetrics(['x'], []).recall, null);
  assert.deepEqual(featureAvailability(10, [6, 12, 30]), [true, false, false]);
  assert.deepEqual(featureAvailability(12, [6, 12, 30]), [true, true, false]);
  assert.deepEqual(releaseGate(0, 0, 0, 0, 500), { rate: null, allowed: false });
  assert.equal(releaseGate(19, 20, 0, 500, 500).allowed, true);
  assert.equal(releaseGate(20, 20, 1, 0, 500).allowed, false);
  assert.equal(releaseGate(20, 20, 0, 501, 500).allowed, false);
});

test('story and vesting models compute only their declared quantities, including exact cliff boundaries', () => {
  assert.deepEqual(storyBudget([25, 60, 20, 15], 120), { total: 120, remaining: 0, actionShare: 0.5 });
  assert.equal(storyBudget([0, 0, 0, 0], 120).actionShare, null);
  assert.equal(storyBudget([120, 120, 120, 120], 120).remaining, -360);
  assert.deepEqual(vestingEstimate(120000, 4800, 11, 10), { grossBase: 110000, vestedUnits: 0, hypotheticalEquity: 0 });
  assert.deepEqual(vestingEstimate(120000, 4800, 12, 10), { grossBase: 120000, vestedUnits: 1200, hypotheticalEquity: 12000 });
  assert.deepEqual(vestingEstimate(120000, 4800, 48, 10), { grossBase: 480000, vestedUnits: 4800, hypotheticalEquity: 48000 });
  assert.deepEqual(vestingEstimate(120000, 4800, 0, 0), { grossBase: 0, vestedUnits: 0, hypotheticalEquity: 0 });
});

const expectedAlgorithms: Record<AlgorithmExperimentKind, unknown[]> = {
  'pair-oracle': [true, false, false], growth: [{ scan: 4, pairs: 6, subsets: 16 }, { scan: 0, pairs: 0, subsets: 1 }, { scan: 16, pairs: 120, subsets: 65536 }],
  frequency: [[[2, 2], [1, 1], [3, 1]], [], [[2, 3]]], prefix: [1, 0, 4],
  intervals: [[[1, 4], [6, 8]], [[1, 3], [3, 5]], []], stack: [[null, 2, null, null], [], [null, null, null]],
  reverse: [[2, 2, 1, 3], [], [2, 2, 2]], heap: [[3, 2], [], [2, 2]], tree: [[3, 3, 9], [], [2, 2, 2]],
  'weighted-graph': [3, null, 3], topological: [[0, 1, 2, 3], null, [0, 1, 2]], 'union-find': [2, 3, 0],
  subsets: [[[], [3], [2], [2, 3], [1], [1, 3], [1, 2], [1, 2, 3]], [[]], [[], [2], [2], [2, 2]]],
  'sequence-dp': [3, 0, 3], greedy: [[[1, 2], [2, 3], [3, 4]], [[1, 3], [3, 5]], []],
  trie: [['cache', 'car', 'cat'], [], ['cache', 'car', 'cat', 'dog']], 'flood-fill': [2, 1, 0], bits: [3, 0, 8],
  oracle: [{ oracle: true, buggy: true, agrees: true }, { oracle: false, buggy: false, agrees: true }, { oracle: false, buggy: true, agrees: false }],
};
test('all 57 algorithm fixtures match independent explicit expectations and recompute isolated state', () => {
  assert.equal(Object.keys(expectedAlgorithms).length, 19);
  assert.deepEqual(Object.keys(algorithmFixtureLabels).sort(), Object.keys(expectedAlgorithms).sort());
  for (const kind of Object.keys(expectedAlgorithms) as AlgorithmExperimentKind[]) for (let fixture = 0; fixture < 3; fixture++) {
    const result = algorithmExperiment(kind, fixture);
    assert.deepEqual(JSON.parse(result.output), expectedAlgorithms[kind][fixture], `${kind} fixture ${fixture}`);
    assert.ok(result.frames.length >= 1 && result.frames.length <= 20);
    assert.ok(result.frames.every(frame => frame.title && frame.detail && frame.values.every(value => typeof value === 'string')));
    result.frames[0].values.push('caller mutation');
    assert.ok(!algorithmExperiment(kind, fixture).frames[0].values.includes('caller mutation'));
  }
});

test('models reject invalid, nonfinite, duplicate and unsafe numeric inputs explicitly', () => {
  for (const bad of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => capacityEstimate(bad, 1, 800, 3), RangeError);
    assert.throws(() => queueEstimate(bad, 1, 10, 0), RangeError);
    assert.throws(() => tokenBucket(10, bad, 1, 10), RangeError);
    assert.throws(() => featureAvailability(bad, []), RangeError);
    assert.throws(() => releaseGate(0, 20, bad, 0, 500), RangeError);
    assert.throws(() => storyBudget([0, 0, 0, bad], 120), RangeError);
    assert.throws(() => vestingEstimate(120000, 4800, bad, 10), RangeError);
  }
  assert.throws(() => capacityEstimate(1000000000, 100, 1000000, 10), RangeError);
  assert.throws(() => cachedRead(0, 10, false), RangeError);
  assert.throws(() => cachedRead(10, 4, false), RangeError);
  assert.throws(() => versionedWrite({ version: 1, value: 'A' }, 0, 'B'), RangeError);
  assert.throws(() => versionedWrite({ version: 1, value: 'A' }, 1, ''), RangeError);
  assert.throws(() => retrievalMetrics(['a', 'a'], ['a']), RangeError);
  assert.throws(() => retrievalMetrics(['a'], ['a', 'a']), RangeError);
  assert.throws(() => featureAvailability(1, [NaN]), RangeError);
  assert.throws(() => releaseGate(21, 20, 0, 0, 500), RangeError);
  assert.throws(() => storyBudget([1, 2], 120), RangeError);
  assert.throws(() => vestingEstimate(120000, 4800, 49, 10), RangeError);
  assert.throws(() => algorithmExperiment('heap', 3), RangeError);
});
