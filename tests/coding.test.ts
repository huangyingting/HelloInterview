import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import { practiceLabels, practiceTracks, problems, quizQuestions, quizTopics, tracks } from '../shared/catalog';
import { codingQuestions } from '../shared/content/coding-questions';
import { contentSources } from '../shared/content/sources';
import { courses } from '../shared/courses';
import { gradeQuiz } from '../server/content/grading';
import type { ContentSection, Problem } from '../shared/types';

const lessons = tracks.find(track => track.id === 'code')!.lessons;
const exercises = problems.filter(problem => problem.track === 'code');
const topics = quizTopics.filter(topic => topic.track === 'code');
const questions = quizQuestions.filter(question => topics.some(topic => topic.id === question.topic));
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const normalized = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
const prose = (sections: ContentSection[]) => sections.flatMap(section => [section.body, ...(section.bullets || [])]).join(' ');

function trustedReference(problem: Problem) {
  const context = createContext({ input: null });
  new Script(problem.solution!.code).runInContext(context, { timeout: 1000 });
  const call = new Script('solve(input)');
  return (input: unknown) => {
    context.input = structuredClone(input);
    const before = JSON.stringify(context.input);
    const result: unknown = call.runInContext(context, { timeout: 1000 });
    assert.equal(JSON.stringify(context.input), before, `${problem.id} mutates its input`);
    const json = JSON.stringify(result);
    assert.ok(json !== undefined, `${problem.id} must return JSON`);
    if (problem.id === 'alg-chain-reverse') {
      const originalNodes = new Set<object>();
      let node: unknown = context.input.head;
      while (typeof node === 'object' && node !== null) { originalNodes.add(node); node = 'next' in node ? node.next : null; }
      node = result;
      while (typeof node === 'object' && node !== null) {
        assert.ok(!originalNodes.has(node), 'Reversed chain must use new nodes, not reuse input nodes');
        node = 'next' in node ? node.next : null;
      }
    }
    return JSON.parse(json) as unknown;
  };
}

test('coding flagship meets its exact scope and all resource links resolve', () => {
  assert.equal(lessons.length, 24);
  assert.equal(exercises.length, 24);
  assert.equal(topics.length, 12);
  assert.equal(questions.length, 180);
  assert.equal(codingQuestions.length, 177);
  assert.ok(practiceTracks.includes('code'));
  assert.equal(practiceLabels.code, 'Coding & Algorithms');
  assert.equal(courses.length, 8);
  for (const lesson of lessons) {
    const text = prose(lesson.sections);
    assert.ok(words(text) >= 500, `${lesson.id} needs 500 instructional words, excluding code and metadata`);
    assert.ok(lesson.sections.length >= 4);
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.equal(lesson.minutes, Math.max(3, Math.ceil(words(text) / 200)));
    assert.ok(lesson.sourceIds && lesson.sourceIds.length >= 2);
    for (const id of lesson.sourceIds) assert.ok(Object.hasOwn(contentSources, id), id);
    assert.ok(lesson.relatedProblemIds?.length);
    for (const id of lesson.relatedProblemIds) assert.ok(exercises.some(problem => problem.id === id && problem.solution), `${lesson.id}: ${id}`);
    assert.ok(topics.some(topic => topic.id === lesson.quizTopic), `${lesson.id}: missing quiz`);
  }
  assert.deepEqual(lessons.filter(lesson => lesson.premium).map(lesson => lesson.id), ['dynamic-programming']);
});

test('coding exercises have independent fixtures, bounded contracts and substantial sourced solutions', () => {
  assert.equal(new Set(exercises.map(problem => problem.id)).size, 24);
  for (const problem of exercises) {
    assert.ok(problem.id.startsWith('alg-'));
    assert.ok(problem.description.trim());
    assert.ok(problem.requirements.length >= 4);
    assert.ok(problem.keywords.length >= 4 && problem.keywords.every(group => group.length));
    assert.match(problem.starter!, /function solve\(input\)/);
    assert.ok(problem.testCases && problem.testCases.length >= 6, problem.id);
    assert.equal(new Set(problem.testCases.map(example => example.label)).size, problem.testCases.length);
    assert.equal(new Set(problem.testCases.map(example => JSON.stringify(example.input))).size, problem.testCases.length);
    const solution = problem.solution;
    assert.ok(solution && solution.sections.length >= 3);
    assert.ok(words(prose(solution.sections)) >= 300, `${problem.id} needs 300 reasoning words excluding code and complexity metadata`);
    assert.ok(solution.timeComplexity.trim() && solution.spaceComplexity.trim());
    assert.match(solution.code, /function solve\(input\)/);
    assert.ok(solution.lessonIds.length);
    for (const id of solution.lessonIds) assert.ok(lessons.some(lesson => lesson.id === id), `${problem.id}: ${id}`);
    assert.ok(solution.sourceIds.length >= 1, `${problem.id} needs a relevant public reference`);
    for (const id of solution.sourceIds) assert.ok(Object.hasOwn(contentSources, id), id);
    assert.equal(new Set(solution.sourceIds).size, solution.sourceIds.length);
  }
});

test('all trusted reference implementations pass every fixture without mutation or repeat-call state leaks', () => {
  for (const problem of exercises) {
    const solve = trustedReference(problem);
    for (const example of [...problem.testCases!, ...[...problem.testCases!].reverse()]) {
      const actual = solve(example.input);
      assert.deepEqual(actual, example.expected, `${problem.id}: ${example.label}`);
      assert.equal(JSON.stringify(actual), JSON.stringify(example.expected), `${problem.id}: output must also match browser serialization`);
    }
  }
});

test('coding quizzes are distinct, sourced, balanced and canonically graded', () => {
  assert.equal(new Set(questions.map(question => question.id)).size, 180);
  assert.equal(new Set(questions.map(question => normalized(question.prompt))).size, 180);
  assert.ok(codingQuestions.every(question => question.id.startsWith('algo-q-')));
  for (const question of questions) {
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options.map(normalized)).size, 4, question.id);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
    assert.ok(words(question.explanation) >= 45, question.id);
    assert.ok(['Easy', 'Medium', 'Hard'].includes(question.difficulty!));
    assert.ok(question.sourceIds?.length, question.id);
    for (const id of question.sourceIds) assert.ok(Object.hasOwn(contentSources, id), id);
  }
  for (const topic of topics) {
    const pool = questions.filter(question => question.topic === topic.id);
    assert.equal(pool.length, 15, topic.id);
    assert.equal(topic.count, 15);
    assert.ok(pool.filter(question => question.difficulty === 'Easy').length >= 2, topic.id);
    assert.ok(pool.filter(question => question.difficulty === 'Hard').length >= 2, topic.id);
    assert.deepEqual(gradeQuiz(topic.id, Object.fromEntries(pool.map(question => [question.id, question.correct]))), { score: 15, total: 15, missed: [] });
  }
  for (let position = 0; position < 4; position++) assert.ok(codingQuestions.filter(question => question.correct === position).length >= 35, `Answer position ${position}`);
});

test('original coding links and answer contracts remain stable and the new course covers all resources', () => {
  for (const [id, title] of [['two-pointers', 'Two pointers'], ['sliding-window', 'Sliding windows'], ['binary-search', 'Binary search on an invariant'], ['graph-search', 'Graph traversal'], ['dynamic-programming', 'Dynamic programming']]) assert.equal(lessons.find(lesson => lesson.id === id)?.title, title);
  const originals = [
    ['pointer-1', 'In a sorted array, the two-pointer sum is below the target. Which move is appropriate?', ['Move the right pointer left', 'Move the left pointer right', 'Move both pointers randomly', 'Stop immediately'], 1],
    ['pointer-2', 'What is the search complexity for a sorted two-sum input?', ['O(n²)', 'O(n) time and O(1) auxiliary space', 'O(2ⁿ)', 'O(1) time for every input'], 1],
    ['pointer-3', 'What does an invariant help you explain?', ['Why eliminated candidates cannot be answers', 'Which font looks best', 'Why tests are unnecessary', 'Why sorting has no cost'], 0],
  ] as const;
  for (const [id, prompt, options, correct] of originals) {
    const question = questions.find(question => question.id === id)!;
    assert.equal(question.prompt, prompt);
    assert.deepEqual(question.options, [...options]);
    assert.equal(question.correct, correct);
  }
  const steps = courses.find(course => course.id === 'coding-complete')!.units.flatMap(unit => unit.steps);
  assert.equal(steps.length, 60);
  assert.equal(new Set(steps.map(step => step.id)).size, 60);
  assert.equal(steps.filter(step => step.type === 'video').length, 0);
  for (const lesson of lessons) assert.ok(steps.some(step => step.type === 'lesson' && step.resource === `code/${lesson.id}`));
  for (const topic of topics) assert.ok(steps.some(step => step.type === 'quiz' && step.resource === topic.id));
  for (const problem of exercises) assert.ok(steps.some(step => step.type === 'practice' && step.resource === problem.id));
});

function seededRandom(seed: number) {
  return (bound: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % bound;
  };
}

function reference(id: string) {
  const problem = exercises.find(problem => problem.id === id);
  assert.ok(problem, id);
  return trustedReference(problem);
}

function lexicographic(left: number[], right: number[]) {
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}

function subsets(values: number[]) {
  return Array.from({ length: 2 ** values.length }, (_, mask) => values.filter((_, position) => mask & 2 ** position).sort((a, b) => a - b)).sort(lexicographic);
}

test('sequence references agree with independently enumerated small cases and numeric boundaries', () => {
  const random = seededRandom(82413);
  const pair = reference('alg-pair-load'), window = reference('alg-window-budget'), prefix = reference('alg-prefix-queries');
  const next = reference('alg-next-higher'), threshold = reference('alg-first-threshold'), top = reference('alg-top-priorities');
  const route = reference('alg-nondecreasing-route'), bits = reference('alg-bit-count');
  for (let iteration = 0; iteration < 120; iteration++) {
    const values = Array.from({ length: random(9) }, () => random(15) - 7);
    const sorted = [...values].sort((a, b) => a - b), target = random(29) - 14;
    const expectedPair = sorted.some((value, i) => sorted.slice(i + 1).some(other => value + other === target));
    assert.equal(pair({ values: sorted, target }), expectedPair);
    const nonnegative = values.map(Math.abs), budget = random(16);
    let longest = 0;
    for (let left = 0; left < values.length; left++) for (let right = left; right < values.length; right++) if (nonnegative.slice(left, right + 1).reduce((sum, value) => sum + value, 0) <= budget) longest = Math.max(longest, right - left + 1);
    assert.equal(window({ values: nonnegative, budget }), longest);
    const queries: [number, number][] = [];
    for (let left = 0; left < values.length; left++) for (let right = left; right < values.length; right++) queries.push([left, right]);
    assert.deepEqual(prefix({ values, queries }), queries.map(([left, right]) => values.slice(left, right + 1).reduce((sum, value) => sum + value, 0)));
    assert.deepEqual(next({ values }), values.map((value, i) => values.slice(i + 1).find(other => other > value) ?? null));
    const found = sorted.findIndex(value => value >= target);
    assert.equal(threshold({ values: sorted, threshold: target }), found === -1 ? values.length : found);
    const k = random(12);
    assert.deepEqual(top({ values, k }), [...values].sort((a, b) => b - a).slice(0, k));
    let longestSequence = 0;
    for (let mask = 0; mask < 2 ** values.length; mask++) {
      const selected = values.filter((_, i) => mask & 2 ** i);
      if (selected.every((value, i) => i === 0 || selected[i - 1] <= value)) longestSequence = Math.max(longestSequence, selected.length);
    }
    assert.equal(route({ values }), longestSequence);
    const value = random(0x80000000);
    assert.equal(bits({ value }), value.toString(2).replace(/0/g, '').length);
  }
  assert.equal(bits({ value: 2147483647 }), 31);
  assert.equal(bits({ value: 1073741824 }), 1);
  assert.equal(window({ values: [0, 0, 0, 1, 0], budget: 0 }), 3);
  assert.equal(route({ values: [2, 2, 2, 2] }), 4);
  assert.deepEqual(prefix({ values: [1000000, 1000000, -1000000], queries: [[0, 2], [1, 1]] }), [1000000, 1000000]);
});

test('interval, shipping, combinatorial and trie references agree with independent exhaustive choices', () => {
  const random = seededRandom(423981);
  const merge = reference('alg-merge-slots'), choose = reference('alg-choose-slots'), shipping = reference('alg-peak-workload');
  const subset = reference('alg-subset-loads'), coins = reference('alg-min-coins'), directory = reference('alg-prefix-directory');
  for (let iteration = 0; iteration < 100; iteration++) {
    const intervals = Array.from({ length: random(8) }, () => { const start = random(11) - 5; return [start, start + random(5) + 1]; });
    const pending = intervals.map(interval => [...interval]);
    let changed = true;
    while (changed) {
      changed = false;
      outer: for (let i = 0; i < pending.length; i++) for (let j = i + 1; j < pending.length; j++) {
        if (Math.max(pending[i][0], pending[j][0]) <= Math.min(pending[i][1], pending[j][1])) {
          pending[i] = [Math.min(pending[i][0], pending[j][0]), Math.max(pending[i][1], pending[j][1])];
          pending.splice(j, 1); changed = true; break outer;
        }
      }
    }
    assert.deepEqual(merge({ intervals }), pending.sort((a, b) => a[0] - b[0]));
    let compatible = 0;
    for (let mask = 0; mask < 2 ** intervals.length; mask++) {
      const selected = intervals.filter((_, i) => mask & 2 ** i).sort((a, b) => a[0] - b[0]);
      if (selected.every((interval, i) => i === 0 || selected[i - 1][1] <= interval[0])) compatible = Math.max(compatible, selected.length);
    }
    assert.equal(choose({ intervals }), compatible);
    const loads = Array.from({ length: random(8) }, () => random(8) + 1), days = random(10) + 1;
    let capacity = 0;
    if (loads.length) for (capacity = Math.max(...loads); capacity <= loads.reduce((sum, value) => sum + value, 0); capacity++) {
      let usedDays = 1, current = 0;
      for (const load of loads) { if (current + load > capacity) { usedDays++; current = 0; } current += load; }
      if (usedDays <= days) break;
    }
    assert.equal(shipping({ loads, days }), capacity);
    const values = [...new Set(Array.from({ length: random(7) }, () => random(25) - 12))];
    assert.deepEqual(subset({ values }), subsets(values));
    const denominations = [...new Set(Array.from({ length: random(5) }, () => random(9) + 1))], target = random(25);
    const distance = new Array<number>(target + 1).fill(-1), frontier = [0];
    distance[0] = 0;
    for (let cursor = 0; cursor < frontier.length; cursor++) for (const coin of denominations) {
      const amount = frontier[cursor] + coin;
      if (amount <= target && distance[amount] === -1) { distance[amount] = distance[frontier[cursor]] + 1; frontier.push(amount); }
    }
    assert.equal(coins({ denominations, target }), distance[target]);
    const words = [...new Set(Array.from({ length: random(10) }, () => Array.from({ length: random(5) }, () => 'abc'[random(3)]).join('')))];
    const prefix = ['', 'a', 'ab', 'b', 'z'][random(5)];
    assert.deepEqual(directory({ words, prefix }), words.filter(word => word.startsWith(prefix)).sort());
  }
  assert.deepEqual(merge({ intervals: [[1, 2], [2, 2], [2, 3]] }), [[1, 3]]);
  assert.equal(choose({ intervals: [[1, 2], [2, 3]] }), 2);
  assert.deepEqual(subset({ values: [2, 10, -1, -20] }), subsets([2, 10, -1, -20]));
  assert.deepEqual(directory({ words: ['', 'a', 'ab'], prefix: '' }), ['', 'a', 'ab']);
});

test('graph references agree with independent distance, reachability and permutation oracles', () => {
  const random = seededRandom(8331);
  const route = reference('alg-network-route'), clusters = reference('alg-cluster-count'), release = reference('alg-release-order');
  function firstValidOrder(vertices: number, edges: number[][]): number[] | undefined {
    const visit = (path: number[], remaining: number[]): number[] | undefined => {
      if (!remaining.length) return edges.every(([from, to]) => path.indexOf(from) < path.indexOf(to)) ? path : undefined;
      for (const value of remaining) {
        const result = visit([...path, value], remaining.filter(other => other !== value));
        if (result) return result;
      }
      return undefined;
    };
    return visit([], Array.from({ length: vertices }, (_, i) => i));
  }
  for (let iteration = 0; iteration < 100; iteration++) {
    const vertices = random(6) + 1, edges: number[][] = [];
    for (let from = 0; from < vertices; from++) for (let to = 0; to < vertices; to++) if (random(5) === 0) edges.push([from, to]);
    if (edges.length && iteration % 3 === 0) edges.push([...edges[0]]);
    const distance = Array.from({ length: vertices }, (_, from) => Array.from({ length: vertices }, (_, to) => from === to ? 0 : Infinity));
    for (const [from, to] of edges) distance[from][to] = Math.min(distance[from][to], 1);
    for (let through = 0; through < vertices; through++) for (let from = 0; from < vertices; from++) for (let to = 0; to < vertices; to++) distance[from][to] = Math.min(distance[from][to], distance[from][through] + distance[through][to]);
    const start = random(vertices), goal = random(vertices);
    assert.equal(route({ vertices, edges, start, goal }), Number.isFinite(distance[start][goal]) ? distance[start][goal] : -1);
    const reached = new Set<number>();
    let components = 0;
    for (let start = 0; start < vertices; start++) if (!reached.has(start)) {
      components++; reached.add(start);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [from, to] of edges) {
          if (reached.has(from) && !reached.has(to)) { reached.add(to); changed = true; }
          if (reached.has(to) && !reached.has(from)) { reached.add(from); changed = true; }
        }
      }
    }
    assert.equal(clusters({ vertices, edges }), components);
    if (vertices <= 5) assert.deepEqual(release({ vertices, edges }), firstValidOrder(vertices, edges) ?? []);
    const order = Array.from({ length: vertices }, (_, i) => (i + iteration) % vertices);
    const dag: number[][] = [];
    for (let from = 0; from < vertices; from++) for (let to = from + 1; to < vertices; to++) if (random(3) === 0) dag.push([order[from], order[to]]);
    if (vertices <= 5) assert.deepEqual(release({ vertices, edges: dag }), firstValidOrder(vertices, dag));
  }
  assert.deepEqual(release({ vertices: 0, edges: [] }), []);
  assert.equal(clusters({ vertices: 0, edges: [] }), 0);
  assert.equal(route({ vertices: 3, edges: [[0, 0], [0, 1], [0, 1]], start: 0, goal: 2 }), -1);
});

test('structural references handle independent bracket, chain, tree, matrix and identifier cases', () => {
  const random = seededRandom(482194);
  const balanced = reference('alg-balanced-signals'), reverse = reference('alg-chain-reverse'), cycle = reference('alg-chain-cycle');
  const depth = reference('alg-tree-depth'), sums = reference('alg-level-sums'), islands = reference('alg-island-count'), frequent = reference('alg-frequent-tags');
  type Chain = { value: number; next: Chain | null };
  type Tree = { value: number; left: Tree | null; right: Tree | null };
  for (let iteration = 0; iteration < 100; iteration++) {
    const signals = Array.from({ length: random(25) }, () => '()[]{}'[random(6)]).join('');
    let reduced = signals, previous: string;
    do { previous = reduced; reduced = reduced.replace(/\(\)|\[\]|\{\}/g, ''); } while (reduced !== previous);
    assert.equal(balanced({ signals }), reduced.length === 0);
    const values = Array.from({ length: random(10) }, () => random(21) - 10);
    const chain = (items: number[]) => items.reduceRight<Chain | null>((next, value) => ({ value, next }), null);
    assert.deepEqual(reverse({ head: chain(values) }), chain([...values].reverse()));
    const next = values.map(() => random(values.length + 1) - 1), head = values.length ? random(values.length + 1) - 1 : -1;
    let position = head;
    const visited = new Set<number>();
    while (position !== -1 && !visited.has(position)) { visited.add(position); position = next[position]; }
    assert.equal(cycle({ values, next, head }), position !== -1);
    const makeTree = (remainingDepth: number): Tree | null => remainingDepth === 0 || random(4) === 0 ? null : ({ value: random(21) - 10, left: makeTree(remainingDepth - 1), right: makeTree(remainingDepth - 1) });
    const root = makeTree(5), levels: number[] = [];
    const visit = (node: Tree | null, level: number) => {
      if (!node) return;
      levels[level] = (levels[level] || 0) + node.value;
      visit(node.left, level + 1); visit(node.right, level + 1);
    };
    visit(root, 0);
    assert.equal(depth({ root }), levels.length);
    assert.deepEqual(sums({ root }), levels);
    const rows = random(5), columns = random(5), grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => random(2)));
    const cells = grid.flatMap((row, r) => row.flatMap((value, c) => value === 1 ? [[r, c]] : []));
    const reachable = cells.map(([r, c]) => cells.map(([otherR, otherC]) => Math.abs(r - otherR) + Math.abs(c - otherC) <= 1));
    for (let through = 0; through < cells.length; through++) for (let from = 0; from < cells.length; from++) for (let to = 0; to < cells.length; to++) reachable[from][to] ||= reachable[from][through] && reachable[through][to];
    const grouped = new Set<number>();
    let count = 0;
    for (let from = 0; from < cells.length; from++) if (!grouped.has(from)) {
      count++;
      for (let to = 0; to < cells.length; to++) if (reachable[from][to]) grouped.add(to);
    }
    assert.equal(islands({ grid }), count);
    const choices = ['alpha', 'Zed', '__proto__', 'constructor', 'A_1', '_'], tags = Array.from({ length: random(15) }, () => choices[random(choices.length)]);
    const expected = [...new Set(tags)].map(tag => [tag, tags.filter(other => other === tag).length] as [string, number]).sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
    assert.deepEqual(frequent({ tags }), expected);
  }
  assert.equal(balanced({ signals: '([)]' }), false);
  assert.equal(balanced({ signals: '(()[]){}' }), true);
  assert.equal(cycle({ values: [1, 2, 3], next: [-1, 2, 1], head: 0 }), false);
  assert.equal(cycle({ values: [1, 2, 3], next: [-1, 2, 1], head: 1 }), true);
  assert.equal(islands({ grid: [[1, 0], [0, 1]] }), 2);
  assert.deepEqual(frequent({ tags: ['constructor', '__proto__', 'constructor', 'A'] }), [['constructor', 2], ['A', 1], ['__proto__', 1]]);
  let root: Tree | null = null;
  for (let i = 0; i < 1000; i++) root = { value: i, left: root, right: null };
  assert.equal(depth({ root }), 1000);
  assert.deepEqual(sums({ root }), Array.from({ length: 1000 }, (_, i) => 999 - i));
});
