import { test, expect, type Page } from './browser-fixtures';
import { quizQuestions } from '../shared/catalog';

async function demo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good to see you, Alex.' })).toBeVisible();
}

test('public landing, original learning library, and navigation', async ({page}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'Great interviews start with a little practice.'})).toBeVisible();
  await page.getByRole('link', {name:'Explore free lessons'}).click();
  await expect(page.getByRole('heading', {name:'System Design',exact:true})).toBeVisible();
  await page.getByRole('link', {name:'Start learning'}).click();
  await expect(page.getByRole('heading', {name:'A practical design interview'})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Treat the design as a chain of decisions'})).toBeVisible();
  await expect(page.getByText('Original Studio lesson')).toBeVisible();
  expect(errors).toEqual([]);
});

test('local signup, sign out, login, profile and password update', async ({page}) => {
  const email=`local-${Date.now()}@example.test`;
  await page.goto('/login');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByLabel('Your name',{exact:true}).fill('Taylor');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('Original-pass-123');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Good to see you, Taylor.'})).toBeVisible();
  await page.goto('/account');
  await page.getByLabel('Display name').fill('Taylor Studio');
  await page.getByRole('button',{name:'Save profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile updated');
  await page.getByLabel('Current password',{exact:true}).fill('Original-pass-123');
  await page.getByLabel('New password',{exact:true}).fill('Changed-pass-456');
  await page.getByRole('button',{name:'Update password'}).click();
  await expect(page.getByRole('status')).toContainText('Password changed');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.goto('/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('Changed-pass-456');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Good to see you, Taylor.'})).toBeVisible();
});

test('target, learning progress, bookmark and comment survive reload', async ({page}) => {
  await demo(page);
  await page.getByRole('button',{name:'Add target',exact:true}).click();
  await page.getByLabel('Company',{exact:true}).fill('Google');
  await page.getByLabel('Interview date',{exact:true}).fill('2026-11-20');
  await page.getByRole('button',{name:'Save target'}).click();
  await expect(page.getByText('Google',{exact:true})).toBeVisible();
  await page.goto('/learn/system-design/caching');
  await page.getByRole('button',{name:'Bookmark lesson'}).click();
  await page.getByRole('button',{name:'Mark as read',exact:true}).click();
  await expect(page.getByRole('button',{name:'Completed',exact:true})).toBeVisible();
  await page.getByLabel('Add a comment',{exact:true}).fill('A concrete freshness budget makes this decision much clearer.');
  await page.getByRole('button',{name:'Post comment'}).click();
  await expect(page.getByText('A concrete freshness budget makes this decision much clearer.',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:'Completed',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Remove bookmark'})).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('link',{name:'Caching without surprises System Design'})).toBeVisible();
  await page.goto('/dashboard');
  await page.getByRole('button',{name:'Remove Google target'}).click();
  await expect(page.getByRole('heading',{name:'Give your preparation a destination.'})).toBeVisible();
});

test('algorithm visualizations step, reset and reject invalid input', async ({page}) => {
  await page.goto('/learn/code/two-pointers');
  await expect(page.getByText('1 + 13 = 14',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.getByText('3 + 13 = 16',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reset visualization'}).click();
  await expect(page.getByText('1 + 13 = 14',{exact:true})).toBeVisible();
  await page.getByLabel('Algorithm values').fill('3, 1, 2');
  await expect(page.getByRole('alert')).toContainText('sorted');
  await page.goto('/learn/code/sliding-window');
  await expect(page.getByText('Window sum = 8',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.getByText('Window sum = 7',{exact:true})).toBeVisible();
  await page.goto('/learn/code/graph-search');
  await expect(page.getByText('Visit node A',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.getByText('Visit node B',{exact:true})).toBeVisible();
});

test('system design canvas, save, feedback and history persist', async ({page}) => {
  await demo(page);
  await page.goto('/practice/system-design/short-links');
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  await page.getByRole('button',{name:'Add component',exact:true}).click();
  await expect(page.getByRole('button',{name:'Move Cache component',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Move Cache component',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('tab',{name:'Explanation',exact:true}).click();
  await page.getByLabel('Practice explanation').fill('I would validate the URL at a POST API endpoint, create a unique identifier and enforce collision handling in a database table. Cache redirects for low latency. Rate limit requests and validate destinations to prevent abuse. Handle failures explicitly and test retries.');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Draft saved');
  await page.reload();
  await expect(page.getByRole('button',{name:'Move Cache component',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Get feedback',exact:true}).click();
  await expect(page.getByText('Local rubric · not AI',{exact:true})).toBeVisible();
  await expect(page.getByText('A useful next step.',{exact:true})).toBeVisible();
  await page.goto('/history');
  await expect(page.getByRole('link',{name:/A short-link service/})).toBeVisible();
});

test('isolated JavaScript runner executes cases and terminates infinite loops', async ({page}) => {
  await demo(page);
  await page.goto('/practice/ai-coding/task-board');
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  await page.getByLabel('Code editor',{exact:true}).fill('function solve(input) { return input.filter(t => !t.completed).map(t => t.title).sort(); }');
  await page.getByRole('button',{name:'Run tests',exact:true}).click();
  await expect(page.getByText('PASS · Mixed tasks',{exact:true})).toBeVisible();
  await expect(page.getByText('PASS · Empty input',{exact:true})).toBeVisible();
  await expect(page.getByText('PASS · All completed',{exact:true})).toBeVisible();
  await page.getByLabel('Code editor',{exact:true}).fill('function solve(input) { while (true) {} }');
  await page.getByRole('button',{name:'Run tests',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('2-second limit');
  await expect(page.getByRole('button',{name:'Run tests',exact:true})).toBeEnabled();
});

test('code review supports line references and saved feedback', async ({page}) => {
  await demo(page);
  await page.goto('/practice/code-review/checkout-review');
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  await page.getByRole('button',{name:'Comment on line 2',exact:true}).click();
  await expect(page.getByLabel('Practice explanation')).toHaveValue('Line 2: ');
  await page.getByLabel('Practice explanation').fill('Line 2: Validate quantities and authorization before payment. Store money in integer units to avoid precision errors. Add an idempotent retry key to avoid duplicate charges. Use an atomic transaction for order persistence and test concurrency and provider failure.');
  await page.getByRole('button',{name:'Get feedback',exact:true}).click();
  await expect(page.getByText('Local rubric · not AI',{exact:true})).toBeVisible();
});

test('STAR story creation, editing and deletion persist', async ({page}) => {
  await demo(page);
  await page.goto('/learn/behavioral/stories');
  await page.getByRole('button',{name:'New story',exact:true}).click();
  await page.getByLabel('Story title',{exact:true}).fill('Clarifying a risky migration');
  for(const field of ['situation','task','action','result']) await page.getByLabel(field,{exact:true}).fill(`Specific ${field} with enough detail to recall my contribution.`);
  await page.getByRole('button',{name:'Save story',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Clarifying a risky migration'})).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Edit story',exact:false}).click();
  await page.getByLabel('result',{exact:true}).fill('The error rate fell by 20% and I learned to test the rollback earlier.');
  await page.getByRole('button',{name:'Save story',exact:true}).click();
  await page.getByRole('button',{name:'Delete story: Clarifying a risky migration'}).click();
  await expect(page.getByRole('heading',{name:'Every story starts somewhere'})).toBeVisible();
});

test('quiz scoring, history and review deck remove mastered questions', async ({page}) => {
  await demo(page);
  await page.goto('/quiz/api-design');
  await page.getByRole('button',{name:'Start quiz',exact:true}).click();
  const questions=quizQuestions.filter(q=>q.topic==='api-design');
  for(let i=0;i<questions.length;i++){
    await page.getByRole('radio').nth(i===0?(questions[i].correct+1)%4:questions[i].correct).check();
    await page.getByRole('button',{name:'Check answer',exact:true}).click();
    await expect(page.locator('.quiz-answer-explanation')).toBeVisible();
    await page.getByRole('button',{name:i===questions.length-1?'Finish quiz':'Next question',exact:true}).click();
  }
  await expect(page.locator('.result-score')).toHaveText(`${questions.length-1}/ ${questions.length}`);
  await page.goto('/quiz');
  await expect(page.getByText(/1 questions ready for another look/)).toBeVisible();
  await page.getByRole('link',{name:'Review now',exact:true}).click();
  await page.getByRole('button',{name:'Start quiz',exact:true}).click();
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button',{name:'Check answer',exact:true}).click();
  await page.getByRole('button',{name:'Finish quiz',exact:true}).click();
  await expect(page.getByRole('heading',{name:'A clear understanding.'})).toBeVisible();
  await page.goto('/quiz/review');
  await expect(page.getByRole('heading',{name:'Your review deck is clear.'})).toBeVisible();
});

test('community filtering, publishing, votes, follows and discussion are functional', async ({page}) => {
  await demo(page);
  await page.goto('/community/questions');
  await page.getByLabel('Company filter').selectOption('Google');
  await expect(page.getByRole('heading',{name:'Find duplicate events in a stream'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Design a collaborative reading list'})).toHaveCount(0);
  await page.getByLabel('Company filter').selectOption('');
  await page.getByRole('button',{name:'Add a question',exact:true}).click();
  await page.getByLabel('Post title').fill('Design a shared annotation tool');
  await page.getByLabel('Post details').fill('How would you support shared document annotations, permissions, concurrent changes, and efficient notification delivery?');
  await page.getByLabel('Post company').fill('Google');
  await page.getByRole('button',{name:'Publish locally',exact:true}).click();
  await expect(page).toHaveURL(/\/community\/post\?kind=questions&id=/);
  await expect(page.getByRole('heading',{name:'Design a shared annotation tool'})).toBeVisible();
  await page.getByRole('button',{name:'0 local reports',exact:true}).click();
  await expect(page.getByRole('button',{name:'1 local reports',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Follow',exact:true}).click();
  await expect(page.getByRole('button',{name:'Following',exact:true})).toBeVisible();
  await page.getByLabel('Add a comment').fill('I would start by defining the permission boundary for each document.');
  await page.getByRole('button',{name:'Post comment',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('button',{name:'1 local reports',exact:true})).toBeVisible();
  await expect(page.getByText('I would start by defining the permission boundary for each document.',{exact:true})).toBeVisible();
});

test('premium gates, explicit demo checkout, gift and plan reset', async ({page}) => {
  await demo(page);
  await page.goto('/learn/system-design/replication');
  await expect(page.getByRole('heading',{name:'A deeper practice opportunity.'})).toBeVisible();
  await page.goto('/premium/checkout?duration=year');
  await page.getByLabel('I understand this is a local demo').check();
  await page.getByRole('button',{name:'Activate 1-year access demo',exact:true}).click();
  await expect(page.getByText('Your local premium demo is active.',{exact:true})).toBeVisible();
  await page.goto('/learn/system-design/replication');
  await expect(page.getByRole('heading',{name:'Name the operation and guarantee',exact:true})).toBeVisible();
  await page.goto('/premium/gift');
  await page.getByRole('button',{name:'Generate demo code',exact:true}).click();
  const code=await page.locator('.gift-code code').textContent();
  await page.getByLabel('Gift code',{exact:true}).fill(code!);
  await page.getByRole('button',{name:'Redeem local code',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Gift redeemed');
  await page.getByLabel('Gift code',{exact:true}).fill(code!);
  await page.getByRole('button',{name:'Redeem local code',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('already been redeemed');
  await page.goto('/account');
  await page.getByRole('button',{name:'Reset local plan to free',exact:true}).click();
  await expect(page.getByText('Free',{exact:true})).toBeVisible();
});

test('global search, local tutor, guides, articles, FAQ and support ticket', async ({page}) => {
  await demo(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel('Search the Studio')).toBeFocused();
  await page.getByLabel('Search the Studio').fill('caching');
  await expect(page.getByRole('heading',{name:'Caching without surprises'})).toBeVisible();
  await page.goto('/tutor');
  await page.getByLabel('Tutor question').fill('How does cache-aside work?');
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.getByText(/Local study helper \(not AI\):/)).toBeVisible();
  await page.goto('/guides/meta/senior');
  await page.getByLabel('Guide company').selectOption('Amazon');
  await page.getByLabel('Guide level').selectOption('Manager');
  await expect(page.getByRole('heading',{name:'Amazon · Manager',exact:true})).toBeVisible();
  await page.goto('/blog/practice-with-intention');
  await expect(page.getByRole('heading',{name:'Name the uncertainty',exact:true})).toBeVisible();
  await page.goto('/faq');
  await page.getByText('Do demo plans charge or renew?',{exact:true}).click();
  await expect(page.getByText('No. Plan and gift actions demonstrate local entitlements only.',{exact:false})).toBeVisible();
  await page.goto('/support');
  await page.getByLabel('Contact email').fill('tester@example.test');
  await page.getByLabel('Support question').fill('This is an automated local support ticket for testing persistence and clear delivery status.');
  await page.getByRole('button',{name:'Save local ticket',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Saved locally.',exact:true})).toBeVisible();
  await expect(page.getByText('No external delivery occurred.',{exact:true})).toBeVisible();
});

test('all principal routes render without errors and unknown route is explicit', async ({page}) => {
  await demo(page);
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/learn','/learn/courses','/learn/courses/system-design','/learn/code','/learn/low-level-design','/learn/behavioral','/learn/ai-coding','/learn/ml-system-design','/learn/salary-negotiation','/practice','/practice/low-level-design','/practice/ai-coding','/practice/behavioral','/practice/code-review','/community/stories','/community/submissions/system-design','/community/submissions/low-level-design','/community/discussion','/pricing','/blog','/account','/aboutus','/privacy','/terms','/security','/learn/changelog']){
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByText('This page isn’t in the Studio.',{exact:true})).toHaveCount(0);
  }
  await page.goto('/not-a-real-route');
  await expect(page.getByRole('heading',{name:'This page isn’t in the Studio.'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('structured course enrollment, actual video playback, completion and certificate', async ({page}) => {
  await demo(page);
  await page.goto('/learn');
  await page.getByRole('link',{name:'Structured courses',exact:true}).click();
  await expect(page).toHaveURL('/learn/courses');
  await page.goto('/learn/courses/low-level-design');
  await page.getByRole('button',{name:'Enroll in this course',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Course enrolled');
  const premature=await page.request.post('/api/courses/low-level-design/certificate',{data:{}});
  expect(premature.status()).toBe(400);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading',{name:'Your enrolled courses',exact:true})).toBeVisible();
  await expect(page.locator('section.learning-path').filter({has:page.getByRole('heading',{name:'Your enrolled courses',exact:true})}).getByRole('link',{name:'Up next: From requirements to responsibilities',exact:true})).toHaveAttribute('href','/learn/low-level-design/introduction');
  await page.goto('/learn/courses/low-level-design/video/low-level-design');
  await page.getByLabel('Video playback speed').selectOption('2');
  await page.getByRole('button',{name:'Play walkthrough',exact:true}).click();
  await expect(page.getByText('Watched',{exact:true})).toBeVisible({timeout:15000});
  expect(await page.locator('video').evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(5);
  for(const lesson of ['introduction','design-principles','state-machines']){
    await page.goto(`/learn/low-level-design/${lesson}`);
    await page.getByRole('button',{name:'Mark as read',exact:true}).click();
    await expect(page.getByRole('button',{name:'Completed',exact:true})).toBeVisible();
  }
  await page.goto('/quiz/design-principles');
  await page.getByRole('button',{name:'Start quiz',exact:true}).click();
  const designQuestions=quizQuestions.filter(question=>question.topic==='design-principles');
  for(const [index,question] of designQuestions.entries()){
    await page.getByRole('radio').nth(question.correct).check();
    await page.getByRole('button',{name:'Check answer',exact:true}).click();
    await page.getByRole('button',{name:index===designQuestions.length-1?'Finish quiz':'Next question',exact:true}).click();
  }
  await expect(page.getByRole('heading',{name:'A clear understanding.'})).toBeVisible();
  await page.goto('/practice/low-level-design/parcel-lockers');
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  await page.getByRole('tab',{name:'Explanation',exact:true}).click();
  await page.getByLabel('Practice explanation').fill('I would define an Inventory class with an interface that selects available capacity by package size. An atomic reservation moves the locker into a reserved state. Generate a unique pickup code and use a controllable clock to expire the reservation. Test invalid codes and release capacity after pickup.');
  await page.getByRole('button',{name:'Get feedback',exact:true}).click();
  await expect(page.getByText('Local rubric · not AI',{exact:true})).toBeVisible();
  await page.goto('/learn/courses/low-level-design');
  await expect(page.getByRole('heading',{name:'6 of 6 steps complete'})).toBeVisible();
  await page.getByRole('button',{name:'Issue local completion record',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download local record',exact:true})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download local record',exact:true}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('studio-completion.svg');
  await page.goto('/dashboard');
  await expect(page.getByRole('link',{name:'Course complete · review your record',exact:true})).toHaveAttribute('href','/learn/courses/low-level-design');
});

test('behavioral mini session uses distinct questions and level context', async ({page}) => {
  await demo(page);
  await page.goto('/practice/behavioral');
  await page.getByRole('button',{name:'Mini 3 questions · about 15 min'}).click();
  await page.getByLabel('Interview level',{exact:true}).selectOption('Senior');
  await page.getByRole('link',{name:'Start practice',exact:true}).click();
  const titles:string[]=[];
  for(let i=0;i<3;i++){
    await page.getByRole('button',{name:'Start practice',exact:true}).click();
    titles.push((await page.locator('main h1').textContent())!);
    await page.getByLabel('Practice explanation').fill('Situation: our team had unclear goals. My task was to make the project concrete. I proposed a small experiment and I measured its impact. The result improved reliability by 20%. I learned to listen and communicate before assuming the answer.');
    await page.getByRole('button',{name:'Get feedback',exact:true}).click();
    await expect(page.getByText('Local rubric · not AI',{exact:true})).toBeVisible();
    if(i<2)await page.getByRole('link',{name:'Next question',exact:true}).click();
  }
  expect(new Set(titles).size).toBe(3);
  await page.goto('/history');
  await expect(page.locator('.history-row')).toHaveCount(3);
});

test('saved edits invalidate stale feedback rather than retaining an old grade', async ({page}) => {
  await demo(page);
  const first=await page.request.post('/api/attempts',{data:{problemId:'short-links',level:'Senior',answer:'I would validate an API endpoint and store unique identifiers in a database with collision handling and cache redirects.',code:'',nodes:[],edges:[],elapsed:0}});
  const attempt=(await first.json()).attempt;
  const graded=await page.request.post(`/api/attempts/${attempt.id}/evaluate`,{data:{}});
  expect(graded.status()).toBe(200);
  const saved=(await graded.json()).attempts.find((value:{id:string})=>value.id===attempt.id);
  expect((await page.request.post('/api/attempts',{data:{...attempt,answer:'A stale browser draft must not replace graded work.'}})).status()).toBe(409);
  const edited=await page.request.post('/api/attempts',{data:{...saved,answer:'A substantially different saved explanation that has not yet been evaluated.'}});
  expect(edited.status()).toBe(200);
  const updated=(await edited.json()).attempt;
  expect(updated.completed).toBe(false);
  expect(updated.feedback).toBeUndefined();
  await page.goto(`/practice/system-design/short-links?attempt=${attempt.id}`);
  await page.getByRole('tab',{name:'Feedback',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your thinking comes first'})).toBeVisible();
});

test('community pagination and reversible upvotes use persisted local records', async ({page}) => {
  await demo(page);
  for(let i=0;i<8;i++){
    const response=await page.request.post('/api/posts',{data:{kind:'discussion',title:`Pagination exercise ${i}`,body:'An original local contribution with enough context for this pagination exercise.',company:'',track:'system-design',level:'Senior',region:'Global'}});
    expect(response.status()).toBe(201);
  }
  await page.goto('/community/discussion');
  await expect(page.locator('.community-card')).toHaveCount(6);
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  await expect(page.getByRole('button',{name:'Previous page',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Previous page',exact:true}).click();
  const vote=page.locator('.vote-column').first();
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed','true');
  await vote.click();
  await expect(vote).toHaveAttribute('aria-pressed','false');
});

test('global community search loads further server matches beyond the old 80-result cap and preserves body-only matches',async({page})=>{
  await demo(page);
  const marker=`community-body-${Date.now()}`;
  for(let index=0;index<85;index++){
    const response=await page.request.post('/api/posts',{data:{kind:'discussion',title:`Search pagination record ${index}`,
      body:`${'Saved context. '.repeat(30)} ${marker}`,company:'',track:'system-design',level:'Senior',region:'Global'}});
    expect(response.status()).toBe(201);
  }
  const legacyReads:string[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/posts')legacyReads.push(request.url());});
  await page.goto(`/search?q=${marker}`);
  await page.locator('main').getByRole('button',{name:'Community',exact:true}).click();
  await expect(page.locator('.search-results h3')).toHaveCount(50);
  await expect(page.getByText('85 results',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load more community results',exact:true}).click();
  await expect(page.locator('.search-results h3')).toHaveCount(85);
  await expect(page.getByRole('button',{name:'Load more community results',exact:true})).toHaveCount(0);
  expect(legacyReads).toEqual([]);
  await page.locator('.search-results a').last().click();
  await expect(page.locator('.post-body')).toContainText(marker);
});

test('mobile navigation, theme, and no horizontal overflow on main surfaces', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await demo(page);
  for(const route of ['/dashboard','/learn/code','/practice/system-design','/quiz','/community/questions','/pricing','/tutor','/account']){
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),route).toBeTruthy();
  }
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await expect(page.locator('.sidebar')).toBeInViewport();
  await page.getByRole('link',{name:'Your dashboard',exact:true}).click();
  await expect(page.locator('.sidebar')).not.toBeInViewport();
  await page.getByRole('button',{name:'Switch to dark theme'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});

test('server guards credentials, cross-origin requests, user isolation and input', async ({page,request}) => {
  expect((await request.get('/.cred')).status()).toBe(404);
  expect((await request.get('/@fs/home/azadmin/HelloInterview/.cred')).status()).toBe(404);
  expect((await request.post('/api/targets',{data:{company:'Google'}})).status()).toBe(401);
  expect((await request.post('/api/auth/demo',{headers:{Origin:'https://untrusted.example'},data:{}})).status()).toBe(403);
  await demo(page);
  const bad=await page.request.post('/api/targets',{data:{company:'G',level:'Senior',role:'Software Engineer',date:''}});
  expect(bad.status()).toBe(400);
  const create=await page.request.post('/api/attempts',{data:{problemId:'short-links',level:'Senior',answer:'A draft belonging to one local user.',code:'',nodes:[],edges:[],elapsed:0}});
  const attempt=(await create.json()).attempt;
  const other=await page.context().browser()!.newContext({baseURL:'http://127.0.0.1:3100'});
  await other.request.post('/api/auth/demo',{data:{}});
  expect((await other.request.post(`/api/attempts/${attempt.id}/evaluate`,{data:{}})).status()).toBe(404);
  const exported=await other.request.get('/api/export');
  expect((await exported.json()).state.attempts).toEqual([]);
  await other.close();
});
