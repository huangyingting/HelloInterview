import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { loadManagedAiConfig, ManagedAiConfigurationError } from '../server/ai/config';
import { ManagedAiProvider, ManagedAiProviderError } from '../server/ai/provider';
import { ManagedAiWorker, type ManagedAiProviderClient } from '../server/ai/worker';
import { Entitlements } from '../server/entitlements';
import { migrateJobs } from '../server/jobs';
import { digest, encodePayload } from '../server/jobs/schema';
import { openIdentityFixture } from './fixtures/identity';
import type { InputRequest } from '../server/usage';

const evidence = {
  actor: 'managed-ai-test',
  reason: 'Synthetic managed AI worker acceptance evidence only.',
};

function settings(overrides: Readonly<Record<string, string | undefined>> = {}) {
  return {
    MANAGED_AI_ENABLED: 'true',
    MANAGED_AI_MODEL_REVISION: 'fixture-model-revision',
    MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS: '1000000',
    MANAGED_AI_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS: '2000000',
    MANAGED_AI_DATA_USE_NOTICE: 'Saved practice input is sent to the configured Azure fixture and retained only under the approved private-beta policy.',
    AZURE_OPENAI_API_KEY: 'fixture-key',
    AZURE_OPENAI_ENDPOINT: 'http://127.0.0.1:8080',
    AZURE_OPENAI_DEPLOYMENT: 'fixture-deployment',
    AZURE_OPENAI_API_VERSION: '2025-04-01-preview',
    ...overrides,
  };
}

async function fixture(t: TestContext, provider: ManagedAiProviderClient) {
  const f = await openIdentityFixture();
  t.after(() => f.close());
  const browser = f.browser();
  assert.equal((await f.complete(browser, await f.begin(browser))).status, 303);
  const owner = (await browser.bootstrap()).user?.id;
  assert.ok(owner);
  await new Entitlements(f.db).issue({
    owner,
    source: { kind: 'engineering', key: randomUUID() },
    policy: 'pro-v1',
    startsAt: Date.now() - 1000,
    endsAt: Date.now() + 600_000,
    evidence,
  });
  assert.equal((await browser.request('/api/attempts', {
    problemId: 'short-links',
    level: 'Senior',
    answer: 'Define one atomic identifier allocation invariant, a durable redirect lookup, bounded caching and retry-safe API behavior.',
  })).status, 200);
  const state = (await browser.bootstrap()).state;
  const attempt = state.attempts[0];
  assert.ok(attempt);
  await migrateJobs(f.db);
  const config = loadManagedAiConfig(settings());
  assert.ok(config);
  const worker = await ManagedAiWorker.open(f.db, config, provider);
  t.after(() => worker.close());
  const epoch = Number((await f.db.prepare('SELECT session_epoch FROM managed_accounts WHERE user_id=?').get(owner))?.session_epoch);
  const request: InputRequest = {
    owner,
    key: randomUUID(),
    authEpoch: epoch,
    kind: 'feedback',
    sourceId: attempt.id,
    expectedRevision: attempt.revision ?? 0,
    consent: config.usage.id,
    acknowledged: true,
    evidence,
  };
  return { ...f, browser, owner, attempt, aiConfig: config, databaseUrl: f.config.databaseUrl!, worker, request };
}

test('managed AI configuration is explicit, immutable and never infers pricing or provider consent', () => {
  assert.equal(loadManagedAiConfig({}), null);
  assert.throws(() => loadManagedAiConfig(settings({ MANAGED_AI_ENABLED: 'false' })), ManagedAiConfigurationError);
  assert.throws(() => loadManagedAiConfig(settings({
    MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS: '',
  })), /MANAGED_AI_INPUT_PRICE/);
  assert.throws(() => loadManagedAiConfig(settings({
    MANAGED_AI_DATA_USE_NOTICE: 'too short',
  })), /MANAGED_AI_DATA_USE_NOTICE/);
  const config = loadManagedAiConfig(settings());
  assert.ok(config);
  assert.equal(config.input.model.id, 'fixture-deployment');
  assert.equal(config.input.model.revision, 'fixture-model-revision');
  assert.equal(config.usage.ownerConcurrency, 1);
  assert.equal(config.costCeilingMicros, 67936);
});

test('Azure transport pins deployment, auth, output bounds, validated JSON and measured token cost', async t => {
  let captured: { url: string; apiKey: string | undefined; body: unknown } | undefined;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    captured = {
      url: request.url ?? '',
      apiKey: typeof request.headers['api-key'] === 'string' ? request.headers['api-key'] : undefined,
      body: JSON.parse(body),
    };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        score: 88,
        strengths: ['Clear invariant.'],
        improvements: ['Bound cache staleness.'],
        summary: 'A validated synthetic response.',
      }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = loadManagedAiConfig(settings({ AZURE_OPENAI_ENDPOINT: `http://127.0.0.1:${address.port}` }));
  assert.ok(config);
  const prompt = config.input.prompts.feedback;
  const result = await new ManagedAiProvider(config.provider).evaluate({
    authority: config.input.id,
    policyHash: digest(encodePayload(config.input, 131072)),
    model: config.input.model,
    prompt: { ...prompt, hash: digest(prompt.text) },
    source: { kind: 'feedback', id: 'attempt-fixture', revision: 0, hash: digest('source'), contentVersion: digest('content') },
    data: { answer: 'Synthetic saved learner response.' },
  });
  assert.equal(result.result.kind, 'feedback');
  assert.equal(result.actualCostMicros, 20);
  assert.equal(captured?.apiKey, 'fixture-key');
  assert.equal(captured?.url, '/openai/deployments/fixture-deployment/chat/completions?api-version=2025-04-01-preview');
  assert.equal((captured?.body as { max_completion_tokens: number }).max_completion_tokens, 1200);
  assert.equal('model' in (captured?.body as object), false);
});

test('Azure transport treats malformed, oversized or unavailable provider output as explicit failures', async t => {
  let mode: 'malformed' | 'oversized' | 'unavailable' = 'malformed';
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'unavailable') {
      response.statusCode = 503;
      response.end(JSON.stringify({ error: 'fixture' }));
    } else if (mode === 'oversized') {
      response.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(270_000) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    } else {
      response.end(JSON.stringify({ choices: [{ message: { content: '{"score":1000}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = loadManagedAiConfig(settings({ AZURE_OPENAI_ENDPOINT: `http://127.0.0.1:${address.port}` }));
  assert.ok(config);
  const prompt = config.input.prompts.feedback;
  const input = {
    authority: config.input.id,
    policyHash: digest(encodePayload(config.input, 131072)),
    model: config.input.model,
    prompt: { ...prompt, hash: digest(prompt.text) },
    source: { kind: 'feedback', id: 'attempt-fixture', revision: 0, hash: digest('source'), contentVersion: digest('content') },
    data: { answer: 'Synthetic saved learner response.' },
  };
  const provider = new ManagedAiProvider(config.provider);
  await assert.rejects(provider.evaluate(input), error => error instanceof ManagedAiProviderError && error.code === 'invalid-response');
  mode = 'oversized';
  await assert.rejects(provider.evaluate(input), error => error instanceof ManagedAiProviderError && error.code === 'invalid-response');
  mode = 'unavailable';
  await assert.rejects(provider.evaluate(input), error => error instanceof ManagedAiProviderError && error.code === 'unavailable');
});

test('managed AI worker publishes validated feedback, measured cost and queue completion in one owned result', async t => {
  let calls = 0;
  const f = await fixture(t, {
    async evaluate(input) {
      calls += 1;
      assert.equal((input as { source: { kind: string } }).source.kind, 'feedback');
      const result = {
        kind: 'feedback' as const,
        output: {
          score: 84,
          strengths: ['States an atomic identifier invariant.'],
          improvements: ['Explain cache invalidation after redirect changes.'],
          summary: 'The saved answer has a clear durable core and needs a sharper cache lifecycle.',
        },
      };
      return { result, resultHash: digest(encodePayload(result)), actualCostMicros: 321 };
    },
  });
  const intent = await f.worker.inputs.enqueue(f.worker.usage, f.worker.jobs, f.request, f.aiConfig.costCeilingMicros);
  assert.equal(intent.providerEnabled, false);
  assert.deepEqual(await f.worker.processNext(), { state: 'completed', operationId: intent.operationId });
  assert.equal(calls, 1);
  const state = (await f.browser.bootstrap()).state;
  const saved = state.attempts.find(value => value.id === f.attempt.id);
  assert.equal(saved?.feedback?.source, 'ai');
  assert.equal(saved?.feedback?.score, 84);
  assert.equal(saved?.completed, true);
  const reservation = await f.db.prepare('SELECT state,actual_cost,result_hash FROM ai_usage_reservations WHERE id=?').get(intent.reservationId);
  assert.equal(reservation?.state, 'consumed');
  assert.equal(Number(reservation?.actual_cost), 321);
  assert.equal(reservation?.result_hash, digest(encodePayload({
    kind: 'feedback',
    output: {
      score: 84,
      strengths: ['States an atomic identifier invariant.'],
      improvements: ['Explain cache invalidation after redirect changes.'],
      summary: 'The saved answer has a clear durable core and needs a sharper cache lifecycle.',
    },
  })));
  const operation = await f.worker.jobs.operation(intent.operationId);
  assert.equal(operation.completedAt !== null, true);
  assert.equal(operation.receipt?.status, 'published');
});

test('provider failure becomes an explicit unknown outcome and never fabricates or releases saved feedback', async t => {
  const f = await fixture(t, {
    async evaluate() {
      throw new Error('Synthetic provider connection ended after dispatch.');
    },
  });
  const intent = await f.worker.inputs.enqueue(f.worker.usage, f.worker.jobs, f.request, f.aiConfig.costCeilingMicros);
  assert.deepEqual(await f.worker.processNext(), { state: 'unknown', operationId: intent.operationId });
  const saved = (await f.browser.bootstrap()).state.attempts.find(value => value.id === f.attempt.id);
  assert.equal(saved?.feedback, undefined);
  assert.equal(saved?.completed, false);
  assert.equal((await f.db.prepare('SELECT state,actual_cost FROM ai_usage_reservations WHERE id=?').get(intent.reservationId))?.state, 'unknown');
  assert.equal((await f.worker.jobs.operation(intent.operationId)).completedAt, null);
});

test('owner deletion during provider I/O retires private input and records an unknown cost outcome without publishing', async t => {
  let enteredResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
  const release = new Promise<void>(resolve => { releaseResolve = resolve; });
  const f = await fixture(t, {
    async evaluate() {
      enteredResolve?.();
      await release;
      const result = {
        kind: 'feedback' as const,
        output: {
          score: 80,
          strengths: ['Synthetic result after deletion.'],
          improvements: ['This result must not be published.'],
          summary: 'Retired owner result.',
        },
      };
      return { result, resultHash: digest(encodePayload(result)), actualCostMicros: 100 };
    },
  });
  const intent = await f.worker.inputs.enqueue(f.worker.usage, f.worker.jobs, f.request, f.aiConfig.costCeilingMicros);
  const pending = f.worker.processNext();
  await entered;
  await f.db.prepare('DELETE FROM users WHERE id=?').run(f.owner);
  releaseResolve?.();
  assert.deepEqual(await pending, { state: 'unknown', operationId: intent.operationId });
  const reservation = await f.db.prepare('SELECT state,user_id FROM ai_usage_reservations WHERE id=?').get(intent.reservationId);
  assert.deepEqual(reservation, { state: 'unknown', user_id: null });
  const snapshot = await f.db.prepare('SELECT user_id,payload FROM ai_input_snapshots WHERE reservation_id=?').get(intent.reservationId);
  assert.deepEqual(snapshot, { user_id: null, payload: null });
  assert.equal((await f.worker.jobs.operation(intent.operationId)).completedAt, null);
});

test('stale saved work cancels the known-undispatched native intent at zero cost without provider I/O', async t => {
  let calls = 0;
  const f = await fixture(t, {
    async evaluate() {
      calls += 1;
      throw new Error('The provider must not be called for stale saved work.');
    },
  });
  const intent = await f.worker.inputs.enqueue(f.worker.usage, f.worker.jobs, f.request, f.aiConfig.costCeilingMicros);
  assert.equal((await f.browser.request('/api/attempts', {
    id: f.attempt.id,
    revision: f.attempt.revision ?? 0,
    problemId: f.attempt.problemId,
    level: f.attempt.level,
    answer: `${f.attempt.answer} This newer saved explanation must remain authoritative.`,
    code: f.attempt.code,
    nodes: f.attempt.nodes,
    edges: f.attempt.edges,
    elapsed: f.attempt.elapsed,
  })).status, 200);
  assert.deepEqual(await f.worker.processNext(), { state: 'cancelled', operationId: intent.operationId });
  assert.equal(calls, 0);
  const reservation = await f.db.prepare('SELECT state,actual_cost,dispatched_at FROM ai_usage_reservations WHERE id=?').get(intent.reservationId);
  assert.equal(reservation?.state, 'released');
  assert.equal(Number(reservation?.actual_cost), 0);
  assert.equal(reservation?.dispatched_at, null);
  const saved = (await f.browser.bootstrap()).state.attempts.find(value => value.id === f.attempt.id);
  assert.match(saved?.answer ?? '', /newer saved explanation/);
  assert.equal(saved?.feedback, undefined);
});

test('compiled managed AI processor uses Prisma and Azure transport without development loaders', async t => {
  const server = createServer(async (_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        score: 86,
        strengths: ['Connects retries to an atomic allocation invariant.'],
        improvements: ['State the redirect cache freshness budget.'],
        summary: 'Compiled worker fixture feedback.',
      }) } }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const f = await fixture(t, {
    async evaluate() {
      throw new Error('The in-process provider must not run in the compiled CLI test.');
    },
  });
  const intent = await f.worker.inputs.enqueue(f.worker.usage, f.worker.jobs, f.request, f.aiConfig.costCeilingMicros);
  await f.worker.close();
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    DATABASE_URL: f.databaseUrl,
    ...settings({ AZURE_OPENAI_ENDPOINT: `http://127.0.0.1:${address.port}` }),
  };
  const result = await promisify(execFile)(process.execPath, ['dist-server/ai/cli.js', 'process'], { env, timeout: 20_000 });
  assert.deepEqual(JSON.parse(result.stdout), { event: 'managed-ai.operations.processed', completed: 1 });
  const saved = (await f.browser.bootstrap()).state.attempts.find(value => value.id === f.attempt.id);
  assert.equal(saved?.feedback?.score, 86);
  assert.equal((await f.worker.jobs.operation(intent.operationId)).receipt?.status, 'published');
});
