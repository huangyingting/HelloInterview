import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { postgresConnection, type Database } from '../server/db/connection';
import { migrateDatabase } from '../server/db/migrations';
import { DurableJobs, LostJobClaim, TerminalJobFailure, migrateJobs, type OperationRequest } from '../server/jobs';
import { createBoss } from '../server/jobs/queue';
import { encodePayload, queueNames, type ClaimData } from '../server/jobs/schema';
import { HttpError } from '../server/http-error';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL must identify a dedicated PostgreSQL fixture. Job tests own their application and queue schemas.');
const execute = promisify(execFile);

async function fixture(t: TestContext, install = true) {
  const root = postgresConnection(databaseUrl!);
  const schema = `jobs_test_${randomUUID().replaceAll('-', '')}`;
  await root.exec(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const db = postgresConnection(url.href), connections = [db], queues: DurableJobs[] = [];
  const bosses: Awaited<ReturnType<typeof createBoss>>[] = [];
  t.after(async () => {
    try {
      for (const jobs of queues) await jobs.close();
      for (const boss of bosses) await boss.stop();
      for (const connection of connections) await connection.close();
    } finally {
      try {
        await root.exec(`DROP SCHEMA IF EXISTS ${schema}_jobs CASCADE`);
        await root.exec(`DROP SCHEMA ${schema} CASCADE`);
      } finally { await root.close(); }
    }
  });
  await migrateDatabase(db);
  if (install) await migrateJobs(db);
  await db.exec('CREATE TABLE fixture_effects (id TEXT PRIMARY KEY, count INTEGER NOT NULL)');
  await db.prepare('INSERT INTO fixture_effects (id,count) VALUES (?,0)').run('counter');
  return {
    db, schema, url: url.href,
    replica() { const replica = postgresConnection(url.href); connections.push(replica); return replica; },
    async open(connection = db, worker = false) { const jobs = await DurableJobs.open(connection, worker); queues.push(jobs); return jobs; },
    async boss() { const boss = await createBoss(db); await boss.start(); bosses.push(boss); return boss; },
  };
}
function request(changes: Partial<OperationRequest> = {}): OperationRequest {
  return { principal: { type: 'system', id: 'fixture' }, kind: 'notification.deliver', key: 'operation-a', resource: 'resource-a', payload: { version: 1, text: 'fixture-private-payload' }, retryMode: 'idempotent', ...changes };
}
async function effect(db: Database) {
  await db.prepare('UPDATE fixture_effects SET count=count+1 WHERE id=?').run('counter');
  return { saved: true };
}
async function count(db: Database) { return (await db.prepare('SELECT count FROM fixture_effects WHERE id=?').get('counter'))!.count; }
async function owner(db: Database) {
  const id = randomUUID();
  await db.prepare('INSERT INTO users (id,name,email,password,demo) VALUES (?,?,?,NULL,0)').run(id, 'Fixture', `${id}@example.invalid`);
  return id;
}
async function waitFor(condition: () => Promise<boolean>, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('The synthetic worker did not reach its expected durable state.');
}

test('job payload normalization preserves bytes and rejects exact byte, depth, non-JSON and prototype hazards', () => {
  assert.equal(encodePayload({ z: [true, null, { b: 2, a: 1 }], a: '  source\r\n' }), '{"a":"  source\\r\\n","z":[true,null,{"a":1,"b":2}]}');
  assert.equal(Buffer.byteLength(encodePayload({ text: 'x'.repeat(262144 - 11) })), 262144);
  assert.throws(() => encodePayload({ text: 'x'.repeat(262144 - 10) }), /byte limit/);
  assert.throws(() => encodePayload({ text: '\u2713'.repeat(262144 / 3) }), /byte limit/);
  assert.throws(() => encodePayload({ value: NaN }));
  assert.throws(() => encodePayload({ value: new Date() }), /plain JSON/);
  const cycle: Record<string, unknown> = {};
  cycle.child = cycle;
  assert.throws(() => encodePayload(cycle), /complexity limit/);
  assert.throws(() => encodePayload(JSON.parse('{"__proto__":{"x":1},"a":2}')), /prohibited object key/);
  assert.throws(() => encodePayload({ child: JSON.parse('{"constructor":{"x":1}}') }), /prohibited object key/);
});

test('queue installation is explicit, repeatable and isolated; runtime never creates or repairs its schema', async t => {
  const f = await fixture(t, false);
  await assert.rejects(f.open(), /schema|installed|migrat/i);
  assert.equal((await f.db.prepare('SELECT to_regnamespace(?) AS name').get(`${f.schema}_jobs`))!.name, null);
  await Promise.all([migrateJobs(f.db), migrateJobs(f.replica())]);
  const jobs = await f.open(), boss = await f.boss();
  assert.deepEqual(await jobs.inspect(), []);
  await boss.updateQueue(queueNames['notification.deliver'], { retryLimit: 9 });
  await assert.rejects(f.open(), /policy does not match/);
  await migrateJobs(f.db);
  await f.open();
});

test('the queue database adapter preserves native parameters and shares caller transaction rollback', async t => {
  const f = await fixture(t), jobs = await f.open();
  const time = new Date('2026-01-02T03:04:05Z');
  const { rows } = await f.db.executeSql('SELECT $$?$$ AS literal,$1::int[] AS numbers,$2::jsonb AS payload,$3::timestamptz AS time', [[1, 2], { text: 'fixture' }, time]);
  assert.deepEqual(rows[0], { literal: '?', numbers: [1, 2], payload: { text: 'fixture' }, time });
  await assert.rejects(f.db.transaction(async () => {
    await effect(f.db);
    await jobs.enqueue(request());
    throw new Error('Injected business rollback.');
  }), /Injected/);
  assert.equal(await count(f.db), 0);
  assert.deepEqual(await jobs.inspect(), []);
  assert.equal(await jobs.claim('notification.deliver'), undefined);
});

test('owned idempotency survives concurrent replicas, completion and restart without exposing another account', async t => {
  const f = await fixture(t), one = await f.open(), two = await f.open(f.replica()), id = await owner(f.db), stranger = await owner(f.db);
  const input = request({ principal: { type: 'user', id }, payload: { b: [1, 2], a: '  original\r\n' } });
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? one : two).enqueue(input)));
  assert.equal(new Set(results.map(result => result.id)).size, 1);
  assert.equal(new Set(results.map(result => result.jobId)).size, 1);
  await assert.rejects(two.enqueue({ ...input, payload: { changed: true } }), error => error instanceof HttpError && error.status === 409);
  await assert.rejects(two.ownedStatus(stranger, results[0].id), error => error instanceof HttpError && error.status === 404);
  const claim = await one.claim('notification.deliver');
  assert.ok(claim);
  await one.finish(claim, effect);
  await one.close();
  const restarted = await f.open();
  const replayed = await restarted.enqueue({ ...input, payload: { a: '  original\r\n', b: [1, 2] } });
  assert.equal(replayed.id, results[0].id);
  assert.equal(replayed.completedAt !== null, true);
  assert.equal((await restarted.ownedStatus(id, replayed.id)).status, 'completed');
  assert.equal(await restarted.claim('notification.deliver'), undefined);
  assert.equal(await count(f.db), 1);
  const independent = await restarted.enqueue({ ...input, principal: { type: 'user', id: stranger } });
  assert.notEqual(independent.id, replayed.id);
  await assert.rejects(restarted.replay(replayed.id, 'fixture-operator', 'Confirmed safe replay reason.'), /Only terminal/);
});

test('verified inbox acknowledgement, duplicate detection and outbox insertion commit together across replicas', async t => {
  const f = await fixture(t), one = await f.open(), two = await f.open(f.replica());
  const input = request(), { principal: _principal, key: _key, ...operation } = input;
  const event = { source: 'fixture.sandbox', eventId: 'evt-one', payload: { a: 1, b: 2 }, operation };
  const outcomes = await Promise.all([one.ingestVerifiedEvent(event), two.ingestVerifiedEvent({ ...event, payload: { b: 2, a: 1 } })]);
  assert.equal(outcomes.filter(outcome => outcome.duplicate).length, 1);
  assert.equal(outcomes[0].operation.id, outcomes[1].operation.id);
  await assert.rejects(one.ingestVerifiedEvent({ ...event, payload: { altered: true } }), error => error instanceof HttpError && error.status === 409);
  await assert.rejects(f.db.transaction(async () => {
    await one.ingestVerifiedEvent({ ...event, eventId: 'evt-rollback' });
    throw new Error('Injected inbox rollback.');
  }), /Injected/);
  assert.equal((await f.db.prepare('SELECT COUNT(*)::int AS count FROM verified_event_inbox').get())!.count, 1);
  assert.equal((await one.inspect()).length, 1);
});

test('singleton resource claims exclude concurrent replicas without blocking unrelated resources', async t => {
  const f = await fixture(t), one = await f.open(), two = await f.open(f.replica());
  await one.enqueue(request());
  await two.enqueue(request({ principal: { type: 'system', id: 'another-source' } }));
  await one.enqueue(request({ key: 'operation-b', resource: 'resource-b' }));
  const claims = (await Promise.all([one.claim('notification.deliver'), two.claim('notification.deliver'), one.claim('notification.deliver')])).filter(claim => claim !== undefined);
  assert.equal(claims.length, 2);
  assert.equal(new Set(claims.map(claim => claim.singletonKey)).size, 2);
  await one.finish(claims[0], effect);
  await two.finish(claims[1], effect);
  const remaining = await two.claim('notification.deliver');
  assert.ok(remaining);
  await two.finish(remaining, effect);
  assert.equal(await count(f.db), 3);
});

test('business failures roll back completion, and old attempt completion/failure cannot settle a newer retry', async t => {
  const f = await fixture(t), one = await f.open(), two = await f.open(f.replica()), boss = await f.boss();
  const operation = await one.enqueue(request()), claim = await one.claim('notification.deliver');
  assert.ok(claim);
  await assert.rejects(one.finish(claim, async db => { await effect(db); throw new Error('Injected result failure.'); }), /Injected/);
  assert.equal(await count(f.db), 0);
  assert.equal((await one.operation(operation.id)).completedAt, null);
  assert.equal(await one.fail(claim), true);
  const [retry] = await boss.fetch<ClaimData>(claim.name, { includeMetadata: true, ignoreStartAfter: true });
  assert.ok(retry);
  assert.ok(retry.retryCount > claim.retryCount);
  await assert.rejects(one.finish(claim, effect), LostJobClaim);
  assert.equal(await one.fail(claim), false);
  await two.finish(retry, effect);
  assert.equal(await count(f.db), 1);
  assert.equal((await one.operation(operation.id)).receipt?.saved, true);
});

test('expired claims and leases expiring inside a result transaction cannot publish business changes', async t => {
  const f = await fixture(t), jobs = await f.open(), boss = await f.boss();
  await boss.updateQueue(queueNames['notification.deliver'], { expireInSeconds: 1 });
  await jobs.enqueue(request());
  const claim = await jobs.claim('notification.deliver');
  assert.ok(claim);
  assert.equal(claim.expireInSeconds, 1);
  await f.db.prepare('SELECT pg_sleep(?)').get(1.05);
  await assert.rejects(jobs.finish(claim, effect), LostJobClaim);
  assert.equal(await count(f.db), 0);
  await jobs.fail(claim);
  await jobs.enqueue(request({ key: 'second-expiry', resource: 'second-expiry' }));
  const inside = await jobs.claim('notification.deliver');
  assert.ok(inside);
  await assert.rejects(jobs.finish(inside, async db => {
    const receipt = await effect(db);
    await db.prepare('SELECT pg_sleep(?)').get(1.05);
    return receipt;
  }), LostJobClaim);
  assert.equal(await count(f.db), 0);
});

test('unknown external outcomes never retry automatically; replay needs reconciliation and fences old generations', async t => {
  const f = await fixture(t), jobs = await f.open(), id = await owner(f.db);
  const operation = await jobs.enqueue(request({ principal: { type: 'user', id }, retryMode: 'reconcile' }));
  const claim = await jobs.claim(operation.kind);
  assert.ok(claim);
  assert.equal(claim.retryLimit, 0);
  await jobs.fail(claim, 'reconciliation-required');
  assert.equal((await jobs.ownedStatus(id, operation.id)).status, 'failed');
  await assert.rejects(jobs.replay(operation.id, 'fixture-operator', 'Provider outcome was checked.'), /Reconcile/);
  const outcomes = await Promise.allSettled([
    jobs.replay(operation.id, 'fixture-operator', 'Provider outcome was checked.', true),
    jobs.replay(operation.id, 'fixture-operator', 'Provider outcome was checked.', true),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const next = await jobs.operation(operation.id);
  assert.equal(next.id, operation.id);
  assert.notEqual(next.jobId, operation.jobId);
  assert.equal(next.generation, 1);
  await assert.rejects(jobs.finish(claim, effect), LostJobClaim);
  const audit = await f.db.prepare('SELECT actor,reason,generation,provider_reconciled FROM job_operator_events WHERE operation_id=?').all(operation.id);
  assert.deepEqual(audit, [{ actor: 'fixture-operator', reason: 'Provider outcome was checked.', generation: 1, provider_reconciled: 1 }]);
  assert.equal(await count(f.db), 0);
});

test('missing queue records are explicit and recover with a new fenced generation, never fabricated completion', async t => {
  const f = await fixture(t), jobs = await f.open(), boss = await f.boss(), id = await owner(f.db);
  const operation = await jobs.enqueue(request({ principal: { type: 'user', id } }));
  const claim = await jobs.claim(operation.kind);
  assert.ok(claim);
  await boss.deleteJob(claim.name, claim);
  assert.equal((await jobs.ownedStatus(id, operation.id)).status, 'missing');
  const next = await jobs.replay(operation.id, 'fixture-operator', 'Recovered the missing dispatch record.');
  assert.equal(next.id, operation.id);
  assert.equal(next.generation, 1);
  await assert.rejects(jobs.finish(claim, effect), LostJobClaim);
  const current = await jobs.claim(next.kind);
  assert.ok(current);
  await jobs.finish(current, effect);
  assert.equal(await count(f.db), 1);
});

test('corrupted saved operation inputs fail without substituting new input or fabricating a result',async t=>{
  const f=await fixture(t),jobs=await f.open(),operation=await jobs.enqueue(request());
  await f.db.prepare('UPDATE durable_operations SET payload=? WHERE id=?').run('{"changed":true}',operation.id);
  await assert.rejects(jobs.operation(operation.id),/request hash/);
  await assert.rejects(jobs.enqueue(request()),/request hash/);
  const claim=await jobs.claim(operation.kind);
  assert.ok(claim);
  await assert.rejects(jobs.finish(claim,effect),/request hash/);
  assert.equal(await count(f.db),0);
  assert.equal((await f.db.prepare('SELECT payload,receipt FROM durable_operations WHERE id=?').get(operation.id))!.receipt,null);
});

test('real polling workers prepare outside transactions, finish atomically and drain without closing the application pool', async t => {
  const f = await fixture(t), jobs = await f.open(f.db, true);
  let entered = false, release: (() => void) | undefined;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await jobs.startWorkers({ 'notification.deliver': async (operation, signal) => {
    assert.equal(operation.payload.text, 'fixture-private-payload');
    assert.equal(signal.aborted, false);
    assert.equal(await count(f.db), 0);
    entered = true;
    await barrier;
    return effect;
  } });
  const operation = await jobs.enqueue(request());
  await waitFor(async () => entered);
  const draining = jobs.close();
  await assert.rejects(jobs.enqueue(request({ key: 'new-during-drain' })), /draining/);
  release!();
  await draining;
  assert.equal((await jobs.operation(operation.id)).completedAt !== null, true);
  assert.equal(await count(f.db), 1);
  assert.equal((await f.db.prepare('SELECT 1 AS value').get())!.value, 1);
});

test('a deleted owner is not dispatched; terminal worker failures retain only safe diagnostics', async t => {
  const f = await fixture(t), jobs = await f.open(f.db, true), id = await owner(f.db);
  const deleted = await jobs.enqueue(request({ principal: { type: 'user', id }, retryMode: 'reconcile' }));
  await f.db.prepare('DELETE FROM users WHERE id=?').run(id);
  let dispatched = 0;
  const logs: string[] = [], original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };
  t.after(() => { console.error = original; });
  await jobs.startWorkers({ 'notification.deliver': async operation => {
    dispatched++;
    if(operation.payload.sensitiveError)throw new Error('fixture-provider-secret-marker');
    throw new TerminalJobFailure('invalid-result');
  } });
  await waitFor(async () => (await jobs.inspect()).some(operation => operation.id === deleted.id && operation.status === 'failed'));
  assert.equal(dispatched, 0);
  await jobs.enqueue(request({ key: 'terminal-provider-failure', resource: 'terminal-provider-failure' }));
  await waitFor(async () => dispatched === 1);
  await waitFor(async () => (await jobs.inspect()).filter(operation => operation.status === 'failed').length === 2);
  const boss = await f.boss();
  const terminal = await boss.findJobs(queueNames['notification.deliver'], { data: { operationId: deleted.id } });
  assert.deepEqual(terminal[0].output, { code: 'not-eligible' });
  const sensitive=await jobs.enqueue(request({key:'safe-error-diagnostics',resource:'safe-error-diagnostics',retryMode:'reconcile',payload:{sensitiveError:true}}));
  await waitFor(async()=> (await jobs.inspect()).some(operation=>operation.id===sensitive.id&&operation.status==='failed'));
  const [failed]=await boss.findJobs(queueNames[sensitive.kind],{id:sensitive.jobId});
  assert.deepEqual(failed.output,{code:'handler-failed'});
  assert.ok(logs.some(log => log.includes('not-eligible')));
  assert.equal(logs.some(log=>log.includes('fixture-provider-secret-marker')),false);
  assert.equal(await count(f.db), 0);
});

test('compiled migration/status/replay tools preserve private inputs and operate without development loaders', async t => {
  const f = await fixture(t, false);
  const env: NodeJS.ProcessEnv = { ...process.env, APP_MODE: 'local', DATABASE_URL: f.url, NODE_ENV: 'production' };
  await execute(process.execPath, ['dist-server/db/cli.js', 'migrate'], { env });
  const jobs = await f.open(), operation = await jobs.enqueue(request({ retryMode: 'reconcile' }));
  const claim = await jobs.claim(operation.kind);
  assert.ok(claim);
  await jobs.fail(claim, 'reconciliation-required');
  const status = await execute(process.execPath, ['dist-server/db/cli.js', 'jobs', 'status'], { env });
  assert.equal(JSON.parse(status.stdout).operations[0].status, 'failed');
  assert.equal(status.stdout.includes('fixture-private-payload'), false);
  assert.ok('deadLetters' in JSON.parse(status.stdout));
  await assert.rejects(execute(process.execPath, ['dist-server/db/cli.js', 'jobs', 'replay', operation.id, '--actor', 'fixture-operator', '--reason', 'Checked the provider outcome.'], { env }));
  const replay = await execute(process.execPath, ['dist-server/db/cli.js', 'jobs', 'replay', operation.id, '--actor', 'fixture-operator', '--reason', 'Checked the provider outcome.', '--provider-reconciled'], { env });
  assert.equal(JSON.parse(replay.stdout).generation, 1);
  assert.equal(replay.stdout.includes('fixture-private-payload'), false);
});

test('worker death after provider success recovers with the original idempotency key and exactly one business effect', { timeout: 45000 }, async t => {
  const children: { process: ChildProcess; exit: Promise<unknown[]> }[] = [];
  t.after(async () => {
    for (const child of children) {
      if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
      await child.exit;
    }
  });
  const f = await fixture(t), jobs = await f.open(), boss = await f.boss();
  let requests = 0, providerEffects = 0;
  const results = new Map<string, { reference: string }>();
  const provider = createServer((req, res) => {
    requests++;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[a-f0-9-]{36}$/.test(key)) { res.writeHead(400).end(); return; }
    if (!results.has(key)) { providerEffects++; results.set(key, { reference: key }); }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results.get(key)));
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve())));
  const address = provider.address();
  assert.ok(address && typeof address !== 'string');
  const providerUrl = `http://127.0.0.1:${address.port}`;
  const operation = await jobs.enqueue(request());
  await boss.update(queueNames[operation.kind], undefined, { id: operation.jobId, expireInSeconds: 1 });
  async function child(halt: boolean) {
    const process = spawn(globalThis.process.execPath, ['tests/fixtures/job-worker.mjs'], {
      env: { NODE_ENV: 'test', TEST_DATABASE_URL: f.url, JOB_FIXTURE_PROVIDER: providerUrl, JOB_FIXTURE_HALT: String(halt) },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exit = once(process, 'exit');
    children.push({ process, exit });
    const messages: string[] = [];
    let stderr = '';
    process.stderr!.on('data', chunk => { stderr += String(chunk); });
    process.on('message', message => {
      if (message !== null && typeof message === 'object' && 'type' in message && typeof message.type === 'string') messages.push(message.type);
    });
    await waitFor(async () => {
      if (process.exitCode !== null) throw new Error(`Synthetic child exited before readiness: ${stderr}`);
      return messages.includes('ready');
    });
    return { process, exit, messages };
  }
  const first = await child(true);
  await waitFor(async () => first.messages.includes('provider-success'));
  first.process.kill('SIGKILL');
  const [code, signal] = await first.exit;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
  assert.equal(await count(f.db), 0);
  assert.equal(providerEffects, 1);
  const second = await child(false);
  await waitFor(async () => (await jobs.operation(operation.id)).completedAt !== null, 25000);
  second.process.kill('SIGTERM');
  const [exitCode, exitSignal] = await second.exit;
  assert.equal(exitCode, 0);
  assert.equal(exitSignal, null);
  assert.equal(requests, 2);
  assert.equal(providerEffects, 1);
  assert.equal(await count(f.db), 1);
  assert.deepEqual((await jobs.operation(operation.id)).receipt, { reference: operation.id });
});
