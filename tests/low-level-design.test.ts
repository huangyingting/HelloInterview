import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext, Script } from 'node:vm';
import { problems, quizQuestions, quizTopics, tracks } from '../shared/catalog';
import { lowLevelDesignQuestions } from '../shared/content/low-level-design-questions';
import { contentSources } from '../shared/content/sources';
import { courses } from '../shared/courses';
import { gradeQuiz } from '../server/content/grading';
import type { ContentSection } from '../shared/types';

const lessons = tracks.find(track => track.id === 'low-level-design')!.lessons;
const exercises = problems.filter(problem => problem.track === 'low-level-design');
const topics = quizTopics.filter(topic => topic.track === 'low-level-design');
const questions = quizQuestions.filter(question => topics.some(topic => topic.id === question.topic));
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const prose = (sections: ContentSection[]) => sections.flatMap(section => [section.body, ...(section.bullets ?? [])]).join(' ');
const normalize = (text: string) => text.trim().replace(/\s+/g,' ').toLowerCase();

function reference(id: string) {
  const context = createContext({ input: null });
  new Script(exercises.find(problem => problem.id === id)!.solution!.code).runInContext(context, { timeout: 1000 });
  const call = new Script('solve(input)');
  return (input: unknown) => {
    context.input = structuredClone(input);
    const before = JSON.stringify(context.input);
    const result: unknown = call.runInContext(context, { timeout: 1000 });
    assert.equal(JSON.stringify(context.input), before, `${id}: input mutation`);
    return JSON.parse(JSON.stringify(result)) as unknown;
  };
}

test('LLD scope has deep lessons, sourced worked models, resolved resources and a 28-step course', () => {
  assert.equal(lessons.length,12);
  assert.equal(exercises.length,8);
  assert.equal(topics.length,8);
  assert.equal(questions.length,80);
  assert.equal(lowLevelDesignQuestions.length,77);
  assert.equal(Object.keys(contentSources).length,55);
  assert.equal(courses.length,13);
  for (const lesson of lessons) {
    assert.ok(words(prose(lesson.sections)) >= 500, lesson.id);
    assert.ok(lesson.sections.length >= 4);
    assert.ok(lesson.objectives && lesson.objectives.length >= 3);
    assert.equal(lesson.minutes,Math.max(3,Math.ceil(words(prose(lesson.sections))/200)));
    assert.ok(lesson.sourceIds && lesson.sourceIds.length >= 2);
    for (const id of lesson.sourceIds) assert.ok(Object.hasOwn(contentSources,id));
    assert.ok(topics.some(topic => topic.id === lesson.quizTopic));
    assert.ok(lesson.relatedProblemIds?.length);
    for (const id of lesson.relatedProblemIds) assert.ok(exercises.some(problem => problem.id === id));
  }
  for (const problem of exercises) {
    const solution = problem.solution!;
    assert.ok(words(prose(solution.sections)) >= 350,problem.id);
    assert.ok(solution.timeComplexity && solution.spaceComplexity);
    assert.ok(solution.sections.some(section => section.diagram?.includes('\n')));
    assert.equal(solution.examples!.length,6);
    assert.equal(new Set(solution.examples!.map(example => example.label)).size,6);
    assert.equal(new Set(solution.examples!.map(example => JSON.stringify(example.input))).size,6);
    for (const id of solution.lessonIds) assert.ok(lessons.some(lesson => lesson.id === id));
    assert.ok(solution.sourceIds.length);
    for (const id of solution.sourceIds) assert.ok(Object.hasOwn(contentSources,id));
  }
  const steps = courses.find(course => course.id === 'low-level-design-complete')!.units.flatMap(unit => unit.steps);
  assert.equal(steps.length,28);
  assert.equal(new Set(steps.map(step => step.id)).size,28);
  assert.equal(steps.filter(step => step.type === 'video').length,0);
  for (const lesson of lessons) assert.ok(steps.some(step => step.resource === `low-level-design/${lesson.id}`));
  for (const topic of topics) assert.ok(steps.some(step => step.type === 'quiz' && step.resource === topic.id));
  for (const problem of exercises) assert.ok(steps.some(step => step.type === 'practice' && step.resource === problem.id));
});

test('original briefs, gates, answer ordering and old course remain compatible', () => {
  assert.deepEqual(lessons.filter(lesson => lesson.premium).map(lesson => lesson.id),['concurrency']);
  assert.deepEqual(exercises.filter(problem => problem.premium).map(problem => problem.id),['rate-limiter']);
  for (const id of ['parcel-lockers','parking-garage','board-game','rate-limiter']) {
    const problem = exercises.find(problem => problem.id === id)!;
    assert.equal(problem.testCases,undefined,'Do not reinterpret open-ended starters as solve acceptance harnesses');
    assert.ok(problem.solution!.examples);
  }
  assert.equal(exercises.find(problem => problem.id === 'parcel-lockers')!.starter,'class Locker {\n  constructor(id, size) {\n    this.id = id;\n    this.size = size;\n    this.package = null;\n  }\n}\n\n// Design allocation and pickup operations here.\n');
  for (const problem of exercises.filter(problem => problem.id.startsWith('lld-'))) {
    assert.match(problem.starter!,/function solve\(input\)/);
    assert.deepEqual(problem.testCases,problem.solution!.examples);
  }
  const originals = [
    ['object-1','What is a useful sign of high cohesion?',['A class owns unrelated concerns','Related responsibilities change together','Every method is static','There are no tests'],1],
    ['object-2','Which dependency direction improves domain testability?',['Domain logic depends on a concrete remote service','Domain logic depends on a small contract implemented by adapters','All layers import each other','Tests always require production data'],1],
    ['object-3','When is composition particularly helpful?',['When policies vary independently','When every class needs a deeper hierarchy','When all interfaces must be removed','When behavior should be hidden from tests'],0],
  ] as const;
  for (const [id,prompt,options,correct] of originals) {
    const question = questions.find(question => question.id === id)!;
    assert.equal(question.prompt,prompt);
    assert.deepEqual(question.options,[...options]);
    assert.equal(question.correct,correct);
  }
  assert.deepEqual(courses.find(course => course.id === 'low-level-design')!.units.flatMap(unit => unit.steps).map(step => step.id),['low-level-design-introduction','video-low-level-design','low-level-design-design-principles','quiz-design-principles','low-level-design-state-machines','practice-parcel-lockers']);
});

test('LLD questions have substantive explanations, distinct choices, difficulty coverage and canonical grading', () => {
  assert.equal(new Set(questions.map(question => question.id)).size,80);
  assert.equal(new Set(questions.map(question => normalize(question.prompt))).size,80);
  for (const question of questions) {
    assert.equal(question.options.length,4);
    assert.equal(new Set(question.options.map(normalize)).size,4,question.id);
    assert.ok(words(question.explanation) >= 45,question.id);
    assert.ok(Number.isInteger(question.correct) && question.correct >= 0 && question.correct < 4);
    assert.ok(['Easy','Medium','Hard'].includes(question.difficulty!));
    assert.ok(question.sourceIds?.length);
    for (const id of question.sourceIds) assert.ok(Object.hasOwn(contentSources,id));
  }
  for (const topic of topics) {
    const pool = questions.filter(question => question.topic === topic.id);
    assert.equal(pool.length,10);
    assert.equal(topic.count,10);
    assert.ok(pool.filter(question => question.difficulty === 'Easy').length >= 2);
    assert.ok(pool.filter(question => question.difficulty === 'Hard').length >= 2);
    assert.deepEqual(gradeQuiz(topic.id,Object.fromEntries(pool.map(question => [question.id,question.correct]))),{score:10,total:10,missed:[]});
  }
  for (let i=0;i<4;i++) assert.ok(lowLevelDesignQuestions.filter(question => question.correct === i).length >= 19);
});

test('all 48 literal examples match trusted references, browser serialization and repeated calls', () => {
  for (const problem of exercises) {
    const solve = reference(problem.id), examples = problem.solution!.examples!;
    for (const example of [...examples,...[...examples].reverse()]) {
      const actual = solve(example.input);
      assert.deepEqual(actual,example.expected,`${problem.id}: ${example.label}`);
      assert.equal(JSON.stringify(actual),JSON.stringify(example.expected));
    }
  }
});

function random(seed: number) {
  return (bound: number) => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed%bound; };
}
type Row = (string | number)[];
type InventoryCommand = { op: 'reserve'; id: string; quantity: number } | { op: 'release' | 'commit'; id: string };
function inventoryOracle(units: number, commands: InventoryCommand[]) {
  const records: { id: string; quantity: number; status: string }[] = [], results: Row[] = [];
  const available = () => units-records.filter(record => record.status !== 'released').reduce((sum,record) => sum+record.quantity,0);
  for (const command of commands) {
    const record = records.find(record => record.id === command.id);
    if (command.op === 'reserve') {
      if (record && record.quantity !== command.quantity) results.push(['conflict']);
      else if (record) results.push(record.status === 'reserved' ? ['held',record.quantity] : ['closed',record.status]);
      else if (command.quantity > available()) results.push(['insufficient']);
      else { records.push({id:command.id,quantity:command.quantity,status:'reserved'}); results.push(['held',command.quantity]); }
    } else if (!record) results.push(['missing']);
    else if (record.status !== 'reserved') results.push(['closed',record.status]);
    else { record.status=command.op === 'release' ? 'released' : 'committed'; results.push([record.status,record.quantity]); }
  }
  const committed = records.filter(record => record.status === 'committed').reduce((sum,record) => sum+record.quantity,0);
  const reserved = records.filter(record => record.status === 'reserved').reduce((sum,record) => sum+record.quantity,0);
  assert.equal(units,available()+reserved+committed);
  assert.ok(available() >= 0 && available() <= units);
  return { results,state:{available:available(),committed,reservations:records.sort((a,b) => a.id<b.id ? -1 : a.id>b.id ? 1 : 0).map(record => [record.id,record.quantity,record.status])} };
}

test('inventory histories agree with an independent recomputed accounting model at every prefix', () => {
  const rng=random(9171), solve=reference('lld-inventory-ledger'), ids=['a','b','constructor','__proto__'];
  for (let trial=0;trial<40;trial++) {
    const units=rng(20), commands: InventoryCommand[]=[];
    for (let i=0;i<30;i++) {
      const id=ids[rng(ids.length)], op=rng(3);
      commands.push(op===0 ? {op:'reserve',id,quantity:rng(10)+1} : {op:op===1 ? 'release' : 'commit',id});
      assert.deepEqual(solve({units,commands}),inventoryOracle(units,commands),`trace ${trial}, prefix ${i}`);
    }
  }
});

type CacheCommand = {op:'put';key:string;value:number} | {op:'get'|'peek';key:string};
function cacheOracle(capacity: number, commands: CacheCommand[]) {
  let entries: [string,number][]=[];
  const results: Row[]=[];
  for (const command of commands) {
    const index=entries.findIndex(([key]) => key===command.key);
    if (command.op==='put') {
      entries=entries.filter(([key]) => key!==command.key);
      entries.push([command.key,command.value]);
      entries=entries.slice(Math.max(0,entries.length-capacity));
      results.push(['stored']);
    } else if (index<0) results.push(['miss']);
    else {
      const record=entries[index];
      results.push(['hit',record[1]]);
      if (command.op==='get') { entries.splice(index,1); entries.push(record); }
    }
    assert.ok(entries.length<=capacity);
    assert.equal(new Set(entries.map(([key]) => key)).size,entries.length);
  }
  return {results,entries};
}

test('cache histories agree with an independent array-based recency oracle at every prefix', () => {
  const rng=random(1004), solve=reference('lld-lru-cache'), keys=['a','b','constructor','__proto__'];
  for (let trial=0;trial<40;trial++) {
    const capacity=rng(5), commands: CacheCommand[]=[];
    for (let i=0;i<30;i++) {
      const key=keys[rng(keys.length)], op=rng(3);
      commands.push(op===0 ? {op:'put',key,value:rng(7)-3} : {op:op===1 ? 'get' : 'peek',key});
      assert.deepEqual(solve({capacity,commands}),cacheOracle(capacity,commands),`trace ${trial}, prefix ${i}`);
    }
  }
});

type WorkflowCommand = { id:string; event:'submit'|'approve'|'cancel'; expectedVersion:number };
function workflowOracle(commands: WorkflowCommand[]) {
  const edges=[['draft','submit','submitted'],['draft','cancel','cancelled'],['submitted','approve','approved'],['submitted','cancel','cancelled']];
  const receipts: {command:WorkflowCommand;result:Row}[]=[];
  let state='draft',version=0;
  const results: Row[]=[];
  for (const command of commands) {
    const prior=receipts.find(receipt => receipt.command.id===command.id);
    if (prior) {
      results.push(prior.command.event===command.event && prior.command.expectedVersion===command.expectedVersion ? [...prior.result] : ['identity-conflict',state,version]);
      continue;
    }
    let result: Row;
    const edge=edges.find(([from,event]) => from===state && event===command.event);
    if (command.expectedVersion!==version) result=['stale',state,version];
    else if (!edge) result=['illegal',state,version];
    else { state=edge[2]; version++; result=['accepted',state,version]; }
    receipts.push({command:{...command},result:[...result]});
    results.push(result);
  }
  assert.ok(version<=2);
  return {results,state,version};
}

test('workflow histories agree with a declarative edge and historical receipt oracle', () => {
  const rng=random(2425), solve=reference('lld-workflow-engine'), ids=['a','b','c','__proto__'], events=['submit','approve','cancel'] as const;
  for (let trial=0;trial<40;trial++) {
    const commands: WorkflowCommand[]=[];
    for (let i=0;i<30;i++) {
      commands.push({id:ids[rng(ids.length)],event:events[rng(events.length)],expectedVersion:rng(4)});
      assert.deepEqual(solve({commands}),workflowOracle(commands),`trace ${trial}, prefix ${i}`);
    }
  }
});

type CatalogNode = {kind:'dir';children:Map<string,CatalogNode>} | {kind:'file';content:string};
type CatalogCommand = {op:'mkdir'|'read'|'list'|'remove';path:string} | {op:'write';path:string;content:string};
function catalogOracle(commands: CatalogCommand[]) {
  const root: CatalogNode={kind:'dir',children:new Map()}, results: unknown[]=[];
  const locate=(path: string): CatalogNode | undefined => {
    let node: CatalogNode | undefined=root;
    for (const name of path.split('/').filter(Boolean)) node=node?.kind==='dir' ? node.children.get(name) : undefined;
    return node;
  };
  for (const command of commands) {
    const node=locate(command.path), parts=command.path.split('/').filter(Boolean), name=parts.at(-1)!;
    const parent=locate(parts.length<=1 ? '/' : '/'+parts.slice(0,-1).join('/'));
    if (command.op==='read') results.push(!node ? ['not-found'] : node.kind==='dir' ? ['wrong-kind'] : ['content',node.content]);
    else if (command.op==='list') results.push(!node ? ['not-found'] : node.kind==='file' ? ['wrong-kind'] : ['children',[...node.children.keys()].sort()]);
    else if (command.op==='remove') {
      if (command.path==='/') results.push(['root-protected']);
      else if (!node) results.push(['not-found']);
      else if (node.kind==='dir' && node.children.size) results.push(['not-empty']);
      else { assert.ok(parent?.kind==='dir'); parent.children.delete(name); results.push(['removed']); }
    } else if (command.path==='/') results.push(command.op==='mkdir' ? ['exists'] : ['wrong-kind']);
    else if (!parent) results.push(['parent-missing']);
    else if (parent.kind==='file') results.push(['parent-not-directory']);
    else if (command.op==='mkdir') {
      if (node) results.push(['exists']);
      else { parent.children.set(name,{kind:'dir',children:new Map()}); results.push(['created']); }
    } else if (node?.kind==='dir') results.push(['wrong-kind']);
    else if (command.op==='write') { parent.children.set(name,{kind:'file',content:command.content}); results.push(['written']); }
    else assert.fail('Unexpected catalog oracle command');
  }
  const paths: [string,string][]=[];
  const walk=(node: CatalogNode,path: string) => {
    paths.push([path,node.kind]);
    if (node.kind==='dir') for (const [name,child] of node.children) walk(child,(path==='/' ? '' : path)+'/'+name);
  };
  walk(root,'/');
  paths.sort((a,b) => a[0]<b[0] ? -1 : a[0]>b[0] ? 1 : 0);
  return {results,paths};
}

test('catalog histories agree with an independent nested-tree oracle at every prefix', () => {
  const rng=random(4914), solve=reference('lld-file-catalog'), paths=['/','/a','/b','/a/x','/a/y','/b/x','/constructor','/constructor/z'], ops=['mkdir','read','list','remove','write'] as const;
  for (let trial=0;trial<40;trial++) {
    const commands: CatalogCommand[]=[];
    for (let i=0;i<30;i++) {
      const path=paths[rng(paths.length)],op=ops[rng(ops.length)];
      commands.push(op==='write' ? {op,path,content:rng(2) ? '' : 'text'} : {op,path});
      assert.deepEqual(solve({commands}),catalogOracle(commands),`trace ${trial}, prefix ${i}`);
    }
  }
});

test('reference-only models honor final-cell victory, exact expiry, pricing and hard key capacity boundaries', () => {
  const board=reference('board-game'), parcel=reference('parcel-lockers'), parking=reference('parking-garage'), limiter=reference('rate-limiter');
  const squares=[[0,0],[0,1],[1,1],[0,2],[1,2],[1,0],[2,1],[2,0],[2,2]];
  const game=board({moves:squares.map(([row,column],i) => ({player:i%2 ? 'O' : 'X',row,column}))}) as {results:unknown[];winner:string;draw:boolean};
  assert.deepEqual(game.results.at(-1),['won','X']);
  assert.equal(game.winner,'X');
  assert.equal(game.draw,false);
  assert.deepEqual(parcel({lockers:[{id:'a',size:1}],commands:[{op:'place',id:'p',size:1,at:4,expiresAt:4}]}),{results:[['invalid-expiry']],occupancy:[['a',null]]});
  for (const [duration,charge] of [[0,0],[1,7],[59999,7],[60000,7],[60001,14]]) {
    assert.deepEqual(parking({spaces:[{id:'a',size:1}],rateCents:7,commands:[{op:'enter',ticketId:'t',size:1,at:0},{op:'exit',ticketId:'t',at:duration}]}),{results:[['entered','a'],['closed',charge]],spaces:[['a',null]],tickets:[['t','closed',charge]]});
  }
  assert.deepEqual(limiter({limit:1,windowMs:10,maxKeys:1,requests:[{key:'a',at:0},{key:'a',at:1},{key:'b',at:2},{key:'b',at:10}]}),{results:[[true,0,'allowed'],[false,9,'rate'],[false,8,'capacity'],[true,0,'allowed']],activeKeys:['b']});
});
