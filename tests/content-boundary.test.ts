import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { problems, quizQuestions, tracks } from '../shared/catalog';
import * as metadata from '../shared/public-catalog';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import { localConnection } from '../server/db/connection';
import { ContentRepository } from '../server/content/repository';
import { StateRepository } from '../server/db/state-repository';
import type { Bootstrap, CustomQuiz, Lesson, QuestionPrompt, QuizQuestion, QuizReport, QuizSessionView, UserState } from '../shared/types';
import { HttpError } from '../server/http-error';
import { publishedQuestion } from '../server/content/schema';
import { contentSources } from '../shared/content/sources';

async function directory(t:TestContext) {
  const parent=path.resolve('data/content-tests');
  await mkdir(parent,{recursive:true});
  const folder=await mkdtemp(path.join(parent,'content-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  return folder;
}
async function fixture(t:TestContext) {
  const settings=loadConfig({NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',LOG_REQUESTS:'false',DATA_DIR:await directory(t)});
  let runtime=await startServer(settings);
  t.after(()=>runtime.close());
  return {get url(){return runtime.url;}, async restart(){await runtime.close();runtime=await startServer(settings);}};
}
async function api<T=Record<string,unknown>>(url:string,route:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST') {
  const response=await fetch(`${url}${route}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {response,value:await response.json() as T};
}
async function signup(url:string,name='Content Fixture') {
  const result=await api<Bootstrap>(url,'/api/auth/signup',{name,email:`${crypto.randomUUID()}@example.invalid`,password:'fixture-password-123'});
  assert.equal(result.response.status,200);
  return result.response.headers.get('set-cookie')!.split(';')[0];
}
function noKeys(value:unknown) {
  const source=JSON.stringify(value);
  assert.ok(!source.includes('"correct":'));
  assert.ok(!source.includes('"explanation":'));
}
test('public metadata and actual built artifacts exclude lesson bodies, solutions, answer keys and paid media',async()=>{
  for(const track of metadata.tracks)for(const lesson of track.lessons) {
    assert.ok(!('sections' in lesson));
    assert.ok(!('exercise' in lesson));
    assert.equal(lesson.title,tracks.find(item=>item.id===track.id)!.lessons.find(item=>item.id===lesson.id)!.title);
  }
  for(const problem of metadata.problems) {
    for(const key of ['keywords','solution','workedCase','requirements','starter','testCases'])assert.ok(!(key in problem),`${problem.id}: ${key}`);
    if(problem.premium)assert.equal(problem.description,`Premium practice: ${problem.title}.`);
  }
  noKeys(metadata);
  const entries=await readdir('dist/assets');
  const artifacts=(await Promise.all(entries.filter(file=>/\.(js|map|html)$/.test(file)).map(file=>readFile(`dist/assets/${file}`,'utf8')))).join('\n');
  const protectedTexts=[
    ...tracks.flatMap(track=>track.lessons.flatMap(lesson=>[lesson.exercise,...lesson.sections.map(section=>section.body)])),
    ...problems.flatMap(problem=>[problem.solution?.code,...(problem.workedCase?.followUps.map(item=>item.answer)??[])]).filter((value):value is string=>!!value),
    ...quizQuestions.map(question=>question.explanation),
  ];
  for(const text of protectedTexts.filter(value=>value.length>100)) {
    assert.ok(!artifacts.includes(JSON.stringify(text).slice(1,-1)),`Protected content found in browser assets: ${text.slice(0,60)}`);
  }
  await assert.rejects(stat('dist/media/concurrency.webm'),{code:'ENOENT'});
  await assert.rejects(stat('dist/media/concurrency.vtt'),{code:'ENOENT'});
  assert.ok((await stat('dist-server/media/concurrency.webm')).size>1000);
});
test('the build fails rather than silently bundling a new private catalog import',async()=>{
  await assert.rejects(build({
    logLevel:'silent',
    build:{write:false,rollupOptions:{input:path.resolve('shared/catalog.ts')}},
  }),/Private server content cannot enter the browser graph/);
});
test('corrupted published snapshots fail explicitly and are never replaced by current catalog bytes',async t=>{
  const db=localConnection(await directory(t));
  t.after(()=>db.close());
  const content=new ContentRepository(db),questions=[quizQuestions[0]],version=await content.pin(questions);
  await db.prepare('UPDATE content_versions SET value=? WHERE id=?').run('[]',version);
  await assert.rejects(content.questions(version,[questions[0].id]),/inconsistent/);
  await assert.rejects(content.pin(questions),/inconsistent/);
  assert.equal((await db.prepare('SELECT value FROM content_versions WHERE id=?').get(version))!.value,'[]');
});
test('server content, premium video ranges, ownership and expiry are authoritative without client gates',async t=>{
  const runtime=await fixture(t),cookie=await signup(runtime.url);
  const paid=tracks.flatMap(track=>track.lessons.map(lesson=>({track,lesson}))).find(item=>item.lesson.premium)!;
  const route=`/api/content/lessons/${paid.track.id}/${paid.lesson.id}`;
  assert.equal((await api(runtime.url,route)).response.status,401);
  assert.equal((await api(runtime.url,route,undefined,cookie)).response.status,403);
  assert.equal((await api(runtime.url,'/api/content/references/team-chat',undefined,cookie)).response.status,403);
  assert.equal((await api(runtime.url,'/api/content/problems/team-chat',undefined,cookie)).response.status,403);
  const free=await api<Lesson>(runtime.url,'/api/content/lessons/system-design/introduction');
  assert.equal(free.response.status,200);
  assert.equal(free.response.headers.get('cache-control'),'private, no-store');
  assert.match(free.response.headers.get('x-content-version')!,/^[a-f0-9]{64}$/);
  assert.equal(free.value.sections[0].body,tracks[0].lessons[0].sections[0].body);
  await api(runtime.url,'/api/plan',{plan:'month'},cookie);
  assert.equal((await api(runtime.url,route,undefined,cookie)).response.status,200);
  const brief=await api(runtime.url,'/api/content/problems/team-chat',undefined,cookie);
  for(const key of ['solution','workedCase','keywords'])assert.ok(!(key in brief.value));
  const range=await fetch(`${runtime.url}/api/content/media/concurrency/concurrency.webm`,{headers:{Cookie:cookie,Range:'bytes=0-127'}});
  assert.equal(range.status,206);
  assert.equal((await range.arrayBuffer()).byteLength,128);
  assert.equal(range.headers.get('cache-control'),'private, no-store');
  assert.equal((await api(runtime.url,'/api/content/media/concurrency/concurrency.vtt',undefined,'')).response.status,401);
  await api(runtime.url,'/api/plan',undefined,cookie,'DELETE');
  assert.equal((await api(runtime.url,route,undefined,cookie)).response.status,403);
  assert.equal((await api(runtime.url,'/api/content/media/concurrency/concurrency.webm',undefined,cookie)).response.status,403);
  for(const route of ['/media/concurrency.webm','/media/concurrency.vtt','/server/media/concurrency.webm']) {
    const response=await fetch(`${runtime.url}${route}`);
    assert.ok(!response.headers.get('content-type')?.includes('video'));
    assert.ok(!(await response.text()).includes('Protect the whole operation'));
  }
});
test('topic sessions reveal one checked answer, fence competing edits and retain the original report through content changes and restart',async t=>{
  const runtime=await fixture(t),cookie=await signup(runtime.url),other=await signup(runtime.url);
  const created=await api<QuizSessionView>(runtime.url,'/api/quiz-sessions',{topic:'api-design'},cookie);
  assert.equal(created.response.status,201);
  let session=created.value;
  const original=quizQuestions.filter(question=>question.topic==='api-design').map(question=>structuredClone(publishedQuestion(question)));
  const citation=contentSources['stripe-idempotency'],originalCitation=structuredClone(citation);
  Object.assign(citation,{url:'https://example.invalid/replacement-source'});
  t.after(()=>Object.assign(citation,originalCitation));
  noKeys(session);
  assert.equal((await api(runtime.url,`/api/quiz-sessions/${session.id}`,undefined,other)).response.status,404);
  assert.equal((await api(runtime.url,`/api/quiz-reports/${session.id}`,undefined,cookie)).response.status,404);
  assert.equal((await api(runtime.url,`/api/quiz-sessions/${session.id}/finish`,{revision:0},cookie)).response.status,400);
  assert.equal((await api(runtime.url,`/api/quiz-sessions/${session.id}/answer`,{revision:0,questionId:original[1].id,answer:0},cookie)).response.status,400);
  const changed=quizQuestions.find(question=>question.id===original[0].id)!;
  const before=structuredClone(changed);
  Object.assign(changed,{correct:(changed.correct+1)%changed.options.length,explanation:'Synthetic replacement, not the issued explanation.'});
  t.after(()=>Object.assign(changed,before));
  const competing=await Promise.all([0,1].map(()=>api<{session:QuizSessionView;feedback:QuizQuestion}>(runtime.url,`/api/quiz-sessions/${session.id}/answer`,{revision:0,questionId:original[0].id,answer:original[0].correct},cookie)));
  assert.deepEqual(competing.map(result=>result.response.status).sort(),[200,409]);
  const winner=competing.find(result=>result.response.status===200)!;
  assert.deepEqual(winner.value.feedback,original[0]);
  session=winner.value.session;
  noKeys(session);
  const partialExport=await api<{assessmentSessions:{answers:Record<string,number>;checkedQuestions:QuizQuestion[]}[]}>(runtime.url,'/api/export',undefined,cookie);
  assert.deepEqual(partialExport.value.assessmentSessions[0].answers,{[original[0].id]:original[0].correct});
  assert.deepEqual(partialExport.value.assessmentSessions[0].checkedQuestions,[original[0]]);
  await runtime.restart();
  const resumed=await api<QuizSessionView>(runtime.url,`/api/quiz-sessions/${session.id}`,undefined,cookie);
  assert.deepEqual(resumed.value,session);
  for(const question of original.slice(1)) {
    const answered=await api<{session:QuizSessionView;feedback:QuizQuestion}>(runtime.url,`/api/quiz-sessions/${session.id}/answer`,{revision:session.revision,questionId:question.id,answer:question.correct},cookie);
    assert.equal(answered.response.status,200);
    assert.deepEqual(answered.value.feedback,question);
    session=answered.value.session;
  }
  const result=await api<UserState>(runtime.url,`/api/quiz-sessions/${session.id}/finish`,{revision:session.revision},cookie);
  assert.equal(result.response.status,200);
  assert.equal(result.value.quizzes[0].score,original.length);
  const repeat=await api<UserState>(runtime.url,`/api/quiz-sessions/${session.id}/finish`,{revision:session.revision},cookie);
  assert.equal(repeat.value.recognition,result.value.recognition);
  const report=await api<QuizReport>(runtime.url,`/api/quiz-reports/${session.id}`,undefined,cookie);
  assert.deepEqual(report.value.questions,original);
  assert.equal(report.value.provenance,'versioned');
  assert.equal((await api(runtime.url,`/api/quiz-reports/${session.id}`,undefined,other)).response.status,404);
  const exported=await api<{quizReports:QuizReport[]}>(runtime.url,'/api/export',undefined,cookie);
  assert.deepEqual(exported.value.quizReports[0],report.value);
  assert.equal(report.response.headers.get('cache-control'),'private, no-store');
});
test('custom quizzes pin their selected order and keep cited reports after premium expiry',async t=>{
  const runtime=await fixture(t),cookie=await signup(runtime.url);
  await api(runtime.url,'/api/plan',{plan:'month'},cookie);
  const created=await api<{state:UserState;quiz:CustomQuiz}>(runtime.url,'/api/custom-quizzes',{title:'Pinned custom fixture',topics:['api-design'],mode:'all',count:2},cookie);
  let saved=created.value.state.customQuizzes[0];
  const original=saved.questionIds.map(id=>structuredClone(publishedQuestion(quizQuestions.find(question=>question.id===id)!)));
  const prompt=await api<QuestionPrompt>(runtime.url,`/api/custom-quizzes/${saved.id}/question`,undefined,cookie);
  noKeys(prompt.value);
  assert.equal(prompt.value.id,original[0].id);
  assert.equal((await api(runtime.url,`/api/quiz-reports/${saved.id}`,undefined,cookie)).response.status,404);
  const changed=quizQuestions.find(question=>question.id===original[0].id)!;
  const before=structuredClone(changed);
  changed.correct=(changed.correct+1)%4;
  t.after(()=>Object.assign(changed,before));
  for(const question of original) {
    const answer=await api<{state:UserState;feedback:QuizQuestion}>(runtime.url,`/api/custom-quizzes/${saved.id}/answer?feedback=true`,{revision:saved.revision,questionId:question.id,answer:question.correct},cookie);
    assert.equal(answer.response.status,200);
    assert.deepEqual(answer.value.feedback,question);
    saved=answer.value.state.customQuizzes[0];
  }
  const result=await api<UserState>(runtime.url,`/api/custom-quizzes/${saved.id}/finish`,{revision:saved.revision},cookie);
  assert.equal(result.value.customQuizzes[0].score,2);
  await api(runtime.url,'/api/plan',undefined,cookie,'DELETE');
  await runtime.restart();
  assert.equal((await api(runtime.url,`/api/custom-quizzes/${saved.id}/question`,undefined,cookie)).response.status,403);
  const report=await api<QuizReport>(runtime.url,`/api/quiz-reports/${saved.id}`,undefined,cookie);
  assert.equal(report.response.status,200);
  assert.deepEqual(report.value.questions,original);
});
test('legacy report diagnostics never prevent export of saved answers when current questions disappear',async t=>{
  const folder=await directory(t),db=localConnection(folder),states=new StateRepository(db),content=new ContentRepository(db);
  t.after(()=>db.close());
  await db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,?,?)').run('legacy','Legacy','legacy@example.invalid',null,0);
  const {emptyState}=await import('../shared/domain');
  const state=emptyState();
  state.quizzes.push({id:'legacy-report',topic:'removed-topic',answers:{'removed-question':1},score:1,total:1,completedAt:'2026-10-01'});
  await states.initialize('legacy',state);
  await assert.rejects(content.report('legacy-report',state.quizzes[0].answers,undefined,['removed-question'],1),error=>error instanceof HttpError&&error.status===409);
  assert.deepEqual((await states.read('legacy')).quizzes,state.quizzes);
  const runtime=await startServer(loadConfig({NODE_ENV:'production',HOST:'127.0.0.1',PORT:'0',LOG_REQUESTS:'false',DATA_DIR:folder}));
  t.after(()=>runtime.close());
  const cookie=await signup(runtime.url);
  const bootstrap=await api<Bootstrap>(runtime.url,'/api/bootstrap',undefined,cookie);
  await states.mutate(bootstrap.value.user!.id,current=>{current.quizzes=state.quizzes;});
  const exported=await api<{state:UserState;quizReports:QuizReport[]}>(runtime.url,'/api/export',undefined,cookie);
  assert.equal(exported.response.status,200);
  assert.deepEqual(exported.value.state.quizzes,state.quizzes);
  assert.deepEqual(exported.value.quizReports,[]);
});
