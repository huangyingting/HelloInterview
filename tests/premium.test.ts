import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { companies, levels, problems, quizTopics } from '../shared/catalog';
import { emptyState } from '../shared/domain';
import { gradeQuestionSet } from '../server/content/grading';
import { chooseQuestions, companyProblems, companyTracks, customQuestionPool, makePlanTasks, mockReport, mockTurnProblem, nextMockQuestion, planTaskComplete, projectPatch, sourcePathIssue } from '../shared/premium';
import type { MockSession, ProjectFile, StudyPlan } from '../shared/types';

test('company curation and all generated schedules reference valid original resources', () => {
  assert.deepEqual(Object.keys(companyTracks).sort(), [...companies].sort());
  for (const company of companies) {
    assert.ok(companyProblems(company).length);
    for (const level of levels) for (const weeks of [2, 4]) for (const pace of [3, 5]) {
      const tasks = makePlanTasks(company, level, weeks, pace, '2026-12-28', emptyState());
      assert.equal(tasks.length, weeks * pace);
      assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
      assert.equal(new Set(tasks.map(t => t.day)).size, tasks.length);
      const lessonResources = tasks.filter(t => t.kind === 'lesson').map(t => t.resource);
      assert.equal(new Set(lessonResources).size, lessonResources.length);
      const quizResources = tasks.filter(t => t.kind === 'quiz').map(t => t.resource);
      assert.equal(new Set(quizResources).size, quizResources.length);
      for (const task of tasks) {
        if (task.kind === 'quiz') assert.ok(quizTopics.some(t => t.id === task.resource));
        if (task.kind === 'practice' || task.kind === 'mock') assert.ok(problems.some(p => p.id === task.resource));
        assert.ok(!Number.isNaN(Date.parse(task.day)));
      }
      assert.ok(companyProblems('Google').some(p => p.track === 'ai-coding'));
    }
  }
  assert.throws(() => makePlanTasks('Meta', 'Senior', 2, 3, '2026-02-30', emptyState()), /valid start date/);
  assert.throws(() => makePlanTasks('Meta', 'Senior', 3, 4, '2026-10-08', emptyState()), /Invalid preparation/);
});
test('mock follow-up changes with topic gaps and does not repeat a focused topic', () => {
  const problem = problems.find(p => p.id === 'job-scheduler')!;
  const feedback = { source: 'rubric' as const, score: 25, strengths: [], improvements: [], summary: 'Local fixture.' };
  const session: MockSession = { id: 'mock', problemId: problem.id, company: 'Meta', level: 'Staff', length: 5, question: '', focus: -1, draft: '', revision: 0, createdAt: '', turns: [{ focus: -1, question: '', answer: 'A queue partition retries with backoff, and metrics reveal lag.', feedback }] };
  const question = nextMockQuestion(problem, session);
  assert.equal(question.focus, 0);
  assert.match(question.question, /lease/);
  assert.match(question.question, /wider impact/);
  session.turns.push({ focus: 0, question: question.question, answer: 'An owner lease uses fencing tokens and a lock.', feedback });
  assert.equal(nextMockQuestion(problem, session).focus, 1);
  session.focus = 1;
  const focused = mockTurnProblem(problem, session);
  assert.deepEqual(focused.keywords, [problem.keywords[1]]);
  assert.equal(mockReport(session).score, 25);
  assert.deepEqual(mockReport(session).sources, ['rubric']);
});
test('custom quiz selection is unique, bounded and canonically graded', () => {
  const state = emptyState(), pool = customQuestionPool(['api-design', 'caching'], 'all', state);
  const ids = chooseQuestions(pool.map(q => q.id), 4, () => 0.25);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every(id => pool.some(q => q.id === id)));
  assert.throws(() => chooseQuestions(ids, 5), /matching questions/);
  assert.throws(() => gradeQuestionSet(ids, { unknown: 1 }), /does not belong/);
  assert.throws(() => gradeQuestionSet([ids[0], ids[0]], {}), /Invalid/);
  state.review = ['api-1', 'cache-1'];
  assert.deepEqual(customQuestionPool(['api-design'], 'missed', state).map(q => q.id), ['api-1']);
  assert.equal(gradeQuestionSet(['api-1'], { 'api-1': 1 }).score, 1);
  assert.deepEqual(gradeQuestionSet(['api-1'], { 'api-1': -1 }).missed, ['api-1']);
});
test('plan progress uses actual completion and missed questions influence the schedule', () => {
  const state = emptyState();
  state.review = ['cache-1'];
  const tasks = makePlanTasks('Meta', 'Senior', 2, 5, '2026-10-08', state);
  assert.equal(tasks[1].resource, 'caching');
  const plan: StudyPlan = { id: 'plan', company: 'Meta', level: 'Senior', weeks: 2, sessionsPerWeek: 5, tasks, createdAt: '' };
  assert.equal(planTaskComplete(tasks[0], plan, state), false);
  state.read.push(tasks[0].resource);
  assert.equal(planTaskComplete(tasks[0], plan, state), true);
  assert.equal(planTaskComplete(tasks[3], plan, state), false);
  tasks[3].note = 'I would verify the failure boundary before adding another cache.';
  assert.equal(planTaskComplete(tasks[3], plan, state), true);
});
test('source import rejects traversal, credential/generated paths and unsupported files', () => {
  for (const file of ['../.cred', '/tmp/code.js', '.env', '.env.local', '.cred.json', '.git/config', 'node_modules/a.js', 'data/export.json', 'secrets.json', 'credentials.json', 'private.pem', 'a//b.js', 'a b.js']) assert.ok(sourcePathIssue(file), file);
  for (const file of ['src/index.ts', 'tests/events.test.js', 'README.md', 'package.json', 'main.py']) assert.equal(sourcePathIssue(file), null, file);
});
test('exported patches apply exactly, including added/deleted files and newline boundaries', () => {
  const cases: ProjectFile[][] = [
    [{ path: 'events.js', original: 'one\ntwo\nthree\n', content: 'one\nchanged\nthree\n' }],
    [{ path: 'a.js', original: 'hello', content: 'hello\n' }],
    [{ path: 'a.js', original: 'hello\n', content: 'hello' }],
    [{ path: 'a.js', original: 'same\nlast', content: 'changed\nlast' }],
    [{ path: 'src/new.js', original: null, content: 'new\n' }, { path: 'old.js', original: 'old\n', content: null }],
    [{ path: 'empty.js', original: null, content: '' }],
    [{ path: 'empty.js', original: '', content: null }],
    [{ path: 'a.js', original: 'a\r\nb\r\n', content: 'a\r\nc\r\n' }],
    [{ path: 'a.js', original: 'a\r\nb\r\n', content: 'a\nc\n' }],
    [{ path: 'a.js', original: '\ufeffconst value = 1;\n', content: '\ufeffconst value = 2;\n' }],
    [{ path: 'a.js', original: '', content: '\n' }],
  ];
  for (const files of cases) {
    const directory = mkdtempSync(path.join(tmpdir(), 'studio-patch-'));
    try {
      execFileSync('git', ['-C', directory, 'init', '--quiet']);
      for (const file of files) if (file.original !== null) {
        mkdirSync(path.dirname(path.join(directory, file.path)), { recursive: true });
        writeFileSync(path.join(directory, file.path), file.original);
      }
      const patch = projectPatch(files);
      execFileSync('git', ['-C', directory, 'apply', '--check', '-'], { input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
      execFileSync('git', ['-C', directory, 'apply', '-'], { input: patch, stdio: ['pipe', 'pipe', 'pipe'] });
      for (const file of files) {
        if (file.content === null) assert.equal(existsSync(path.join(directory, file.path)), false);
        else assert.equal(readFileSync(path.join(directory, file.path), 'utf8'), file.content);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
