import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import { aiLabLessons } from '../shared/content/ai-lab-lessons';
import { aiLabProblems } from '../shared/content/ai-lab-problems';
import { aiLabQuestions } from '../shared/content/ai-lab-questions';
import { contentSources } from '../shared/content/sources';
import { courses } from '../shared/courses';
import { problems, quizTopics, tracks } from '../shared/catalog';
import { courses as publicCourses, problems as publicProblems } from '../shared/public-catalog';
import { gradeQuiz } from '../server/content/grading';

const words = (text: string) => text.trim().split(/\s+/).length;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
function solver(id: string) {
  const problem = aiLabProblems.find(problem => problem.id === id)!;
  const script = new Script(`${problem.solution!.code}\noutput = solve(input);`);
  return (input: unknown): unknown => {
    const context = createContext({ input: structuredClone(input), output: undefined });
    const before = JSON.stringify(context.input);
    script.runInContext(context, { timeout: 1000 });
    assert.equal(JSON.stringify(context.input), before, `${id} mutated input`);
    return JSON.parse(JSON.stringify(context.output)) as unknown;
  };
}

test('popular-course follow-ups have complete free resources and pinned visible provenance', () => {
  assert.equal(aiLabLessons.length, 6);
  assert.equal(aiLabProblems.length, 4);
  assert.equal(aiLabQuestions.length, 16);
  for (const id of ['retrieval-engineering', 'agent-engineering']) {
    const course = courses.find(course => course.id === id)!;
    const steps = course.units.flatMap(unit => unit.steps);
    assert.equal(steps.length, 7);
    assert.equal(new Set(steps.map(step => step.id)).size, 7);
    assert.equal(steps.filter(step => step.type === 'lesson').length, 3);
    assert.equal(steps.filter(step => step.type === 'quiz').length, 2);
    assert.equal(steps.filter(step => step.type === 'practice').length, 2);
    assert.ok(!course.premium);
    assert.equal(course.track, 'ml-system-design');
    assert.match(course.description, /independent Studio material, not upstream certification/);
    assert.ok(course.sourceIds && course.sourceIds.length >= 3);
    for (const source of course.sourceIds) assert.ok(Object.hasOwn(contentSources, source));
    assert.deepEqual(publicCourses.find(course => course.id === id)!.sourceIds, course.sourceIds);
    for (const step of steps) {
      if (step.type === 'lesson') assert.ok(aiLabLessons.some(lesson => step.resource === `ml-system-design/${lesson.id}` && !lesson.premium));
      if (step.type === 'practice') assert.ok(aiLabProblems.some(problem => problem.id === step.resource && !problem.premium));
      if (step.type === 'quiz') assert.ok(aiLabQuestions.some(question => question.topic === step.resource));
    }
  }
  for (const id of ['llm-course-roadmap', 'hf-agents-course', 'llm-zoomcamp'] as const) {
    assert.match(contentSources[id].url, /\/tree\/[a-f0-9]{40}$/);
    assert.equal(contentSources[id].researchDate, '2026-10-23');
  }
  for (const lesson of aiLabLessons) {
    const prose = lesson.sections.flatMap(section => [section.body, ...(section.bullets ?? [])]).join(' ');
    assert.ok(words(prose) >= 500, lesson.id);
    assert.ok(lesson.sections.length >= 4 && lesson.sections.every(section => words(section.body) >= 60));
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.equal(lesson.minutes, Math.max(3, Math.ceil(words(prose) / 200)));
    assert.equal(tracks.flatMap(track => track.lessons).filter(item => item.id === lesson.id).length, 1);
    assert.ok(quizTopics.some(topic => topic.id === lesson.quizTopic && topic.track === 'ml-system-design'));
    assert.ok(lesson.relatedProblemIds?.every(id => aiLabProblems.some(problem => problem.id === id)));
    assert.ok(lesson.sourceIds && lesson.sourceIds.length >= 2);
  }
  for (const problem of aiLabProblems) {
    assert.ok(problems.includes(problem) || problems.some(item => item.id === problem.id && item.solution === problem.solution));
    assert.equal(problem.track, 'ml-system-design');
    assert.ok(problem.solution && problem.testCases && problem.testCases.length >= 6);
    assert.deepEqual(problem.solution.examples, problem.testCases);
    assert.ok(words(problem.solution.sections.map(section => section.body).join(' ')) >= 350);
    assert.ok(problem.solution.timeComplexity && problem.solution.spaceComplexity);
    assert.ok(problem.solution.lessonIds.every(id => aiLabLessons.some(lesson => lesson.id === id)));
    for (const id of problem.solution.sourceIds) assert.ok(Object.hasOwn(contentSources, id));
    const metadata = publicProblems.find(item => item.id === problem.id)!;
    assert.ok(metadata.runnable && metadata.hasSolution && !metadata.hasWorkedCase && !metadata.premium);
    assert.ok(!Object.hasOwn(metadata, 'solution') && !Object.hasOwn(metadata, 'testCases'));
  }
  for (const topic of new Set(aiLabQuestions.map(question => question.topic))) {
    const pool = aiLabQuestions.filter(question => question.topic === topic);
    assert.equal(pool.length, 4);
    assert.deepEqual(pool.map(question => question.correct), [0, 1, 2, 3]);
    assert.equal(quizTopics.find(item => item.id === topic)!.count, 4);
    assert.deepEqual(gradeQuiz(topic, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: 4, total: 4, missed: [] });
  }
  assert.equal(new Set(aiLabQuestions.map(question => question.prompt)).size, 16);
  for (const question of aiLabQuestions) {
    assert.ok(words(question.explanation) >= 45 && question.options.length === 4);
    assert.equal(new Set(question.options).size, 4);
    for (const id of question.sourceIds ?? []) assert.ok(Object.hasOwn(contentSources, id));
  }
});

test('all 28 literal lab fixtures run through browser-compatible JSON without mutation or state leaks', () => {
  assert.equal(aiLabProblems.reduce((sum, problem) => sum + problem.testCases!.length, 0), 28);
  for (const problem of aiLabProblems) {
    const solve = solver(problem.id);
    for (const example of problem.testCases!) {
      assert.deepEqual(solve(example.input), example.expected, `${problem.id}: ${example.label}`);
      assert.deepEqual(solve(example.input), example.expected);
    }
  }
});

test('evidence packing agrees with an independent eligible-first list and budget oracle', () => {
  const solve = solver('lab-context-packer');
  const choices = [
    { id: 'A', tenant: 't', authorized: true, tokens: 0 },
    { id: 'A', tenant: 't', authorized: true, tokens: 3 },
    { id: 'B', tenant: 't', authorized: true, tokens: 1 },
    { id: 'B', tenant: 't', authorized: false, tokens: 0 },
    { id: 'A', tenant: 'other', authorized: true, tokens: 1 },
    { id: '__proto__', tenant: 't', authorized: true, tokens: 2 },
  ];
  for (let pattern = 0; pattern < choices.length ** 3; pattern++) {
    const passages = [0, 1, 2].map(index => choices[Math.floor(pattern / choices.length ** index) % choices.length]);
    const eligible = passages.filter(passage => passage.tenant === 't' && passage.authorized);
    const unique = eligible.filter((passage, index) => eligible.findIndex(item => item.id === passage.id) === index);
    for (let budget = 0; budget <= 4; budget++) {
      const selected: typeof choices = [];
      for (const passage of unique) if (selected.reduce((sum, item) => sum + item.tokens, 0) + passage.tokens <= budget) selected.push(passage);
      assert.deepEqual(solve({ tenant: 't', budget, passages }), { ids: selected.map(item => item.id), tokens: selected.reduce((sum, item) => sum + item.tokens, 0) });
    }
  }
});

test('retrieval metrics match independent ranked-position counts and round only final means', () => {
  const solve = solver('lab-retrieval-metrics');
  const alphabet = ['A', 'B', 'X'];
  for (let length = 0; length <= 3; length++) {
    for (let pattern = 0; pattern < 3 ** length; pattern++) {
      const ranked = Array.from({ length }, (_, index) => alphabet[Math.floor(pattern / 3 ** index) % 3]);
      for (const relevant of [[], ['A'], ['A', 'A', 'B']]) for (const k of [1, 2, 3]) {
        const uniqueRanked = ranked.filter((id, index) => ranked.indexOf(id) === index);
        const uniqueRelevant = relevant.filter((id, index) => relevant.indexOf(id) === index);
        const positions = uniqueRelevant.map(id => uniqueRanked.indexOf(id) + 1).filter(position => position > 0 && position <= k);
        const recall = uniqueRelevant.length ? round(positions.length / uniqueRelevant.length) : null;
        const rr = positions.length ? round(1 / Math.min(...positions)) : 0;
        assert.deepEqual(solve({ k, queries: [{ relevant, ranked }] }), {
          items: [{ hits: positions.length, precision: round(positions.length / k), recall, rr }],
          meanRecall: recall, mrr: recall === null ? null : rr,
        });
      }
    }
  }
  const difficult = { relevant: ['A', 'B', 'C'], ranked: ['X', 'Y', 'A'] };
  const result = solve({ k: 3, queries: [difficult, difficult, { relevant: ['A'], ranked: ['A'] }] });
  assert.deepEqual(result, {
    items: [
      { hits: 1, precision: 0.333333, recall: 0.333333, rr: 0.333333 },
      { hits: 1, precision: 0.333333, recall: 0.333333, rr: 0.333333 },
      { hits: 1, precision: 0.333333, recall: 1, rr: 1 },
    ], meanRecall: 0.555556, mrr: 0.555556,
  });
});

test('tool gates enforce strict arguments, resource scope, version precedence and every approval binding', () => {
  const solve = solver('lab-tool-dispatch');
  const base = { tenant: 't', resources: [{ id: 'D', tenant: 't', version: 2 }], approvals: [] };
  const invalidRead = [null, [], 'D', {}, { documentId: '' }, { documentId: 1 }, { documentId: 'D', actor: 'admin' }, { documentId: 'x'.repeat(81) }];
  for (const args of invalidRead) assert.deepEqual(solve({ ...base, calls: [{ id: 'c', name: 'read_document', args }] }), [{ id: 'c', status: 'rejected', reason: 'invalid-arguments' }]);
  const approval = { callId: 'c', documentId: 'D', tag: 'ok', version: 2 };
  const call = { id: 'c', name: 'set_tag', args: { documentId: 'D', tag: 'ok', expectedVersion: 2 } };
  for (const changed of [{ callId: 'other' }, { documentId: 'other' }, { tag: 'different' }, { version: 1 }]) {
    assert.deepEqual(solve({ ...base, approvals: [{ ...approval, ...changed }], calls: [call] }), [{ id: 'c', status: 'approval-required', reason: 'approval-required' }]);
  }
  for (const changed of [{ tag: '' }, { tag: ' ' }, { tag: 'x'.repeat(41) }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: '2' }]) {
    assert.deepEqual(solve({ ...base, approvals: [approval], calls: [{ ...call, args: { ...call.args, ...changed } }] }), [{ id: 'c', status: 'rejected', reason: 'invalid-arguments' }]);
  }
  assert.deepEqual(solve({ ...base, approvals: [approval], calls: [call] }), [{ id: 'c', status: 'ready', reason: null }]);
  assert.deepEqual(solve({ ...base, calls: [{ ...call, args: { ...call.args, expectedVersion: 1 } }] }), [{ id: 'c', status: 'rejected', reason: 'stale-version' }]);
  assert.deepEqual(solve({ ...base, resources: [{ id: 'D', tenant: 'other', version: 3 }], calls: [call] }), [{ id: 'c', status: 'rejected', reason: 'forbidden' }]);
});

type Event = { type: 'propose' | 'approve' | 'dispatch' | 'timeout' | 'confirm'; key: string; payload?: string; receipt?: string };
type Phase = 'proposed' | 'approved' | 'dispatched' | 'unknown' | 'confirmed';
function historyOracle(events: Event[], limit: number) {
  const records: { key: string; payload: string; status: Phase; receipt: string | null }[] = [];
  const results: string[] = [];
  let spent = 0;
  const transitions: Record<'dispatch' | 'timeout' | 'confirm', Partial<Record<Phase, Phase>>> = {
    dispatch: { approved: 'dispatched' }, timeout: { dispatched: 'unknown' },
    confirm: { dispatched: 'confirmed', unknown: 'confirmed' },
  };
  for (const event of events) {
    const record = records.find(record => record.key === event.key);
    if (event.type === 'propose') {
      results.push(record ? record.payload === event.payload ? 'replayed' : 'conflict' : 'accepted');
      if (!record) records.push({ key: event.key, payload: event.payload!, status: 'proposed', receipt: null });
      continue;
    }
    if (!record) { results.push('not-found'); continue; }
    if (event.type === 'approve') {
      results.push(record.payload !== event.payload ? 'conflict' : record.status === 'proposed' ? 'accepted' : 'replayed');
      if (record.payload === event.payload && record.status === 'proposed') record.status = 'approved';
      continue;
    }
    const next = transitions[event.type][record.status];
    if (next) {
      if (event.type === 'dispatch' && spent === limit) { results.push('budget-exhausted'); continue; }
      record.status = next;
      if (event.type === 'dispatch') spent++;
      if (event.type === 'confirm') record.receipt = event.receipt!;
      results.push('accepted');
    } else if (event.type === 'dispatch' && record.status === 'unknown') results.push('reconcile-required');
    else if (event.type === 'confirm' && record.status === 'confirmed') results.push(record.receipt === event.receipt ? 'replayed' : 'conflict');
    else if (event.type === 'dispatch' && ['dispatched', 'confirmed'].includes(record.status) || event.type === 'timeout' && record.status === 'unknown') results.push('replayed');
    else results.push('invalid-state');
  }
  assert.ok(spent <= limit);
  return { operations: records, remaining: limit - spent, results };
}

test('agent histories agree with an independent state-table oracle at every prefix', () => {
  const solve = solver('lab-agent-reducer');
  const alphabet: Event[] = [
    { type: 'propose', key: 'a', payload: 'P' }, { type: 'propose', key: 'a', payload: 'Q' },
    { type: 'approve', key: 'a', payload: 'P' }, { type: 'approve', key: 'a', payload: 'Q' },
    { type: 'dispatch', key: 'a' }, { type: 'timeout', key: 'a' },
    { type: 'confirm', key: 'a', receipt: 'R' }, { type: 'confirm', key: 'a', receipt: 'S' },
    { type: 'propose', key: 'b', payload: 'B' }, { type: 'approve', key: 'b', payload: 'B' },
    { type: 'dispatch', key: 'b' }, { type: 'confirm', key: 'b', receipt: 'T' },
  ];
  let seed = 20261023;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const histories = aiLabProblems.find(problem => problem.id === 'lab-agent-reducer')!.testCases!.map(example => (example.input as { events: Event[] }).events);
  for (let index = 0; index < 160; index++) histories.push(Array.from({ length: 12 }, () => alphabet[next() % alphabet.length]));
  for (const events of histories) for (const limit of [0, 1, 2]) {
    for (let length = 0; length <= events.length; length++) {
      const prefix = events.slice(0, length);
      assert.deepEqual(solve({ limit, events: prefix }), historyOracle(prefix, limit), JSON.stringify({ limit, events: prefix }));
    }
  }
});
