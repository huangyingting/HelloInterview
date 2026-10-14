import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium, expect, type Page } from '@playwright/test';
import { z } from 'zod';
import { loadConfig } from '../server/config';
import { startServer } from '../server/runtime';
import { navigationTracks } from '../shared/public-navigation';
import { tracks } from '../shared/public-tracks';
import { localConnection } from '../server/db/connection';
import { communityPostPath } from '../shared/community-routes';

const manifestSchema = z.record(z.string(), z.object({
  file: z.string(),
  imports: z.array(z.string()).optional(),
  css: z.array(z.string()).optional(),
  assets: z.array(z.string()).optional(),
}));
const manifest = manifestSchema.parse(JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8')));
function graph(...roots: string[]) {
  const seen = new Set<string>(), files = new Set<string>();
  function visit(key: string) {
    if (seen.has(key)) return;
    seen.add(key);
    const item = manifest[key];
    assert.ok(item, `Missing manifest module: ${key}`);
    assert.match(item.file, /^assets\/[\w.-]+\.js$/);
    files.add(item.file);
    for (const dependency of item.imports ?? []) visit(dependency);
  }
  roots.forEach(visit);
  return [...files].sort();
}
async function fixture(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const parent = path.resolve('data/screen-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'screens-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await startServer(loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', LOG_REQUESTS: 'false', DATA_DIR: directory, ...env }));
  t.after(() => runtime.close());
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage(), documents: string[] = [], mutations: string[] = [];
  page.on('request', requested => {
    if (new URL(requested.url()).origin !== runtime.url) return;
    if (requested.isNavigationRequest() && requested.frame() === page.mainFrame()) documents.push(requested.url());
    if (!['GET', 'HEAD'].includes(requested.method())) mutations.push(new URL(requested.url()).pathname);
  });
  return { ...runtime, directory, browser, context, page, documents, mutations };
}

test('compiled browser reports only allowlisted field performance dimensions when explicitly enabled', async t => {
  const logs: string[] = [], original = console.log;
  console.log = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
  t.after(() => { console.log = original; });
  const f = await fixture(t, { FIELD_METRICS_ENABLED: 'true' });
  let reports = 0;
  f.page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/metrics/web-vitals' && request.method() === 'POST') {
      reports++;
      assert.equal(new URL(request.url()).search, '');
    }
  });
  await f.page.goto(`${f.url}/`);
  await expect(f.page.locator('main')).toBeVisible();
  await f.page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 100)));
  await f.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect.poll(() => reports).toBeGreaterThan(0);
  await expect.poll(() => logs.some(line => line.includes('web_vital.observed'))).toBe(true);
  const event = JSON.parse(logs.find(line => line.includes('web_vital.observed'))!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(event).sort(), ['event', 'metric', 'navigation', 'rating', 'screen', 'value']);
  assert.ok(['LCP', 'CLS', 'INP'].includes(String(event.metric)));
  assert.equal(event.screen, 'landing');
  assert.ok(['navigate', 'reload', 'back-forward', 'prerender'].includes(String(event.navigation)));
  assert.equal(typeof event.value, 'number');
  assert.ok(!JSON.stringify(event).includes(f.url));
});

test('community cards and global search address exact opaque records instead of normalizing IDs as paths',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id;
  await db.prepare('DELETE FROM posts').run();
  const ids=['.','..','slash/?query#fragment%\\',' padded ','界'.repeat(200),'padded'];
  for(const [index,id] of ids.entries())await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)')
    .run(id,'questions',`Opaque conversation ${index}`,`Original complete body for opaque-address-needle ${index}.`,'Fixture Company','system-design','Senior','Global','Anonymous',owner,`2026-01-0${index+1}T00:00:00.000Z`);
  for(const [index,id] of ids.entries()){
    await page.goto(`${f.url}/community/questions`);
    const card=page.locator('.community-card').filter({has:page.getByRole('heading',{name:`Opaque conversation ${index}`,exact:true})});
    await card.getByRole('link',{name:'View details'}).click();
    await expect(page.locator('.community-detail h1')).toHaveText(`Opaque conversation ${index}`);
    assert.equal(new URL(page.url()).searchParams.get('id'),id);
    await expect(page.locator('.post-body')).toContainText(`opaque-address-needle ${index}`);
    await page.getByRole('button',{name:'0 upvotes',exact:true}).click();
    await expect(page.getByRole('button',{name:'1 upvotes',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Follow',exact:true}).click();
    await expect(page.getByRole('button',{name:'Following',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByLabel('Add a comment').fill(`Exact conversation comment ${index}.`);
    await page.getByRole('button',{name:'Post comment',exact:true}).click();
    await expect(page.locator('.comment')).toContainText(`Exact conversation comment ${index}.`);
    await page.reload();
    await expect(page.locator('.community-detail h1')).toHaveText(`Opaque conversation ${index}`);
    await expect(page.locator('.comment')).toHaveCount(1);
    await expect(page.locator('main [role=alert]')).toHaveCount(0);
  }
  await page.goto(`${f.url}/search?q=opaque-address-needle`);
  await page.locator('main').getByRole('button',{name:'Community',exact:true}).click();
  await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Opaque conversation 2',exact:true})}).click();
  await expect(page.locator('.community-detail h1')).toHaveText('Opaque conversation 2');
  assert.equal(new URL(page.url()).searchParams.get('id'),ids[2]);
});

test('malformed path and detail-query escapes show a usable, explicit invalid-address screen without leaking the address',async t=>{
  const f=await fixture(t),{page}=f,errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.name));
  for(const route of ['/learn/%E0%A4','/learn/%','/community/post?kind=questions&id=%E0%A4','/community/post?kind=questions&id=.&id=..']){
    const response=await page.goto(`${f.url}${route}`);
    assert.ok(response);assert.ok([200,400].includes(response.status()));
    await expect(page.getByRole('heading',{name:'This address could not open.',exact:true})).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('invalid');
    await expect(page.getByRole('complementary',{name:'Primary navigation'})).toBeVisible();
    await expect(page.locator('main')).not.toContainText('%E0%A4');
    await page.getByRole('link',{name:'Quizzes',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Check what you know.',exact:true})).toBeVisible();
    await expect(page.locator('main')).toBeFocused();
  }
  await page.evaluate(()=>{history.pushState(null,'','/learn/%');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.getByRole('heading',{name:'This address could not open.',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);assert.deepEqual(f.mutations,[]);
});

test('submission return links preserve legacy tracks, while semantic detail changes clear drafts and move focus without a document reload',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,track='legacy/track?x#y\\..';
  await db.prepare('DELETE FROM posts').run();
  for(const [id,title,type] of [['.','Tracked opaque design',track],['..','Untracked opaque design',''],['literal%2F','Legacy encoded question','system-design']])
    await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(id,id==='literal%2F'?'questions':'submissions',title,`Original complete design body for ${title}.`,'Fixture Company',type,'Senior','Global','Synthetic author',owner,'2026-01-01T00:00:00.000Z');
  await page.goto(`${f.url}/community/submissions`);
  await expect(page.locator('.community-card')).toHaveCount(2);
  await page.getByRole('link',{name:'Tracked opaque design',exact:true}).click();
  await expect(page.locator('.community-detail h1')).toHaveText('Tracked opaque design');
  assert.equal(new URL(page.url()).searchParams.get('track'),track);
  const comment=page.getByLabel('Add a comment');
  await comment.fill('An unsaved draft for exactly this design.');
  const reordered=`/community/post?${new URLSearchParams({track,id:'.',kind:'submissions'})}`;
  await page.evaluate(route=>{history.pushState(null,'',route);window.dispatchEvent(new PopStateEvent('popstate'));},reordered);
  await expect(comment).toHaveValue('An unsaved draft for exactly this design.');await expect(comment).toBeFocused();
  await page.evaluate(route=>{history.pushState(null,'',route);window.dispatchEvent(new PopStateEvent('popstate'));},communityPostPath({kind:'submissions',id:'..'}));
  await expect(page.locator('.community-detail h1')).toHaveText('Untracked opaque design');
  await expect(page.getByLabel('Add a comment')).toHaveValue('');await expect(page.locator('main')).toBeFocused();
  await page.goBack();
  await expect(page.locator('.community-detail h1')).toHaveText('Tracked opaque design');
  await page.locator('main').getByRole('link',{name:'Peer design library',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/community/submissions');assert.equal(new URL(page.url()).searchParams.get('track'),track);
  await expect(page.getByLabel('Type filter')).toHaveValue(track);await expect(page.locator('.community-card')).toHaveCount(1);
  await page.getByRole('button',{name:'Add a design',exact:true}).click();
  await expect(page.getByLabel('Post interview type')).toHaveValue('system-design');
  assert.equal(f.documents.length,1);
  await page.goto(`${f.url}/community/questions/literal%252F`);
  await expect(page.locator('.community-detail h1')).toHaveText('Legacy encoded question');
});

test('local owner editing preserves conflicting drafts and deletion is an explicit in-page action on the exact original post',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,id=' owner/..?%#\\ ',resource=`post/${id}`;
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(id,'questions','Original owned local question','An original local question explaining the reasoning in full.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id})}`);
  await expect(page.locator('.community-detail h1')).toHaveText('Original owned local question');
  await page.getByRole('button',{name:'Manage your post',exact:true}).click();
  const editor=page.locator('#owned-contribution');
  await expect(editor.getByLabel('Edit post title')).toHaveValue('Original owned local question');
  await editor.getByLabel('Edit post title').fill('First saved local edit');
  await editor.getByLabel('Edit post details').fill('An updated original local explanation with enough reasoning to be useful.');
  await editor.getByRole('button',{name:'Save post changes',exact:true}).click();
  await expect(page.locator('.community-detail h1')).toHaveText('First saved local edit');
  await expect(editor.getByRole('button',{name:'Save post changes',exact:true})).toBeDisabled();
  await editor.getByLabel('Edit post title').fill('A preserved unsaved local draft');
  await db.prepare('UPDATE posts SET title=?,body=? WHERE id=?').run('A newer saved version','A concurrent original explanation with complete context and reasoning.',id);
  await editor.getByRole('button',{name:'Save post changes',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('changed');
  await expect(editor.getByLabel('Edit post title')).toHaveValue('A preserved unsaved local draft');
  await editor.getByRole('button',{name:'Check saved version',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Current saved version',exact:true})).toBeVisible();
  await expect(editor.getByLabel('Edit post title')).toHaveValue('A preserved unsaved local draft');
  await editor.getByRole('button',{name:'Replace my draft with saved version',exact:true}).click();
  await expect(editor.getByLabel('Edit post title')).toHaveValue('A newer saved version');
  await expect(editor.getByRole('button',{name:'Delete my local post',exact:true})).toBeDisabled();
  await editor.getByLabel('I understand this deletes my post, its discussion, votes and follows.').check();
  await editor.getByRole('button',{name:'Delete my local post',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Interview questions',exact:true})).toBeVisible();
  assert.equal(await db.prepare('SELECT id FROM posts WHERE id=?').get(id),undefined);
  assert.deepEqual(await db.prepare('SELECT id FROM comments WHERE resource=?').all(resource),[]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.equal(f.documents.length,1);
});

test('community reports, owner appeals and hidden controls stay in-page with exact private receipts',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,post=randomUUID(),hiddenPost=randomUUID(),comment=randomUUID(),resource=`post/${post}`;
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'discussion','Reportable local contribution',
    'A local contribution with enough context for the reporting acceptance workflow.','Fixture Company','system-design',
    'Senior','Global','Synthetic author',owner,'2026-01-01T00:00:00.000Z');
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(comment,resource,owner,'Synthetic author',
    'A comment hidden by reviewed moderation.','2026-01-02T00:00:00.000Z',null);
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(hiddenPost,'discussion','Owner-deletable hidden post',
    'A hidden local post retained only for its owner deletion workflow.','Fixture Company','system-design',
    'Senior','Global','Synthetic author',owner,'2026-01-03T00:00:00.000Z');
  await db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
    VALUES('comment',?,'hidden',1,?)`).run(comment,new Date().toISOString());
  await db.prepare(`INSERT INTO community_moderation_targets(target_type,target_id,state,revision,updated_at)
    VALUES('post',?,'hidden',1,?)`).run(hiddenPost,new Date().toISOString());
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:post})}`);
  await page.getByRole('button',{name:'Report post',exact:true}).click();
  await page.getByLabel('Policy concern').selectOption('privacy');
  const details='This browser report identifies a specific private detail that requires moderator review.';
  await page.getByLabel('What should a moderator review?').fill(details);
  await page.getByRole('button',{name:'Submit report',exact:true}).click();
  await expect(page.getByText(/Reported for review/)).toBeVisible();
  const saved=await db.prepare('SELECT request_key,category,details,state,assigned_to FROM community_reports WHERE reporter_id=?').get(owner);
  assert.equal(saved?.category,'privacy');assert.equal(saved?.details,details);assert.equal(saved?.state,'open');assert.equal(saved?.assigned_to,null);
  assert.match(String(saved?.request_key),/^[a-f0-9-]{36}$/);
  const hidden=page.locator('.comment').filter({hasText:'This comment was hidden by moderation.'});
  await expect(hidden).toBeVisible();await expect(hidden.getByRole('button',{name:'Reply',exact:true})).toHaveCount(0);
  await expect(hidden.getByRole('button',{name:'Report comment',exact:true})).toHaveCount(0);
  await hidden.getByRole('button',{name:'Appeal moderation decision',exact:true}).click();
  await hidden.getByLabel('Why should this contribution be restored?').fill('The comment context should receive an independent second policy review.');
  await hidden.getByRole('button',{name:'Submit appeal',exact:true}).click();
  await expect(hidden.getByText(/Appeal saved for hidden revision 1/)).toBeVisible();
  await hidden.getByRole('button',{name:'Manage hidden comment',exact:true}).click();
  await expect(hidden.getByText('Moderation hid this comment',{exact:false})).toBeVisible();
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:hiddenPost})}`);
  await expect(page.getByText('Hidden by moderation',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Report post',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:/Discussion/})).toHaveCount(0);
  await page.getByRole('button',{name:'Appeal moderation decision',exact:true}).click();
  await page.getByLabel('Why should this contribution be restored?').fill('The post context should receive an independent second policy review.');
  await page.getByRole('button',{name:'Submit appeal',exact:true}).click();
  await expect(page.getByText(/Appeal saved for hidden revision 1/)).toBeVisible();
  await page.getByRole('button',{name:'Manage hidden post',exact:true}).click();
  const editor=page.locator('#owned-contribution');
  await expect(editor.getByText('Moderation hid this post',{exact:false})).toBeVisible();
  await expect(editor.getByLabel('Edit post title')).toHaveCount(0);
  await editor.getByLabel('I understand this deletes my post, its discussion, votes and follows.').check();
  await editor.getByRole('button',{name:'Delete my local post',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ask the community',exact:true})).toBeVisible();
  assert.equal(await db.prepare('SELECT id FROM posts WHERE id=?').get(hiddenPost),undefined);
  await page.getByRole('button',{name:'My moderation status',exact:true}).click();
  await expect(page.getByRole('heading',{name:'My reports',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'My appeals',exact:true})).toBeVisible();
  await expect(page.getByText('privacy',{exact:true})).toBeVisible();
  assert.equal(Number((await db.prepare('SELECT count(*) AS count FROM community_appeals WHERE owner_id=?').get(owner))?.count),2);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('personal author muting hides posts, publishes comment tombstones and un-mutes from in-page history',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const viewer=(await login.json()).user.id,subject=randomUUID(),subjectPost=randomUUID(),viewerPost=randomUUID(),comment=randomUUID();
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)')
    .run(subject,'Muted browser author',`${subject}@example.invalid`);
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(subjectPost,'discussion','Post hidden by personal mute',
    'This contribution disappears only for the viewer who mutes its author.','Fixture Company','system-design',
    'Senior','Global','Muted browser author',subject,'2026-01-01T00:00:00.000Z');
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(viewerPost,'discussion','Viewer owned mute discussion',
    'This owned contribution hosts a comment from another member.','Fixture Company','system-design',
    'Senior','Global','Viewer',viewer,'2026-01-02T00:00:00.000Z');
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(comment,`post/${viewerPost}`,subject,'Muted browser author',
    'A comment that becomes a viewer-only personal mute tombstone.','2026-01-03T00:00:00.000Z',null);
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:subjectPost})}`);
  await expect(page.getByRole('button',{name:'Mute author',exact:true})).toBeVisible();
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:viewerPost})}`);
  const row=page.locator('.comment').filter({hasText:'A comment that becomes a viewer-only personal mute tombstone.'});
  await row.getByRole('button',{name:'Mute author',exact:true}).click();
  const tombstone=page.locator('.comment').filter({hasText:'This comment is hidden because you muted its author.'});
  await expect(tombstone.getByText('This comment is hidden because you muted its author.',{exact:true})).toBeVisible();
  await expect(tombstone.getByRole('button',{name:'Reply',exact:true})).toHaveCount(0);
  await expect(tombstone.getByRole('button',{name:'Report comment',exact:true})).toHaveCount(0);
  const saved=await db.prepare('SELECT id,state,revision,subject_id FROM community_mutes WHERE owner_id=?').get(viewer);
  assert.equal(saved?.state,'muted');assert.equal(saved?.revision,1);assert.equal(saved?.subject_id,subject);
  const muteId=String(saved?.id);assert.match(muteId,/^[a-f0-9-]{36}$/);
  await page.goto(`${f.url}/community/discussion`);
  await expect(page.getByRole('heading',{name:'Post hidden by personal mute',exact:true})).toHaveCount(0);
  const reportId=randomUUID(),reportKey=randomUUID(),restrictionId=randomUUID();
  await db.prepare(`INSERT INTO community_reports
    (id,reporter_id,request_key,input_hash,target_type,target_id,category,details,created_at,updated_at)
    VALUES(?,?,?,?,? ,?,'spam',?,?,?)`).run(reportId,viewer,reportKey,'c'.repeat(64),'post',subjectPost,
      'A local browser report provides reviewed evidence for a minimized restriction status fixture.',
      '2026-01-03T01:00:00.000Z','2026-01-03T01:00:00.000Z');
  await db.prepare(`INSERT INTO community_restrictions
    (id,subject_id,source_report_id,scope,state,revision,starts_at,expires_at,created_at,updated_at)
    VALUES(?,?,?,'reporting','active',1,'2026-01-03T02:00:00.000Z','2999-01-03T02:00:00.000Z',
      '2026-01-03T02:00:00.000Z','2026-01-03T02:00:00.000Z')`).run(restrictionId,viewer,reportId);
  await db.prepare(`INSERT INTO community_restriction_events
    (id,restriction_id,source_report_id,actor_ref,actor_role,action,reason,prior_revision,result_revision,
      prior_expires_at,result_expires_at,result_state,created_at)
    VALUES(?,?,?,?,?,'restrict',?,0,1,NULL,'2999-01-03T02:00:00.000Z','active','2026-01-03T02:00:00.000Z')`)
    .run(randomUUID(),restrictionId,reportId,'private-browser-moderator','moderator',
      'Private browser restriction evidence must not appear in member status.');
  await page.getByRole('button',{name:'My moderation status',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Authors muted for me',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'My community restrictions',exact:true})).toBeVisible();
  await expect(page.getByText('Report submission restricted',{exact:true})).toBeVisible();
  await expect(page.getByText('private-browser-moderator',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/Reading, deletion, contribution appeals, personal mutes/)).toBeVisible();
  await page.getByRole('button',{name:'Appeal this restriction',exact:true}).click();
  await page.getByLabel('Why should this restriction be lifted?').fill(
    'The reporting restriction should receive an independent review of the local browser context.');
  await page.getByRole('button',{name:'Submit restriction appeal',exact:true}).click();
  await expect(page.getByText(/This exact restriction revision has an open appeal/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'My restriction appeals',exact:true})).toBeVisible();
  await expect(page.getByText(/appealed restriction revision 1/)).toBeVisible();
  const restrictionAppeal=await db.prepare(`SELECT owner_id,restriction_id,restriction_revision,state
    FROM community_restriction_appeals WHERE restriction_id=?`).get(restrictionId);
  assert.equal(restrictionAppeal?.owner_id,viewer);assert.equal(restrictionAppeal?.restriction_id,restrictionId);
  assert.equal(restrictionAppeal?.restriction_revision,1);assert.equal(restrictionAppeal?.state,'open');
  await expect(page.getByText(comment,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Unmute author',exact:true}).click();
  await expect(page.getByText('No authors are currently muted for you.',{exact:true})).toBeVisible();
  assert.equal((await db.prepare('SELECT state,revision FROM community_mutes WHERE id=?').get(muteId))?.state,'unmuted');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Post hidden by personal mute',exact:true})).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('local browser account block creates a private relationship boundary and exact in-page recovery',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const viewer=(await login.json()).user.id,subject=randomUUID(),subjectPost=randomUUID(),viewerPost=randomUUID(),comment=randomUUID();
  await db.prepare('INSERT INTO users(id,name,email,password,demo) VALUES(?,?,?,NULL,0)')
    .run(subject,'Blocked browser member',`${subject}@example.invalid`);
  await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(subjectPost,'discussion','Post hidden by relationship block',
    'A live contribution used to create a private relationship-wide community block.','Fixture Company','system-design',
    'Senior','Global','Blocked browser member',subject,'2026-01-04T00:00:00.000Z');
  await db.prepare(`INSERT INTO posts(id,kind,title,body,company,track,level,region,author,author_id,created_at,sample)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0)`).run(viewerPost,'discussion','Viewer post with blocked relationship comment',
    'This owned contribution hosts a comment replaced by a private relationship safety tombstone.','Fixture Company','system-design',
    'Senior','Global','Viewer',viewer,'2026-01-04T00:00:01.000Z');
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(comment,`post/${viewerPost}`,subject,
    'Blocked browser member','A comment hidden by the private relationship block.','2026-01-04T00:00:02.000Z',null);
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:subjectPost})}`);
  await page.getByRole('button',{name:'Block account',exact:true}).click();
  await expect(page.getByText(/does not notify the other member or remove content globally/)).toBeVisible();
  await page.getByRole('button',{name:'Confirm account block',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Post hidden by relationship block',exact:true})).toHaveCount(0);
  const saved=await db.prepare('SELECT id,state,revision,subject_id FROM community_blocks WHERE owner_id=?').get(viewer);
  assert.equal(saved?.state,'blocked');assert.equal(saved?.revision,1);assert.equal(saved?.subject_id,subject);
  const blockId=String(saved?.id);assert.match(blockId,/^[a-f0-9-]{36}$/);
  assert.equal((await page.request.post(`${f.url}/api/posts/actions`,{
    data:{id:subjectPost,action:'vote',enabled:true}})).status(),404);
  assert.equal((await page.request.post(`${f.url}/api/comments`,{
    data:{resource:`post/${subjectPost}`,parentId:null,body:'A direct discussion write must respect the active block.'}})).status(),404);
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:viewerPost})}`);
  const tombstone=page.locator('.comment').filter({hasText:'This comment is unavailable due to a personal safety setting.'});
  await expect(tombstone.getByText('Unavailable',{exact:true})).toBeVisible();
  await expect(tombstone.getByRole('button',{name:'Reply',exact:true})).toHaveCount(0);
  await expect(tombstone.getByRole('button',{name:'Report comment',exact:true})).toHaveCount(0);
  await page.goto(`${f.url}/community/discussion`);
  await page.getByRole('button',{name:'My moderation status',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Community accounts blocked by me',exact:true})).toBeVisible();
  await expect(page.getByText(subject,{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Remove my block',exact:true}).click();
  await expect(page.getByText('No community accounts are currently blocked by you.',{exact:true})).toBeVisible();
  assert.equal((await db.prepare('SELECT state,revision FROM community_blocks WHERE id=?').get(blockId))?.state,'unblocked');
  await page.goto(`${f.url}${communityPostPath({kind:'discussion',id:viewerPost})}`);
  await expect(page.getByText('A comment hidden by the private relationship block.',{exact:true})).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('discussion pages expose older authors beyond 500 without losing drafts, duplicating new comments or hiding load failures',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,post=' paging/?%# ',resource=`post/${post}`,reads:string[]=[];
  const olderParent='界'.repeat(193)+'/?%# \t ';
  page.on('request',request=>{if(request.method()==='GET'&&new URL(request.url()).pathname.startsWith('/api/comments'))reads.push(request.url());});
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'questions','A paginated discussion fixture','A complete original question for bounded discussion pages.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2000-01-01T00:00:00.000Z');
  const insert=db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)');
  await db.transaction(async()=>{for(let i=0;i<551;i++)await insert.run(i===550?olderParent:`page-${String(i).padStart(4,'0')}`,resource,i===0||i===550?owner:'another-local-author','Synthetic page author',`Original paginated comment ${i}.`,'2000-01-01T00:00:00.000Z',null);});
  await page.route('**/api/comments/page?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic initial discussion failure.'})}),{times:1});
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:post})}`);
  await expect(page.getByRole('alert')).toContainText('Synthetic initial discussion failure.');
  const composer=page.getByLabel('Add a comment');
  await composer.fill('Composer survives a failed initial discussion read.');
  await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry discussion',exact:true}).click();
  await expect(page.locator('.comment')).toHaveCount(50);await expect(composer).toHaveValue('Composer survives a failed initial discussion read.');
  const first=page.locator('.comment').first();await expect(first.locator(':scope > div > p')).toHaveText('Original paginated comment 0.');
  await first.getByRole('button',{name:'Edit my comment',exact:true}).click();
  const text=first.getByLabel('Edit comment text');await expect(text).toHaveValue('Original paginated comment 0.');
  await text.fill('An editor draft preserved through bounded pagination.');
  await page.getByLabel('Search comments').fill('No loaded matches');
  await expect(first).toBeHidden();await expect(page.getByText('No loaded comments match this search.',{exact:true})).toBeVisible();
  await page.route('**/api/comments/page?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic retained-page failure.'})}),{times:1});
  await page.getByRole('button',{name:'Load more comments',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic retained-page failure.');await expect(page.locator('.comment')).toHaveCount(50);
  await page.getByLabel('Search comments').fill('');await expect(text).toHaveValue('An editor draft preserved through bounded pagination.');
  let releasePage!:()=>void,readyPage!:()=>void,releaseCreation!:()=>void,readyCreation!:()=>void;
  const heldPage=new Promise<void>(resolve=>{releasePage=resolve;}),pageReady=new Promise<void>(resolve=>{readyPage=resolve;});
  const heldCreation=new Promise<void>(resolve=>{releaseCreation=resolve;}),creationReady=new Promise<void>(resolve=>{readyCreation=resolve;});
  let pageHeld=false;
  // Keep both interception patterns installed while their responses are held.
  await page.route('**/api/comments/page?*',async route=>{if(pageHeld){await route.continue();return;}pageHeld=true;const response=await route.fetch();assert.equal(response.status(),200);assert.equal((await response.json()).comments.length,50);readyPage();await heldPage;await route.fulfill({response});});
  await page.route('**/api/comments/submissions',async route=>{assert.equal(route.request().method(),'POST');const response=await route.fetch();assert.equal(response.status(),200);readyCreation();await heldCreation;await route.fulfill({response});});
  try{
    await page.getByRole('button',{name:'Load more comments',exact:true}).click();await pageReady;
    await expect(page.getByRole('button',{name:'Loading more comments...',exact:true})).toBeDisabled();
    await first.getByRole('button',{name:'Save comment changes',exact:true}).click();
    await expect(first.locator(':scope > div > p')).toHaveText('An editor draft preserved through bounded pagination.');
    await text.fill('A second private draft survives the pending page.');
    await expect(page.getByRole('button',{name:'Loading more comments...',exact:true})).toBeDisabled();
    await composer.fill('A new comment appears immediately beyond the initial 50 rows.');
    await page.getByRole('button',{name:'Post comment',exact:true}).click();await creationReady;
    await composer.fill('An independent new draft typed during the pending creation.');
    await expect(page.getByRole('button',{name:'Loading more comments...',exact:true})).toBeDisabled();
    releaseCreation();
    await expect(page.locator('.comment')).toHaveCount(51);
    await expect(page.getByText('A new comment appears immediately beyond the initial 50 rows.',{exact:true})).toBeVisible();
    await expect(composer).toHaveValue('An independent new draft typed during the pending creation.');
    await expect(page.getByRole('button',{name:'Loading more comments...',exact:true})).toBeDisabled();
    releasePage();await expect(page.locator('.comment')).toHaveCount(101);
    await expect(text).toHaveValue('A second private draft survives the pending page.');
  }finally{releaseCreation();releasePage();}
  let pages=2;
  while(await page.getByRole('button',{name:'Load more comments',exact:true}).count()){
    assert.ok(pages++<14);const before=await page.locator('.comment').count();
    await page.getByRole('button',{name:'Load more comments',exact:true}).click();
    await expect(page.locator('.comment')).toHaveCount(Math.min(before+50,552));
  }
  assert.equal(await page.locator('.comment').count(),552);
  await expect(page.getByText('A new comment appears immediately beyond the initial 50 rows.',{exact:true})).toHaveCount(1);
  await expect(text).toHaveValue('A second private draft survives the pending page.');
  await expect(composer).toHaveValue('An independent new draft typed during the pending creation.');
  const oldestHiddenOwner=page.locator('.comment').last();await expect(oldestHiddenOwner.locator(':scope > div > p')).toHaveText('Original paginated comment 550.');
  await oldestHiddenOwner.getByRole('button',{name:'Edit my comment',exact:true}).click();
  await expect(oldestHiddenOwner.getByLabel('Edit comment text')).toHaveValue('Original paginated comment 550.');
  await oldestHiddenOwner.getByLabel('Edit comment text').fill('An author can now edit a comment beyond the old 500-row ceiling.');
  await oldestHiddenOwner.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(oldestHiddenOwner.locator(':scope > div > p')).toHaveText('An author can now edit a comment beyond the old 500-row ceiling.');
  await oldestHiddenOwner.getByRole('button',{name:'Reply',exact:true}).click();
  await composer.fill('A browser reply preserves this older opaque parent.');
  await page.getByRole('button',{name:'Post comment',exact:true}).click();
  await expect(page.getByText('A browser reply preserves this older opaque parent.',{exact:true})).toBeVisible();
  assert.equal((await db.prepare('SELECT parent_id FROM comments WHERE resource=? AND body=?').get(resource,'A browser reply preserves this older opaque parent.'))?.parent_id,olderParent);
  assert.ok(reads.every(url=>new URL(url).pathname==='/api/comments/page'||new URL(url).pathname==='/api/comments/owned'));
  assert.ok(reads.filter(url=>new URL(url).pathname==='/api/comments/page').length<=15);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(f.documents.length,1);
});

test('superseded discussion pages and admitted creation responses cannot overwrite another resource or its new draft',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id;
  for(const id of ['old-paged-discussion','new-paged-discussion']){
    await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(id,'questions',`Original ${id}`,'A complete original local question with separate discussion scope.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
    for(let i=0;i<(id==='old-paged-discussion'?51:1);i++)await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(`${id}-${String(i).padStart(4,'0')}`,`post/${id}`,owner,'Synthetic scoped author',`Scoped comment ${id} ${i}.`,'2026-01-01T00:00:00.000Z',null);
  }
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:'old-paged-discussion'})}`);
  await expect(page.locator('.comment')).toHaveCount(50);
  let releasePage!:()=>void,readyPage!:()=>void,releaseCreation!:()=>void,readyCreation!:()=>void,finishedCreation!:()=>void;
  const heldPage=new Promise<void>(resolve=>{releasePage=resolve;}),pageReady=new Promise<void>(resolve=>{readyPage=resolve;});
  const heldCreation=new Promise<void>(resolve=>{releaseCreation=resolve;}),creationReady=new Promise<void>(resolve=>{readyCreation=resolve;}),creationFinished=new Promise<void>(resolve=>{finishedCreation=resolve;});
  await page.route('**/api/comments/page?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('resource')!=='post/old-paged-discussion'){await route.continue();return;}
    const response=await route.fetch();assert.equal(response.status(),200);readyPage();await heldPage;await route.fulfill({response});
  });
  await page.route('**/api/comments/submissions',async route=>{const response=await route.fetch();assert.equal(response.status(),200);readyCreation();await heldCreation;await route.fulfill({response});finishedCreation();},{times:1});
  try{
    await page.getByRole('button',{name:'Load more comments',exact:true}).click();await pageReady;
    await page.getByLabel('Add a comment').fill('Creation belongs only to the old discussion.');
    await page.getByRole('button',{name:'Post comment',exact:true}).click();await creationReady;
    await page.evaluate(route=>{history.pushState(null,'',route);window.dispatchEvent(new PopStateEvent('popstate'));},communityPostPath({kind:'questions',id:'new-paged-discussion'}));
    await expect(page.locator('.community-detail h1')).toHaveText('Original new-paged-discussion');
    await expect(page.locator('.comment')).toHaveCount(1);
    await page.getByLabel('Add a comment').fill('The new discussion draft must not be cleared.');
    releasePage();releaseCreation();await creationFinished;
    await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeEnabled();
    await expect(page.locator('.comment')).toHaveCount(1);
    await expect(page.getByText('Scoped comment new-paged-discussion 0.',{exact:true})).toBeVisible();
    await expect(page.getByText('Creation belongs only to the old discussion.',{exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toHaveValue('The new discussion draft must not be cleared.');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get('post/old-paged-discussion'))?.count,52);
  }finally{releasePage();releaseCreation();}
});

test('lost comment responses recover by checking or retrying the frozen key without clearing newer text, duplication or resurrection',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,post='receipt-recovery-parent',resource=`post/${post}`;
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'questions','A receipt recovery fixture','A complete original local question for lost comment responses.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:post})}`);
  await expect(page.getByText('Start a thoughtful conversation. No comments yet.',{exact:true})).toBeVisible();
  const composer=page.getByLabel('Add a comment'),postButton=page.getByRole('button',{name:'Post comment',exact:true});
  async function loseCommittedResponse() {
    await page.route('**/api/comments/submissions',async route=>{
      if(route.request().method()!=='POST'){await route.continue();return;}
      const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');
    },{times:1});
  }
  await loseCommittedResponse();
  await composer.fill('A committed comment whose first response is lost.');
  await postButton.click();
  const recovery=page.getByRole('region',{name:'Comment submission recovery'});
  await expect(recovery.getByRole('alert')).toContainText('Submission was not confirmed');
  const firstReference=(await recovery.locator('code').first().textContent())!;assert.match(firstReference,/^[a-f0-9-]{36}$/);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),1);
  await composer.fill('A newer independent draft must survive receipt checking.');
  await recovery.getByRole('button',{name:'Check comment submission',exact:true}).click();
  await expect(page.getByText('A committed comment whose first response is lost.',{exact:true})).toBeVisible();
  await expect(composer).toHaveValue('A newer independent draft must survive receipt checking.');
  await expect(recovery).toHaveCount(0);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),1);

  await loseCommittedResponse();
  await composer.fill('A second committed comment recovered by same-key retry.');
  await postButton.click();
  await expect(recovery.getByRole('alert')).toContainText('Submission was not confirmed');
  const secondReference=(await recovery.locator('code').first().textContent())!;assert.notEqual(secondReference,firstReference);
  await recovery.getByRole('button',{name:'Retry original comment submission',exact:true}).click();
  await expect(page.getByText('A second committed comment recovered by same-key retry.',{exact:true})).toBeVisible();
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),2);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM community_comment_submissions WHERE user_id=?').get(owner))?.count),2);

  await loseCommittedResponse();
  await composer.fill('A removed acknowledged comment must never be recreated.');
  await postButton.click();
  await expect(recovery.getByRole('alert')).toContainText('Submission was not confirmed');
  const removedReference=(await recovery.locator('code').first().textContent())!;
  const removed=await db.prepare('SELECT comment_id FROM community_comment_submissions WHERE request_id=?').get(removedReference);assert.equal(typeof removed?.comment_id,'string');
  const removedId=String(removed!.comment_id);
  await db.prepare('DELETE FROM comments WHERE id=?').run(removedId);
  await recovery.getByRole('button',{name:'Check comment submission',exact:true}).click();
  await expect(recovery.getByText('Created earlier; the comment is now unavailable. Retrying will not recreate it.',{exact:true})).toBeVisible();
  await recovery.getByRole('button',{name:'Check comment submission',exact:true}).click();
  assert.equal(await db.prepare('SELECT id FROM comments WHERE id=?').get(removedId),undefined);
  await expect(recovery.getByRole('button',{name:'Start a separate comment submission',exact:true})).toBeDisabled();
  await recovery.getByLabel('I understand a new submission does not cancel this request and could create an additional comment.').check();
  await recovery.getByRole('button',{name:'Start a separate comment submission',exact:true}).click();
  await expect(recovery).toHaveCount(0);
  await expect(composer).toHaveValue('A removed acknowledged comment must never be recreated.');
  await composer.fill('A deliberate separate comment after acknowledging the risk.');
  await postButton.click();
  await expect(page.getByText('A deliberate separate comment after acknowledging the risk.',{exact:true})).toBeVisible();
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE resource=?').get(resource))?.count),3);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('private comment submission history is opt-in, bounded, retryable and scoped across discussion, account and sign-out',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,post='receipt-history-parent',resource=`post/${post}`,otherResource='lesson/receipt-history-other';
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'questions','A private receipt history fixture','A complete original local question for private receipt history.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
  const created:string[]=[],references:string[]=[];
  for(let index=0;index<12;index++){
    const requestId=crypto.randomUUID(),response=await page.request.post(`${f.url}/api/comments/submissions`,{data:{requestId,resource,body:`Private current-resource submission ${index}.`}});
    assert.equal(response.status(),200);created.push((await response.json()).receipt.commentId);references.push(requestId);
  }
  const other=await page.request.post(`${f.url}/api/comments/submissions`,{data:{requestId:crypto.randomUUID(),resource:otherResource,body:'A private account-wide submission from another resource.'}});assert.equal(other.status(),200);
  await db.prepare('DELETE FROM comments WHERE id=?').run(created[0]);
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:post})}`);
  await expect(page.getByRole('heading',{name:'Your local comment submission history',exact:true})).toHaveCount(0);
  await page.route('**/api/comments/submissions?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic private history failure.'})}),{times:1});
  await page.getByRole('button',{name:'View comment submission history',exact:true}).click();
  const history=page.locator('.community-submission-history');
  await expect(history.getByRole('alert')).toContainText('Synthetic private history failure.');
  await history.getByRole('button',{name:'Retry submission history',exact:true}).click();
  await expect(history.locator('article')).toHaveCount(10);
  await expect(history).not.toContainText(otherResource);
  await history.getByRole('button',{name:'Load more comment submissions',exact:true}).click();
  await expect(history.locator('article')).toHaveCount(12);
  await expect(history.getByText('Created earlier; now unavailable. No recreation occurred.',{exact:true})).toHaveCount(1);
  await history.getByRole('button',{name:'My comment submissions',exact:true}).click();
  await expect(history.getByRole('heading',{name:'Your local comment submission history',exact:true})).toHaveCount(0);
  await history.getByRole('button',{name:'My comment submissions',exact:true}).click();
  await expect(history.locator('article')).toHaveCount(10);

  await page.goto(`${f.url}/account`);
  await page.getByRole('button',{name:'View comment submission history',exact:true}).click();
  const accountHistory=page.locator('.community-submission-history');
  await expect(accountHistory.locator('article')).toHaveCount(10);
  await expect(accountHistory.locator('article').filter({hasText:otherResource})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great interviews start with a little practice.',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Your Studio',exact:true}).click();
  await page.getByRole('button',{name:'Try the local demo',exact:true}).click();
  await page.locator('.sidebar-profile').click();
  await page.getByRole('button',{name:'View comment submission history',exact:true}).click();
  const otherActorHistory=page.locator('.community-submission-history');
  await expect(otherActorHistory.getByText('No recorded submissions in this view. Legacy comments have no fabricated receipts.',{exact:true})).toBeVisible();
  await expect(otherActorHistory).not.toContainText(references[0]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('local comment editing preserves conflict and lost-response drafts through closing, filtering and explicit saved-version adoption',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,id=' comment/?%# ',post='comment-editor-parent',resource=`post/${post}`;
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'questions','A comment editing fixture','An original local question with full context and reasoning.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,resource,owner,'Owned synthetic commenter','Original owner reply.','2026-01-01T00:00:00.000Z',null);
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run('retained-child',resource,'another-local-author','Reply author','A reply retained after owner deletion.','2026-01-01T00:00:01.000Z',id);
  for(let index=0;index<3;index++)await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(`other-comment-${index}`,resource,'another-local-author','Other retained commenter',`Other original reply ${index}.`,'2026-01-01T00:00:00.000Z',null);
  let releaseRead!:()=>void;
  const reading=new Promise<void>(resolve=>{releaseRead=resolve;});
  await page.route('**/api/comments/page?*',async route=>{
    const response=await route.fetch();assert.equal(response.status(),200);await reading;await route.fulfill({response});
  },{times:1});
  try{
    await page.goto(`${f.url}${communityPostPath({kind:'questions',id:post})}`);
    await expect(page.getByText('Loading the discussion...',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Post comment',exact:true})).toBeDisabled();
    await expect(page.getByText('Start a thoughtful conversation. No comments yet.',{exact:true})).toHaveCount(0);
  }finally{releaseRead();}
  const comment=page.locator('.comment').filter({has:page.getByText('Owned synthetic commenter',{exact:true})});
  await expect(page.getByRole('button',{name:'Edit my comment',exact:true})).toHaveCount(1);
  await comment.getByRole('button',{name:'Edit my comment',exact:true}).click();
  const text=comment.getByLabel('Edit comment text');
  await expect(text).toHaveValue('Original owner reply.');
  await text.fill('First confirmed comment edit.');
  await comment.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(comment.locator(':scope > div > p')).toHaveText('First confirmed comment edit.');
  await text.fill('A preserved uncommitted reply.');
  await db.prepare('UPDATE comments SET body=? WHERE id=?').run('A newer saved reply.',id);
  await comment.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(comment.getByRole('alert')).toContainText('changed');await expect(text).toHaveValue('A preserved uncommitted reply.');
  await comment.getByRole('button',{name:'Close editor',exact:true}).click();
  await expect(text).toHaveCount(0);
  await comment.getByRole('button',{name:'Edit my comment',exact:true}).click();await expect(text).toHaveValue('A preserved uncommitted reply.');
  await page.getByLabel('Search comments').fill('Other retained');
  await expect(comment).toBeHidden();
  await page.getByLabel('Search comments').fill('');await expect(text).toHaveValue('A preserved uncommitted reply.');
  await comment.getByRole('button',{name:'Check saved version',exact:true}).click();
  await expect(comment.getByRole('heading',{name:'Current saved version',exact:true})).toBeVisible();await expect(text).toHaveValue('A preserved uncommitted reply.');
  await comment.getByRole('button',{name:'Replace my draft with saved version',exact:true}).click();
  await expect(text).toHaveValue('A newer saved reply.');await expect(comment.locator(':scope > div > p')).toHaveText('A newer saved reply.');
  await text.fill('A committed but unconfirmed reply.');
  await page.route('**/api/comments/owned',async route=>{
    assert.equal(route.request().method(),'PUT');const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');
  },{times:1});
  await comment.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(comment.getByRole('alert')).toContainText('Saving was not confirmed');
  await expect(text).toHaveValue('A committed but unconfirmed reply.');
  await expect(comment.locator(':scope > div > p')).toHaveText('A newer saved reply.');
  assert.equal((await db.prepare('SELECT revision FROM community_comment_revisions WHERE comment_id=?').get(id))?.revision,3);
  assert.equal(f.mutations.filter(path=>path==='/api/comments/owned').length,3);
  await comment.getByRole('button',{name:'Check saved version',exact:true}).click();
  await expect(comment.getByRole('heading',{name:'Current saved version',exact:true})).toBeVisible();
  await expect(text).toHaveValue('A committed but unconfirmed reply.');
  await comment.getByRole('button',{name:'Replace my draft with saved version',exact:true}).click();
  await expect(comment.locator(':scope > div > p')).toHaveText('A committed but unconfirmed reply.');
  await expect(comment.getByRole('button',{name:'Delete my local comment',exact:true})).toBeVisible();
  await text.fill('x'.repeat(3000));await comment.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(comment.locator(':scope > div > p')).toHaveText('x'.repeat(3000));
  const deletionKeys:string[]=[];
  await page.route('**/api/comments/owned',async route=>{
    if(route.request().method()!=='DELETE'){await route.continue();return;}
    deletionKeys.push(String(route.request().postDataJSON().requestId));
    if(deletionKeys.length===1){const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}
    else await route.continue();
  });
  await comment.getByLabel('I understand the original comment text and authorship cannot be restored.').check();
  await comment.getByRole('button',{name:'Delete my local comment',exact:true}).click();
  await expect(comment.getByRole('alert')).toContainText('Deletion was not confirmed');
  await expect(comment.getByText(/Deletion request:/)).toBeVisible();
  await comment.getByRole('button',{name:'Retry same comment deletion',exact:true}).click();
  assert.equal(deletionKeys.length,2);assert.equal(deletionKeys[0],deletionKeys[1]);
  const tombstone=page.locator('.comment').filter({has:page.getByText('This comment was removed by its author.',{exact:true})});
  await expect(tombstone.getByText('Deleted',{exact:true})).toBeVisible();
  await expect(tombstone.getByRole('button',{name:'Reply',exact:true})).toHaveCount(0);
  await expect(page.getByText('A reply retained after owner deletion.',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(f.documents.length,1);
});

test('superseded comment-owner reads cannot publish into another discussion or expose editing to a different account',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id;
  for(const id of ['first-comment-page','second-comment-page']){
    await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(id,'questions',`Original ${id}`,'A complete original local question for this discussion.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
    await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,`post/${id}`,owner,'Synthetic commenter',`Original comment for ${id}.`,'2026-01-01T00:00:00.000Z',null);
  }
  let entered!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/comments/owned?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('id')!=='first-comment-page'){await route.continue();return;}
    const response=await route.fetch();entered();await gate;await route.fulfill({response});
  });
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:'first-comment-page'})}`);
  try{
    await page.getByRole('button',{name:'Edit my comment',exact:true}).click();await waiting;
    await page.evaluate(route=>{history.pushState(null,'',route);window.dispatchEvent(new PopStateEvent('popstate'));},communityPostPath({kind:'questions',id:'second-comment-page'}));
    await expect(page.locator('.community-detail h1')).toHaveText('Original second-comment-page');release();
    await page.getByRole('button',{name:'Edit my comment',exact:true}).click();
    await expect(page.getByLabel('Edit comment text')).toHaveValue('Original comment for second-comment-page.');
    const stranger=await page.request.post(`${f.url}/api/auth/signup`,{data:{name:'A different commenter',email:`comment-${Date.now()}@example.invalid`,password:'fixture-password-123'}});assert.equal(stranger.status(),200);
    await page.reload();await expect(page.getByText('Original comment for second-comment-page.',{exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Edit my comment',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Edit comment text')).toHaveCount(0);
  }finally{release();}
});

test('lost owner edit and deletion responses preserve drafts without replay or claiming an unconfirmed outcome',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,id='lost-owner-response';
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(id,'stories','Original response-loss story','An original local story with complete reasoning and context.','Fixture Company','system-design','Senior','Global','Synthetic author',owner,'2026-01-01T00:00:00.000Z');
  await page.goto(`${f.url}${communityPostPath({kind:'stories',id})}`);
  await page.getByRole('button',{name:'Manage your post',exact:true}).click();
  const editor=page.locator('#owned-contribution'),title=editor.getByLabel('Edit post title');
  await expect(title).toHaveValue('Original response-loss story');await title.fill('A committed response-loss edit');
  const dropped=new Set<string>();
  await page.route('**/api/posts/owned',async route=>{
    const method=route.request().method();
    if(['PUT','DELETE'].includes(method)&&!dropped.has(method)){
      dropped.add(method);const response=await route.fetch();assert.equal(response.status(),200);
      await route.abort('failed');
    }else await route.continue();
  });
  await editor.getByRole('button',{name:'Save post changes',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Saving was not confirmed');
  await expect(title).toHaveValue('A committed response-loss edit');
  await expect(page.locator('.community-detail h1')).toHaveText('Original response-loss story');
  assert.equal((await db.prepare('SELECT revision FROM community_post_revisions WHERE post_id=?').get(id))?.revision,1);
  assert.equal(f.mutations.filter(path=>path==='/api/posts/owned').length,1);
  await editor.getByRole('button',{name:'Check saved version',exact:true}).click();
  await expect(editor.getByRole('heading',{name:'Current saved version',exact:true})).toBeVisible();
  await expect(title).toHaveValue('A committed response-loss edit');
  await editor.getByRole('button',{name:'Save post changes',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('changed');
  await editor.getByRole('button',{name:'Replace my draft with saved version',exact:true}).click();
  await expect(page.locator('.community-detail h1')).toHaveText('A committed response-loss edit');
  await editor.getByLabel('I understand this deletes my post, its discussion, votes and follows.').check();
  await editor.getByRole('button',{name:'Delete my local post',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Deletion was not confirmed');
  assert.equal(await db.prepare('SELECT id FROM posts WHERE id=?').get(id),undefined);
  assert.equal(f.mutations.filter(path=>path==='/api/posts/owned').length,3);
  await expect(page.locator('.community-detail h1')).toHaveText('A committed response-loss edit');
  await editor.getByRole('button',{name:'Check saved version',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('unavailable');
  await expect(title).toHaveValue('A committed response-loss edit');
  await editor.getByRole('button',{name:'Delete my local post',exact:true}).click();
  await expect(editor.getByRole('alert')).toContainText('Deletion was not confirmed');
  await page.locator('main').getByRole('link',{name:'Preparation stories',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Preparation stories',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'A committed response-loss edit',exact:true})).toHaveCount(0);
  assert.equal(f.documents.length,1);
});

test('owner controls exclude strangers and examples, and a superseded private editor read cannot publish its old draft',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id;
  for(const [id,title,author,sample] of [['first-owner','First original owner post',owner,0],['second-owner','Second original owner post',owner,0],['stranger-owner','Another account original post','another-account',0],['owned-example','An immutable owner example',owner,1]] as const)
    await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'questions',title,'An original local question with complete context and reasoning.','Fixture Company','system-design','Senior','Global','Anonymous',author,'2026-01-01T00:00:00.000Z',sample);
  for(const id of ['stranger-owner','owned-example']){
    await page.goto(`${f.url}${communityPostPath({kind:'questions',id})}`);
    await expect(page.locator('.community-detail h1')).toBeVisible();
    await expect(page.getByRole('button',{name:'Manage your post',exact:true})).toHaveCount(0);
  }
  let entered!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/posts/owned?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('id')!=='first-owner'){await route.continue();return;}
    const response=await route.fetch();entered();await gate;
    await route.fulfill({response});
  });
  await page.goto(`${f.url}${communityPostPath({kind:'questions',id:'first-owner'})}`);
  try{
    await page.getByRole('button',{name:'Manage your post',exact:true}).click();await waiting;
    await page.evaluate(route=>{history.pushState(null,'',route);window.dispatchEvent(new PopStateEvent('popstate'));},communityPostPath({kind:'questions',id:'second-owner'}));
    await expect(page.locator('.community-detail h1')).toHaveText('Second original owner post');
    await expect(page.locator('#owned-contribution')).toHaveCount(0);
    release();
    await page.getByRole('button',{name:'Manage your post',exact:true}).click();
    await expect(page.getByLabel('Edit post title')).toHaveValue('Second original owner post');
    await expect(page.locator('#owned-contribution')).not.toContainText('First original owner post');
  }finally{release();}
});

test('complete eager, landing and sign-in JavaScript graphs meet fixed raw/gzip budgets without deferred discovery modules', async t => {
  assert.deepEqual(navigationTracks, tracks.map(({ id, title, short, description, color }) => ({ id, title, short, description, color })));
  for (const [label, roots] of [
    ['entry', ['index.html']],
    ['landing', ['index.html', 'src/pages/Landing.tsx']],
    ['auth', ['index.html', 'src/pages/Auth.tsx']],
  ] as const) {
    let raw = 0, gzip = 0;
    const files = graph(...roots);
    for (const file of files) {
      assert.doesNotMatch(file, /\/(?:Home|Explore|Learn|Practice|Projects|Premium|Quiz|components|public-(?:tracks|problems|courses|quiz))-/);
      const bytes = await readFile(path.join('dist', file));
      raw += bytes.length;
      gzip += gzipSync(bytes).length;
    }
    t.diagnostic(`${label}: ${raw} raw bytes, ${gzip} gzip-estimate bytes across ${files.length} JavaScript assets.`);
    assert.ok(raw <= 350 * 1024, `${label} raw graph exceeds 350 KiB: ${raw}`);
    assert.ok(gzip <= 100 * 1024, `${label} gzip estimate exceeds 100 KiB: ${gzip}`);
  }
});

test('every manifest asset is present and served as its actual bytes, not a successful HTML fallback', async t => {
  const f = await fixture(t);
  const files = new Set(Object.values(manifest).flatMap(item => [item.file, ...item.css ?? [], ...item.assets ?? []]));
  for (const file of files) {
    assert.match(file, /^assets\/[\w.-]+$/);
    const expected = await readFile(path.join('dist', file)), response = await fetch(`${f.url}/${file}`);
    assert.equal(response.status, 200, file);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, file);
    if (file.endsWith('.js')) assert.match(response.headers.get('content-type') ?? '', /javascript/);
  }
});

test('built browser runner enforces bounded non-authoritative execution and recovers after termination',async t=>{
  const f=await fixture(t),{page}=f,external:string[]=[];
  page.on('request',request=>{const url=new URL(request.url());if(/^https?:$/.test(url.protocol)&&url.origin!==f.url)external.push(request.url());});
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  await page.goto(`${f.url}/practice/ai-coding/task-board`);
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  await expect(page.getByText(/not authoritative grading or a reliable memory sandbox/)).toBeVisible();
  const editor=page.getByLabel('Code editor',{exact:true}),run=page.getByRole('button',{name:'Run tests',exact:true});
  await editor.fill('function solve(input){fetch("https://example.invalid/runner-probe").catch(()=>{});return input.filter(t=>!t.completed).map(t=>t.title).sort();}');
  await run.click();
  await expect(page.getByText('PASS · Mixed tasks',{exact:true})).toBeVisible();
  await editor.fill('function solve(){return "x".repeat(70000);}');
  await run.click();
  await expect(page.getByText(/64 KiB per-value browser-runner limit/).first()).toBeVisible();
  await editor.fill('function solve(){const value={};value.self=value;return value;}');
  await run.click();
  await expect(page.getByText(/circular references/).first()).toBeVisible();
  await editor.fill('function solve(input){while(true){}}');
  await run.click();
  await expect(page.getByRole('alert')).toContainText('2-second limit');
  await editor.fill('function solve(input){return input.filter(t=>!t.completed).map(t=>t.title).sort();}');
  await run.click();
  await expect(page.getByText('PASS · All completed',{exact:true})).toBeVisible();
  await expect(page.locator('iframe[title="Isolated code runner"]')).toHaveCount(0);
  assert.deepEqual(external,[]);
});

test('coarse-pointer critical flows keep sampled controls at 44 CSS pixels without overlap',async t=>{
  const f=await fixture(t),context=await f.browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  t.after(()=>context.close());
  const page=await context.newPage();
  const selector=`button,a.button,.nav-link,.nav-group,.sidebar-bottom-links>a,.topbar-actions>a,.shell-footer a,
    input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),select,textarea,summary,
    .checkbox-label,label:has(>input[type="checkbox"]),label:has(>input[type="radio"])`;
  async function inspect(label:string) {
    const controls=await page.locator(selector).evaluateAll(elements=>elements.filter(element=>{
      const style=getComputedStyle(element),rect=element.getBoundingClientRect();
      return style.visibility!=='hidden'&&style.display!=='none'&&rect.width>0&&rect.height>0;
    }).map((element,index)=>{
      const rect=element.getBoundingClientRect();
      return {index,tag:element.tagName.toLowerCase(),name:element.getAttribute('aria-label')||
        element.textContent?.trim().replace(/\s+/g,' ').slice(0,80)||'',x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    }));
    assert.deepEqual(controls.filter(control=>control.width<43.5||control.height<43.5),[],`${label}: undersized controls`);
    const overlaps:string[]=[];
    for(let left=0;left<controls.length;left++)for(let right=left+1;right<controls.length;right++){
      const a=controls[left],b=controls[right],width=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
      const height=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      if(width>1&&height>1)overlaps.push(`${a.tag}:${a.name} overlaps ${b.tag}:${b.name}`);
    }
    assert.deepEqual(overlaps,[],`${label}: overlapping controls`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${label}: horizontal overflow`);
  }
  await page.goto(`${f.url}/auth`);
  await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
  await inspect('public auth');
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  for(const [route,text] of [
    ['/dashboard','Good to see you, Alex.'],
    ['/practice/ai-coding/task-board','Start practice'],
    ['/community/questions','Interview questions'],
    ['/account','A few things about you.'],
    ['/support','What’s getting in your way?'],
  ] as const){
    await page.goto(`${f.url}${route}`);
    await expect(page.locator('main')).toContainText(text);
    await inspect(route);
  }
});

test('critical flows meet computed text and focus contrast in both themes',async t=>{
  const f=await fixture(t);
  async function inspect(page:Page,label:string) {
    const result=await page.locator('body').evaluate(body=>{
      type Color=[number,number,number,number];
      const helper={
        parse(value:string):Color{
          const parts=value.match(/[\d.]+/g)?.map(Number)??[];
          return [parts[0]??0,parts[1]??0,parts[2]??0,parts.length>3?parts[3]:1];
        },
        blend(front:Color,back:Color):Color{
          const alpha=front[3]+back[3]*(1-front[3]);
          return alpha===0?[0,0,0,0]:[
            (front[0]*front[3]+back[0]*back[3]*(1-front[3]))/alpha,
            (front[1]*front[3]+back[1]*back[3]*(1-front[3]))/alpha,
            (front[2]*front[3]+back[2]*back[3]*(1-front[3]))/alpha,
            alpha,
          ];
        },
        luminance(color:Color){
          const channels=color.slice(0,3).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
          return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
        },
        ratio(left:Color,right:Color){
          const a=this.luminance(left),b=this.luminance(right);
          return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        },
        background(element:Element){
          const chain:Element[]=[];
          for(let current:Element|null=element;current;current=current.parentElement)chain.unshift(current);
          let colors:Color[]=[[255,255,255,1]],unsupported='';
          for(const current of chain){
            const style=getComputedStyle(current),layer=this.parse(style.backgroundColor);
            if(layer[3]>=.999)unsupported=style.backgroundImage==='none'?'':style.backgroundImage.slice(0,80);
            colors=colors.map(color=>this.blend(layer,color));
            if(style.backgroundImage!=='none'){
              if(style.backgroundImage.includes('gradient(')){
                const stops:Color[]=[];
                for(const match of style.backgroundImage.matchAll(/rgba?\([^)]+\)/g))stops.push(this.parse(match[0]));
                if(stops.length){
                  const candidates:Color[]=[];
                  for(const stop of stops)for(const color of colors)candidates.push(this.blend(stop,color));
                  colors=candidates;
                }else unsupported=style.backgroundImage.slice(0,80);
              }else unsupported=style.backgroundImage.slice(0,80);
            }
          }
          return {colors,unsupported};
        },
        visible(element:HTMLElement){
          const style=getComputedStyle(element),rect=element.getBoundingClientRect();
          return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
        },
        exempt(element:HTMLElement){
          return element.matches(':disabled,[aria-disabled="true"],[aria-hidden="true"]')||!!element.closest(':disabled,[aria-disabled="true"],[aria-hidden="true"]');
        },
      };
      const failures:{element:string;text:string;ratio?:number;required?:number;foreground?:string;background?:string;unsupported?:string}[]=[];
      for(const element of Array.from(body.querySelectorAll<HTMLElement>('*'))){
        if(!helper.visible(element)||helper.exempt(element))continue;
        const direct=Array.from(element.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent?.trim()??'').filter(Boolean).join(' ');
        const placeholder=element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement
          ? !element.value&&element.placeholder?element.placeholder:''
          :'';
        for(const [text,pseudo] of [[direct,''],[placeholder,'::placeholder']] as const){
          if(!text)continue;
          const style=getComputedStyle(element,pseudo),bg=helper.background(element);
          if(bg.unsupported){
            failures.push({element:`${element.tagName.toLowerCase()}.${element.className}`,text:text.slice(0,80),unsupported:bg.unsupported});
            continue;
          }
          const foreground=helper.parse(style.color);
          foreground[3]*=Number(style.opacity);
          const size=parseFloat(style.fontSize),weight=Number(style.fontWeight)||400;
          const required=size>=24||size>=18.66&&weight>=700?3:4.5;
          let actual=Infinity,worst=bg.colors[0];
          for(const color of bg.colors){
            const candidate=helper.ratio(helper.blend(foreground,color),color);
            if(candidate<actual){actual=candidate;worst=color;}
          }
          if(actual+.01<required)failures.push({
            element:`${element.tagName.toLowerCase()}.${element.className}`,
            text:text.slice(0,80),
            ratio:Number(actual.toFixed(2)),
            required,
            foreground:style.color,
            background:`rgb(${worst.slice(0,3).map(value=>Math.round(value)).join(', ')})`,
          });
        }
      }
      return failures.slice(0,50);
    });
    assert.deepEqual(result,[],`${label}: text contrast failures`);
    await page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    const target=page.locator(':focus-visible').first();
    for(let attempt=0;attempt<4&&!await target.count();attempt++)await page.keyboard.press('Tab');
    await expect(target).toBeVisible();
    const focus=await target.evaluate(element=>{
      const helper={
        parse(value:string){return value.match(/[\d.]+/g)?.slice(0,3).map(Number)??[0,0,0];},
        luminance(color:number[]){return color.map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);},
      };
      const style=getComputedStyle(element),foreground=helper.parse(style.outlineColor);
      let parent=element.parentElement,surface=[255,255,255];
      while(parent){
        const color=getComputedStyle(parent).backgroundColor,parts=color.match(/[\d.]+/g)?.map(Number)??[];
        if((parts[3]??1)>.99){surface=helper.parse(color);break;}
        parent=parent.parentElement;
      }
      const left=helper.luminance(foreground),right=helper.luminance(surface);
      return {style:style.outlineStyle,width:parseFloat(style.outlineWidth),ratio:(Math.max(left,right)+.05)/(Math.min(left,right)+.05)};
    });
    assert.equal(focus.style,'solid',`${label}: focus outline style`);
    assert.ok(focus.width>=2,`${label}: focus outline width ${focus.width}`);
    assert.ok(focus.ratio>=3,`${label}: focus outline contrast ${focus.ratio}`);
  }
  for(const theme of ['light','dark'] as const){
    const context=await f.browser.newContext({viewport:{width:1280,height:900}});
    await context.addInitScript(value=>localStorage.setItem('studio-theme',value),theme);
    try{
      const page=await context.newPage();
      await page.goto(`${f.url}/auth`);
      await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
      await inspect(page,`${theme} public auth`);
      await page.getByRole('button',{name:'Password recovery availability'}).click();
      await expect(page.getByRole('alert')).toContainText('Email-based password recovery is not configured.');
      await inspect(page,`${theme} public auth error`);
      const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
      for(const [route,text] of [
        ['/dashboard','Good to see you, Alex.'],
        ['/practice/ai-coding/task-board','Start practice'],
        ['/community/questions','Interview questions'],
        ['/account','A few things about you.'],
        ['/support','What’s getting in your way?'],
      ] as const){
        await page.goto(`${f.url}${route}`);
        await expect(page.locator('main')).toContainText(text);
        if(route==='/dashboard')await expect(page.getByRole('link',{name:'Your dashboard'})).toHaveAttribute('aria-current','page');
        await inspect(page,`${theme} ${route}`);
      }
    }finally{await context.close();}
  }
});

test('critical forms expose names, associated instructions, native invalid focus and announced outcomes',async t=>{
  const f=await fixture(t),context=await f.browser.newContext({viewport:{width:1280,height:900}});
  t.after(()=>context.close());
  const page=await context.newPage(),requests:string[]=[];
  page.on('request',request=>requests.push(`${request.method()} ${new URL(request.url()).pathname}`));
  async function inspect(label:string) {
    const result=await page.locator('body').evaluate(body=>{
      const helper={visible(element:HTMLElement){
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
      }};
      const unnamed=Array.from(body.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:not([type="hidden"]),select,textarea'))
        .filter(element=>helper.visible(element)).filter(element=>!element.getAttribute('aria-label')&&!Array.from(element.labels??[]).some(label=>label.textContent?.trim()))
        .map(element=>`${element.tagName.toLowerCase()}:${element.type||''}`);
      const missing=Array.from(body.querySelectorAll<HTMLElement>('[aria-describedby]')).filter(element=>helper.visible(element)).flatMap(element=>
        (element.getAttribute('aria-describedby')??'').split(/\s+/).filter(Boolean).filter(id=>!document.getElementById(id))
          .map(id=>`${element.tagName.toLowerCase()}:${id}`));
      return {unnamed,missing};
    });
    assert.deepEqual(result,{unnamed:[],missing:[]},`${label}: form semantics`);
  }
  await page.goto(`${f.url}/auth`);
  await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
  await inspect('login');
  let before=requests.length;
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForTimeout(50);
  assert.equal(requests.length,before,'blank login issued a request');
  const email=page.getByLabel('Email'),password=page.getByLabel('Password');
  await expect(email).toBeFocused();
  assert.equal(await email.evaluate(element=>(element as HTMLInputElement).validity.valueMissing),true);
  await email.fill('nobody@example.invalid');await password.fill('wrong-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  assert.ok((await page.getByRole('alert').innerText()).trim().length>0);
  await page.getByRole('button',{name:'Create account'}).click();
  await inspect('signup');
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-describedby','local-password-help');
  await expect(page.locator('#local-password-help')).toContainText('at least 10 characters');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email').fill('alex.forms@example.invalid');
  await page.getByLabel('Password').fill('short');
  before=requests.length;
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.waitForTimeout(50);
  assert.equal(requests.length,before,'short signup password issued a request');
  await expect(page.getByLabel('Password')).toBeFocused();
  assert.equal(await page.getByLabel('Password').evaluate(element=>(element as HTMLInputElement).validity.tooShort),true);
  const signup=await page.request.post(`${f.url}/api/auth/signup`,{data:{name:'Alex',email:'alex.forms@example.invalid',password:'correct-horse-staple'}});
  assert.equal(signup.status(),200);
  await page.goto(`${f.url}/account`);
  await expect(page.locator('main')).toContainText('A few things about you.');
  await inspect('account');
  await expect(page.getByLabel('New password')).toHaveAttribute('aria-describedby','local-new-password-help');
  const displayName=page.getByLabel('Display name');
  await displayName.fill('');
  before=requests.length;
  await page.getByRole('button',{name:'Save profile'}).click();
  await page.waitForTimeout(50);
  assert.equal(requests.length,before,'blank display name issued a request');
  await expect(displayName).toBeFocused();
  await page.goto(`${f.url}/support`);
  await expect(page.locator('main')).toContainText('What’s getting in your way?');
  await inspect('support');
  const contact=page.getByLabel('Contact email'),question=page.getByLabel('Support question');
  await expect(question).toHaveAttribute('aria-describedby','support-question-help');
  await contact.fill('');await question.fill('This support question is long enough to submit.');
  before=requests.length;
  await page.getByRole('button',{name:'Save local ticket'}).click();
  await page.waitForTimeout(50);
  assert.equal(requests.length,before,'missing support email issued a request');
  await expect(contact).toBeFocused();
  await contact.fill('alex.forms@example.invalid');await question.fill('too short');
  before=requests.length;
  await page.getByRole('button',{name:'Save local ticket'}).click();
  await page.waitForTimeout(50);
  assert.equal(requests.length,before,'short support question issued a request');
  await expect(question).toBeFocused();
  await question.fill('This support question is long enough and contains no confidential details.');
  await page.getByRole('button',{name:'Save local ticket'}).click();
  await expect(page.getByRole('status')).toContainText('No external delivery occurred.');
});

test('reduced motion suppresses automatic movement while preserving visible status and manual progress',async t=>{
  const f=await fixture(t),context=await f.browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  t.after(()=>context.close());
  const page=await context.newPage();
  async function inspect(label:string) {
    const violations=await page.locator('body').evaluate(body=>{
      const helper={
        seconds(value:string){return value.split(',').some(part=>Number.parseFloat(part)>0);},
        visible(element:Element){const rect=element.getBoundingClientRect(),style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';},
      };
      return Array.from(body.querySelectorAll('*')).filter(element=>helper.visible(element)).flatMap(element=>{
        const failures:string[]=[];
        for(const pseudo of [null,'::before','::after'] as const){
          const style=getComputedStyle(element,pseudo),name=`${element.tagName.toLowerCase()}${pseudo??''}`;
          if(style.animationName!=='none'||helper.seconds(style.animationDuration))failures.push(`${name}:animation=${style.animationName}/${style.animationDuration}`);
          if(helper.seconds(style.transitionDuration))failures.push(`${name}:transition=${style.transitionDuration}`);
          if(style.scrollBehavior==='smooth')failures.push(`${name}:scroll=smooth`);
        }
        return failures;
      });
    });
    assert.deepEqual(violations,[],`${label}: reduced-motion violations`);
  }
  let releaseBoot!:()=>void;
  const bootGate=new Promise<void>(resolve=>{releaseBoot=resolve;});
  t.after(()=>releaseBoot());
  await page.route('**/api/bootstrap',async route=>{await bootGate;await route.continue();});
  await page.goto(`${f.url}/auth`);
  await expect(page.locator('.boot-screen')).toContainText('Opening your Studio');
  const indicator=await page.locator('.loading-bar').evaluate(element=>{
    const bar=element.getBoundingClientRect(),style=getComputedStyle(element,'::after');
    return {animation:style.animationName,left:Number.parseFloat(style.left),width:Number.parseFloat(style.width),barWidth:bar.width};
  });
  assert.equal(indicator.animation,'none');
  assert.ok(indicator.left>=0&&indicator.left+indicator.width<=indicator.barWidth,`static loading indicator outside track: ${JSON.stringify(indicator)}`);
  await inspect('boot');
  releaseBoot();
  await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
  await inspect('auth');
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  await page.goto(`${f.url}/dashboard`);
  await expect(page.getByRole('heading',{name:'Good to see you, Alex.',exact:true})).toBeVisible();
  await inspect('dashboard');
  await page.goto(`${f.url}/learn`);
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  t.after(()=>release());
  await page.route(`**/${manifest['src/pages/Quiz.tsx'].file}`,async route=>{await gate;await route.continue();});
  await page.getByRole('link',{name:'Quizzes',exact:true}).click();
  const loading=page.getByRole('status',{name:'Loading screen'});
  await expect(loading).toBeVisible();
  await inspect('loading');
  release();
  await expect(page.getByRole('heading',{name:'Check what you know.',exact:true})).toBeVisible();
  await page.goto(`${f.url}/learn/code/two-pointers`);
  await expect(page.getByText('Reduced motion is on. Use Step to advance manually.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play',exact:true})).toHaveCount(0);
  await expect(page.getByText('Step 1 of 3',{exact:true})).toBeVisible();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Play',exact:true}).click();
  await expect(page.getByText('Step 2 of 3',{exact:true})).toBeVisible({timeout:2000});
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.getByText('Reduced motion is on. Use Step to advance manually.',{exact:true})).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('Step 2 of 3',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.getByText('Step 3 of 3',{exact:true})).toBeVisible();
  await inspect('algorithm lab');
});

test('critical flows reflow with WCAG text spacing and retain forced-colors state and focus',async t=>{
  const f=await fixture(t);
  const spacing=`
    html *:not(svg):not(svg *) {
      line-height: 1.5 !important;
      letter-spacing: .12em !important;
      word-spacing: .16em !important;
    }
    p { margin-bottom: 2em !important; }
  `;
  async function inspectReflow(page:Page,label:string) {
    await page.addStyleTag({content:spacing});
    const result=await page.locator('body').evaluate(body=>{
      const documentWidth=document.documentElement.scrollWidth,viewportWidth=document.documentElement.clientWidth;
      const clipped=Array.from(body.querySelectorAll<HTMLElement>('*')).flatMap(element=>{
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        if(style.display==='none'||style.visibility==='hidden'||rect.width===0||rect.height===0)return [];
        const direct=Array.from(element.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent?.trim());
        if(!direct)return [];
        const horizontal=['hidden','clip'].includes(style.overflowX)&&element.scrollWidth>element.clientWidth+1;
        const vertical=['hidden','clip'].includes(style.overflowY)&&element.scrollHeight>element.clientHeight+1;
        return horizontal||vertical?[`${element.tagName.toLowerCase()}.${element.className}:${element.clientWidth}x${element.clientHeight}/${element.scrollWidth}x${element.scrollHeight}`]:[];
      });
      const offscreen=Array.from(body.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary')).flatMap(element=>{
        const style=getComputedStyle(element),rect=element.getBoundingClientRect();
        if(style.display==='none'||style.visibility==='hidden'||rect.width===0||rect.height===0)return [];
        return rect.left<-1||rect.right>window.innerWidth+1?[`${element.tagName.toLowerCase()}:${Math.round(rect.left)}-${Math.round(rect.right)}`]:[];
      });
      return {documentWidth,viewportWidth,clipped,offscreen};
    });
    assert.ok(result.documentWidth<=result.viewportWidth+1,`${label}: horizontal overflow ${result.documentWidth}/${result.viewportWidth}`);
    assert.deepEqual(result.clipped,[],`${label}: clipped direct text`);
    assert.deepEqual(result.offscreen,[],`${label}: offscreen controls`);
  }
  const reflow=await f.browser.newContext({viewport:{width:320,height:800}});
  try{
    const page=await reflow.newPage();
    await page.goto(`${f.url}/auth`);
    await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
    await inspectReflow(page,'auth');
    const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
    for(const [route,text] of [
      ['/dashboard','Good to see you, Alex.'],
      ['/practice/ai-coding/task-board','Start practice'],
      ['/community/questions','Interview questions'],
      ['/account','A few things about you.'],
      ['/support','What’s getting in your way?'],
    ] as const){
      await page.goto(`${f.url}${route}`);
      await expect(page.locator('main')).toContainText(text);
      await inspectReflow(page,route);
    }
  }finally{await reflow.close();}
  const forced=await f.browser.newContext({viewport:{width:1280,height:900},forcedColors:'active'});
  try{
    const page=await forced.newPage();
    await page.goto(`${f.url}/auth`);
    await expect(page.getByRole('heading',{name:'Welcome back.',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Password recovery availability'}).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
    await page.goto(`${f.url}/dashboard`);
    await expect(page.getByRole('link',{name:'Your dashboard'})).toHaveAttribute('aria-current','page');
    await page.goto(`${f.url}/learn/system-design`);
    await expect(page.getByRole('heading',{name:'System Design',exact:true})).toBeVisible();
    const forcedResult=await page.locator('body').evaluate(body=>{
      const disabled=Array.from(body.querySelectorAll<HTMLElement>('*')).filter(element=>getComputedStyle(element).forcedColorAdjust==='none').map(element=>element.tagName.toLowerCase());
      const progress=body.querySelector<HTMLElement>('.progress'),fill=progress?.querySelector<HTMLElement>('span');
      return {
        disabled,
        progressBorder:progress?Number.parseFloat(getComputedStyle(progress).borderTopWidth):0,
        progressFill:fill?getComputedStyle(fill).backgroundColor:'',
      };
    });
    assert.deepEqual(forcedResult.disabled,[]);
    assert.ok(forcedResult.progressBorder>=1);
    assert.notEqual(forcedResult.progressFill,'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{
      const element=document.activeElement as HTMLElement|null,style=element?getComputedStyle(element):null;
      return {tag:element?.tagName.toLowerCase()??'',outline:style?.outlineStyle??'',width:Number.parseFloat(style?.outlineWidth??'0'),color:style?.outlineColor??''};
    });
    assert.ok(focus.tag);
    assert.equal(focus.outline,'solid');
    assert.ok(focus.width>=2,`forced-colors focus width ${focus.width}`);
    assert.notEqual(focus.color,'rgba(0, 0, 0, 0)');
  }finally{await forced.close();}
});

test('cold real-browser landing and sign-in request exactly their static dependency closures', async t => {
  const f = await fixture(t);
  for (const [route, module, heading] of [
    ['/', 'src/pages/Landing.tsx', 'Great interviews start with a little practice.'],
    ['/auth', 'src/pages/Auth.tsx', 'Welcome back.'],
  ] as const) {
    const context = await f.browser.newContext(), page = await context.newPage(), requested = new Set<string>();
    try {
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.origin === f.url && url.pathname.endsWith('.js')) requested.add(url.pathname.slice(1));
      });
      await page.goto(`${f.url}${route}`);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      assert.deepEqual([...requested].sort(), graph('index.html', module));
      if (route === '/auth') await expect(page.getByText('Revisit the questions you missed', { exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});

test('a delayed built route shows accessible loading while the same shell and its state stay usable', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`**/${manifest['src/pages/Quiz.tsx'].file}`, async route => { await gate; await route.continue(); });
  await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading screen' })).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  release();
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading screen' })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme', exact: true })).toBeFocused();
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('query-only search updates preserve focus and the selected category', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/search`);
  const main = page.locator('main'), input = main.getByRole('textbox', { name: 'Search the Studio', exact: true });
  await main.getByRole('button', { name: 'Lessons', exact: true }).click();
  let query = '';
  for (const character of 'caching') {
    query += character;
    await input.press(character);
    await expect(page).toHaveURL(`${f.url}/search?q=${query}`);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(query);
    await expect(main.getByRole('button', { name: 'Lessons', exact: true })).toHaveClass('active');
  }
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('rapid search typing retains every character and follows canonical URL changes without losing focus or category', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/search?q=replication`);
  const main = page.locator('main'), input = main.getByRole('textbox', { name: 'Search the Studio', exact: true });
  await main.getByRole('button', { name: 'Lessons', exact: true }).click();
  for (const query of ['caching behavior and consistency', '\u7f13\u5b58 queues & jobs', 'literal % underscore_\\']) {
    await input.fill('');
    await input.pressSequentially(query);
    await expect(input).toHaveValue(query);
    await expect(input).toBeFocused();
    await expect(page).toHaveURL(`${f.url}/search?${new URLSearchParams({ q: query })}`);
  }
  await input.fill('cache consistency');
  await input.evaluate(element => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Search textbox expected.');
    element.setSelectionRange(6, 6);
  });
  await input.pressSequentially('queue ');
  await expect(input).toHaveValue('cache queue consistency');
  assert.equal(await input.evaluate(element => {
    if (!(element instanceof HTMLInputElement)) throw new Error('Search textbox expected.');
    return element.selectionStart;
  }), 12);
  await expect(main.getByRole('button', { name: 'Lessons', exact: true })).toHaveClass('active');
  await page.evaluate(() => {
    history.pushState({}, '', '/search?q=queues');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(input).toHaveValue('queues');
  await expect(input).toBeFocused();
  await expect(main.getByRole('button', { name: 'Lessons', exact: true })).toHaveClass('active');
  await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await page.goBack();
  await expect(input).toHaveValue('queues');
  await expect(input).toBeFocused();
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('keyboard navigation focuses a ready screen and the skip link starts tabbing inside its main landmark', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('heading', { name: 'Build a stronger foundation.', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page.locator('main')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('main')?.contains(document.activeElement)), true);
  await page.getByRole('link', { name: 'Quizzes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('main')?.contains(document.activeElement)), true);
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('delayed keyboard navigation waits for its screen, while superseded loading never takes focus from Search', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`**/${manifest['src/pages/Quiz.tsx'].file}`, async route => { await gate; await route.continue(); });
  const quizzes = page.getByRole('link', { name: 'Quizzes', exact: true });
  await quizzes.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Loading screen' })).toBeVisible();
  await expect(quizzes).toBeFocused();
  await page.keyboard.press('Control+k');
  const input = page.getByRole('textbox', { name: 'Search the Studio', exact: true });
  await expect(input).toBeFocused();
  release();
  await input.pressSequentially('queues');
  await expect(input).toHaveValue('queues');
  await expect(input).toBeFocused();
  await quizzes.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('Search shortcuts refocus the existing input and ignore composing or already-handled key events', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true }));
    const handled = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true, bubbles: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
  });
  await expect(page).toHaveURL(`${f.url}/learn`);
  await page.keyboard.press('Control+k');
  const input = page.getByRole('textbox', { name: 'Search the Studio', exact: true });
  await expect(input).toBeFocused();
  await input.pressSequentially('caching');
  await page.locator('main').getByRole('button', { name: 'Lessons', exact: true }).focus();
  await page.keyboard.press('Meta+k');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('caching');
  await expect(page).toHaveURL(`${f.url}/search?q=caching`);
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});

test('closed mobile navigation is outside the tab order and open navigation returns focus when dismissed', async t => {
  const f = await fixture(t), { page } = f;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${f.url}/learn`);
  const open = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(open).toBeVisible();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.sidebar')), false);
  }
  await open.focus();
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Close navigation', exact: true });
  await expect(close).toBeFocused();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await open.press('Enter');
  await close.press('Enter');
  await expect(open).toBeFocused();
  await open.press('Enter');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Close navigation backdrop', exact: true }).click({ position: { x: 350, y: 400 } });
  await expect(open).toBeFocused();
  await open.press('Enter');
  await page.getByRole('link', { name: 'Quizzes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('main')).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('link', { name: 'Your dashboard', exact: true }).focus();
  await expect(page.getByRole('link', { name: 'Your dashboard', exact: true })).toBeFocused();
  assert.deepEqual(f.mutations, []);
});

test('healthy account aliases preserve unsaved state, while an actual owner change clears it', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/auth`);
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await page.locator('.sidebar-profile').click();
  await page.getByLabel('Display name').fill('Unsaved synthetic account draft');
  await page.evaluate(() => {
    history.pushState({}, '', '/settings');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByLabel('Display name')).toHaveValue('Unsaved synthetic account draft');
  await expect(page.getByLabel('Display name')).toBeFocused();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Great interviews start with a little practice.', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Your Studio', exact: true }).click();
  await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
  await page.locator('.sidebar-profile').click();
  await expect(page.getByLabel('Display name')).not.toHaveValue('Unsaved synthetic account draft');
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, ['/api/auth/demo', '/api/logout', '/api/auth/demo']);
});

for (const failure of ['missing-chunk', 'render-error'] as const) {
  test(`a ${failure} is explicit, permits navigation and recovers only after deliberate reload without replay`, async t => {
    const f = await fixture(t), { page } = f, asset = `**/${manifest['src/pages/Quiz.tsx'].file}`;
    await page.goto(`${f.url}/auth`);
    await page.getByRole('button', { name: 'Try the local demo', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
    const savedBefore = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
    const mutationsBefore = [...f.mutations];
    let attempts = 0;
    await page.route(asset, route => {
      attempts++;
      return failure === 'missing-chunk'
        ? route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Synthetic asset outage.' })
        : route.fulfill({ contentType: 'text/javascript', body: "export function QuizIndex(){throw new Error('Synthetic private error detail');} export function QuizRunner(){return null;}" });
    });
    await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toBeVisible();
    await expect(page.locator('main')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeFocused();
    await expect(page.getByRole('alert')).toContainText('No action was retried');
    await expect(page.getByText('Synthetic private error detail', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reloading may discard unsaved changes on this page.', { exact: true })).toBeVisible();
    assert.ok(attempts > 0);
    const failedAttempts = attempts;
    await page.getByRole('link', { name: 'Your dashboard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toBeVisible();
    assert.equal(attempts, failedAttempts);
    assert.equal(f.documents.length, 1);
    assert.deepEqual(f.mutations, mutationsBefore);
    await page.unroute(asset);
    await page.getByRole('button', { name: 'Reload page', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Check what you know.', exact: true })).toBeVisible();
    assert.equal(f.documents.length, 2);
    assert.deepEqual(f.mutations, mutationsBefore);
    const savedAfter = await page.evaluate(async () => (await fetch('/api/bootstrap')).json());
    assert.deepEqual(savedAfter.user, savedBefore.user);
    assert.deepEqual(savedAfter.state, savedBefore.state);
  });
}

test('leaving a failed screen waits for the next delayed module instead of focusing the stale error', async t => {
  const f = await fixture(t), { page } = f;
  await page.goto(`${f.url}/learn`);
  await expect(page.getByRole('link', { name: 'Quizzes', exact: true })).toBeVisible();
  await page.route(`**/${manifest['src/pages/Quiz.tsx'].file}`, route => route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Synthetic asset outage.' }));
  await page.getByRole('link', { name: 'Quizzes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  await page.route(`**/${manifest['src/pages/Explore.tsx'].file}`, async route => { await gate; await route.continue(); });
  const search = page.getByRole('link', { name: /^Search the Studio/ });
  await search.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Loading screen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This screen could not open.', exact: true })).toHaveCount(0);
  await expect(search).toBeFocused();
  release();
  await expect(page.getByRole('textbox', { name: 'Search the Studio', exact: true })).toBeFocused();
  assert.equal(f.documents.length, 1);
  assert.deepEqual(f.mutations, []);
});
