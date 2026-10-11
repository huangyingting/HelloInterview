import {test,expect} from './browser-fixtures';
import {quizQuestions,tracks} from '../shared/catalog';
import type {QuizSessionView} from '../shared/types';

async function demo(page:import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button',{name:'Try the local demo',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Good to see you, Alex.'})).toBeVisible();
}
test('checking commits one server-issued answer and reload resumes without downloading unearned keys',async({page})=>{
  await demo(page);
  await page.goto('/quiz/api-design');
  const issued=page.waitForResponse(response=>response.url().endsWith('/api/quiz-sessions')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Start quiz',exact:true}).click();
  const session:QuizSessionView=await(await issued).json();
  expect(JSON.stringify(session)).not.toContain('"correct":');
  expect(JSON.stringify(session)).not.toContain('"explanation":');
  const questions=quizQuestions.filter(question=>question.topic==='api-design');
  await page.getByRole('radio').nth(questions[0].correct).check();
  await page.getByRole('button',{name:'Check answer',exact:true}).click();
  await expect(page.locator('.quiz-answer-explanation')).toContainText(questions[0].explanation);
  expect((await page.request.get(`/api/quiz-reports/${session.id}`)).status()).toBe(404);
  await page.reload();
  await expect(page.locator('h1')).toHaveText(questions[1].prompt);
  await expect(page.locator('.quiz-answer-explanation')).toHaveCount(0);
  const resumed:QuizSessionView=await(await page.request.get(`/api/quiz-sessions/${session.id}`)).json();
  expect(resumed.answered).toBe(1);
  expect(resumed.revision).toBe(1);
  await page.goto('/quiz');
  await expect(page.getByRole('link',{name:'Designing useful APIs Resume'})).toHaveAttribute('href',`/quiz/api-design?session=${session.id}`);
});
test('private development modules are denied and paid readers retry explicitly then close on expiry',async({page})=>{
  await demo(page);
  for(const route of ['/shared/catalog.ts','/shared/content/system-design-lessons.ts','/server/content/repository.ts','/server/media/concurrency.vtt']) {
    const response=await page.request.get(route);
    expect(response.status()).toBe(403);
  }
  await page.request.post('/api/plan',{data:{plan:'month'}});
  await page.reload();
  const paid=tracks.flatMap(track=>track.lessons.map(lesson=>({track,lesson}))).find(item=>item.lesson.premium)!;
  let fail=true;
  await page.route(`**/api/content/lessons/${paid.track.id}/${paid.lesson.id}`,async route=>{
    if(fail){await route.fulfill({status:503,json:{error:'Synthetic content outage.'}});}
    else await route.continue();
  });
  await page.goto(`/learn/${paid.track.id}/${paid.lesson.id}`);
  await expect(page.getByRole('alert')).toContainText('Synthetic content outage.');
  await expect(page.locator('.lesson-article')).toHaveCount(0);
  fail=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  for(const paragraph of paid.lesson.sections[0].body.split(/\n\s*\n/))await expect(page.locator('.lesson-article')).toContainText(paragraph);
  await page.request.delete('/api/plan');
  await page.reload();
  await expect(page.locator('.premium-gate')).toBeVisible();
  await expect(page.locator('.lesson-article')).toHaveCount(0);
});
test('premium video and captions use authorized delivery rather than static asset URLs',async({page})=>{
  await demo(page);
  await page.request.post('/api/plan',{data:{plan:'month'}});
  await page.goto('/learn/courses/concurrency/video/concurrency');
  await expect(page.locator('video source')).toHaveAttribute('src','/api/content/media/concurrency/concurrency.webm');
  await expect(page.locator('video track')).toHaveAttribute('src','/api/content/media/concurrency/concurrency.vtt');
  await expect.poll(()=>page.locator('video').evaluate((video:HTMLVideoElement)=>video.readyState)).toBeGreaterThanOrEqual(2);
  const caption=await page.request.get('/api/content/media/concurrency/concurrency.vtt');
  expect(caption.status()).toBe(200);
  expect(await caption.text()).toContain('Protect the whole operation');
  await page.request.delete('/api/plan');
  expect((await page.request.get('/api/content/media/concurrency/concurrency.vtt')).status()).toBe(403);
  await page.reload();
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('.premium-gate')).toBeVisible();
});
