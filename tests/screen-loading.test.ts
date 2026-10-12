import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium, expect } from '@playwright/test';
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
async function fixture(t: TestContext) {
  const parent = path.resolve('data/screen-tests');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'screens-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = await startServer(loadConfig({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '0', LOG_REQUESTS: 'false', DATA_DIR: directory }));
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
    await page.getByRole('button',{name:'0 local reports',exact:true}).click();
    await expect(page.getByRole('button',{name:'1 local reports',exact:true})).toHaveAttribute('aria-pressed','true');
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

test('local comment editing preserves conflict and lost-response drafts through closing, filtering and explicit saved-version adoption',async t=>{
  const f=await fixture(t),{page}=f,db=localConnection(f.directory);t.after(()=>db.close());
  const login=await page.request.post(`${f.url}/api/auth/demo`,{data:{}});assert.equal(login.status(),200);
  const owner=(await login.json()).user.id,id=' comment/?%# ',post='comment-editor-parent',resource=`post/${post}`;
  await db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?,?,0)').run(post,'questions','A comment editing fixture','An original local question with full context and reasoning.','Fixture Company','system-design','Senior','Global','Anonymous',owner,'2026-01-01T00:00:00.000Z');
  await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(id,resource,owner,'Owned synthetic commenter','Original owner reply.','2026-01-01T00:00:00.000Z',null);
  for(let index=0;index<3;index++)await db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?,?)').run(`other-comment-${index}`,resource,'another-local-author','Other retained commenter',`Other original reply ${index}.`,'2026-01-01T00:00:00.000Z',null);
  let releaseRead!:()=>void;
  const reading=new Promise<void>(resolve=>{releaseRead=resolve;});
  await page.route('**/api/comments?*',async route=>{
    if(new URL(route.request().url()).pathname!=='/api/comments'){await route.continue();return;}
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
  await expect(comment.getByRole('button',{name:/Delete/})).toHaveCount(0);
  await text.fill('x'.repeat(3000));await comment.getByRole('button',{name:'Save comment changes',exact:true}).click();
  await expect(comment.locator(':scope > div > p')).toHaveText('x'.repeat(3000));
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
