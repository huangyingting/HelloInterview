import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { problems } from '../../shared/catalog';
import { emptyState } from '../../shared/domain';
import { mockTurnProblem, projectPatch, sourcePathIssue } from '../../shared/premium';
import type { PracticeProblem, Problem } from '../../shared/types';
import type { Capability } from '../../shared/access';
import type { Database } from '../db/connection';
import { assertDatabaseVersion, recordTables } from '../db/migrations';
import { userStateSchema } from '../db/state-schema';
import { Entitlements } from '../entitlements';
import { HttpError } from '../http-error';
import type { DurableJobs } from '../jobs';
import { digest, encodePayload } from '../jobs/schema';
import type { SandboxUsage } from './index';
import { inputCommandSchema, inputEnvelopeSchema, inputPolicySchema, inputRowSchema,
  type InputPolicy, type InputRequest, type ReservationRequest } from './schema';

const fields = { tutor: 'chat', feedback: 'attempts', mock: 'mocks', project: 'projects' } as const;
const permissions: Record<InputRequest['kind'], Capability> = { tutor: 'tutor.premium.use', feedback: 'practice.premium.create',
  mock: 'mock.create', project: 'project.create' };
type InputRow = z.infer<typeof inputRowSchema>;
function brief(problem: Problem): PracticeProblem {
  const { keywords: _keywords, workedCase: _case, solution: _solution, ...value } = problem;
  return value;
}

export class SandboxInputs {
  private constructor(private readonly db: Database, private readonly policy: InputPolicy, private readonly policyHash: string) {}
  static async open(db: Database, input: InputPolicy) {
    if (db.dialect !== 'postgres') throw new Error('Owned AI input snapshots require controlled PostgreSQL.');
    const policy = inputPolicySchema.parse(input), payload = encodePayload(policy, 131072), hash = digest(payload);
    await assertDatabaseVersion(db);
    const inputs = new SandboxInputs(db, policy, hash);
    await db.transaction(async () => {
      await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get('sandbox-ai-input-policy');
      await db.prepare('INSERT INTO ai_input_policies(id,payload,request_hash) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(policy.id, payload, hash);
      await inputs.assertPolicy();
    });
    return inputs;
  }
  private async assertPolicy() {
    const row = await this.db.prepare('SELECT payload,request_hash FROM ai_input_policies WHERE id=?').get(this.policy.id);
    if (!row || row.request_hash !== this.policyHash || digest(z.string().parse(row.payload)) !== this.policyHash ||
      encodePayload(inputPolicySchema.parse(JSON.parse(z.string().parse(row.payload))), 131072) !== encodePayload(this.policy, 131072)) {
      throw new HttpError(409, 'The immutable input/model/prompt policy changed; do not reinterpret retained input.');
    }
  }
  private async owner(owner: string, epoch?: number) {
    const row = await this.db.prepare(`SELECT a.status,a.contact_verified,a.session_epoch FROM users u
      JOIN managed_accounts a ON a.user_id=u.id WHERE u.id=? FOR UPDATE OF u,a`).get(z.uuid().parse(owner));
    if (!row || row.status !== 'active' || row.contact_verified !== 1 || epoch !== undefined && Number(row.session_epoch) !== epoch) {
      throw new HttpError(403, 'Current verified owner and captured security epoch are required for private input.');
    }
    await this.assertPolicy();
  }
  private async access(request: InputRequest) {
    await this.owner(request.owner, request.authEpoch);
    await new Entitlements(this.db).assert(request.owner, permissions[request.kind]);
  }
  private async source(request: InputRequest) {
    const field = fields[request.kind], table = recordTables[field];
    const raw = await this.db.prepare(`SELECT value,revision FROM ${table} WHERE user_id=? AND id=? FOR UPDATE`)
      .get(request.owner, request.sourceId);
    if (!raw) throw new HttpError(404, 'Owned saved input not found.');
    const revision = z.number().int().nonnegative().parse(raw.revision);
    if (revision !== request.expectedRevision) throw new HttpError(409, 'The saved input revision changed; no replacement request was admitted.');
    const state = userStateSchema.parse({ ...emptyState(), [field]: [raw.value] });
    const source = state[field][0], hash = digest(encodePayload({ source }, 4194304));
    let contentVersion: string | null = null, data: unknown;
    if (request.kind === 'tutor') {
      const message = state.chat[0];
      if (message.role !== 'user' || message.text.trim().length < 5 || message.text.length > 4000) {
        throw new HttpError(400, 'Choose a saved user question, not an assistant message or unsaved lesson context.');
      }
      data = { question: message.text };
    } else if (request.kind === 'project') {
      const project = state.projects[0];
      if (!project.brief || !project.briefVersion || project.brief.track !== 'ai-coding' || digest(encodePayload(project.brief)) !== project.briefVersion) {
        throw new HttpError(409, 'This project lacks a coherent original licensed task snapshot; do not substitute current content.');
      }
      if (project.files.some(file => sourcePathIssue(file.path))) throw new HttpError(400, 'The saved project contains an unsupported source path.');
      if (project.files.some(file => file.original === null && file.content === null)) throw new HttpError(409, 'The saved project has no baseline or content for a tracked path.');
      const patch = projectPatch(project.files);
      if (!patch || project.explanation.trim().length < 30 || project.verification.trim().length < 10) {
        throw new HttpError(400, 'Save a real patch, explanation and user-reported verification before preparing review.');
      }
      contentVersion = project.briefVersion;
      data = { exercise: project.brief, explanation: project.explanation, patch,
        verification: project.verification, verificationKind: 'user-reported-not-server-executed', level: 'Senior' };
    } else {
      const problemId = request.kind === 'feedback' ? state.attempts[0].problemId : state.mocks[0].problemId;
      const problem = problems.find(problem => problem.id === problemId);
      if (!problem) throw new HttpError(409, 'The saved exercise is unavailable; do not invent replacement content.');
      contentVersion = digest(encodePayload(brief(problem)));
      if (request.kind === 'feedback') {
        const attempt = state.attempts[0];
        if ([attempt.answer, attempt.code, ...attempt.nodes.map(node => node.label)].join('\n').trim().length < 30) {
          throw new HttpError(400, 'Save at least 30 characters of explanation or code before preparing feedback.');
        }
        data = { exercise: brief(problem), level: attempt.level, answer: attempt.answer, code: attempt.code,
          nodes: attempt.nodes.map(node => ({ id: node.id, label: node.label })), edges: attempt.edges };
      } else {
        const mock = state.mocks[0];
        if (mock.completedAt || ![3, 5].includes(mock.length) || mock.turns.length >= mock.length ||
          mock.turns.length > 0 && (mock.focus < 0 || mock.focus >= problem.keywords.length)) {
          throw new HttpError(409, 'The saved mock turn is finished or inconsistent; do not reconstruct an imagined turn.');
        }
        if (mock.draft.trim().length < 30) throw new HttpError(400, 'Save an interview answer before preparing its exact turn.');
        data = { exercise: brief(mockTurnProblem(problem, mock)), level: mock.level, company: mock.company,
          question: mock.question, answer: mock.draft, turn: mock.turns.length,
          previousResponses: mock.turns.map(turn => ({ question: turn.question, answer: turn.answer })) };
      }
    }
    const prompt = this.policy.prompts[request.kind];
    const envelope = inputEnvelopeSchema.parse({ authority: this.policy.id, policyHash: this.policyHash, model: this.policy.model,
      prompt: { ...prompt, hash: digest(prompt.text) },
      source: { kind: request.kind, id: request.sourceId, revision, hash, contentVersion }, data });
    const payload = encodePayload(envelope, 4194304);
    if (Buffer.byteLength(payload) > this.policy.maxInputBytes) throw new HttpError(413, 'The exact private input exceeds its captured UTF-8 byte ceiling; no truncation or alternative source was used.');
    return { payload, hash, inputHash: digest(payload) };
  }
  private row(value: unknown) {
    const row = inputRowSchema.parse(value), command = inputCommandSchema.parse(JSON.parse(row.request_payload));
    const request = command.request;
    if (row.owner_ref !== request.owner || row.request_key !== request.key || row.kind !== request.kind ||
      row.source_id !== request.sourceId || row.source_revision !== request.expectedRevision || row.policy_id !== this.policy.id ||
      row.request_hash !== digest(encodePayload({ command, policyHash: this.policyHash }))) {
      throw new HttpError(409, 'Private input metadata conflicts with its original request.');
    }
    if (row.user_id !== row.owner_ref || row.payload === null) throw new HttpError(410, 'The original private input was retired; its accounting intent was not replaced.');
    const envelope = inputEnvelopeSchema.parse(JSON.parse(row.payload));
    if (digest(row.payload) !== row.input_hash || Buffer.byteLength(row.payload) > this.policy.maxInputBytes ||
      encodePayload(envelope, 131072) !== row.payload || envelope.policyHash !== this.policyHash ||
      encodePayload(envelope.model) !== encodePayload(this.policy.model) ||
      encodePayload(envelope.prompt) !== encodePayload({ ...this.policy.prompts[row.kind], hash: digest(this.policy.prompts[row.kind].text) }) ||
      envelope.source.kind !== row.kind || envelope.source.id !== row.source_id || envelope.source.revision !== row.source_revision ||
      envelope.source.hash !== row.source_hash) {
      throw new HttpError(409, 'Private input bytes or model/prompt/source provenance changed.');
    }
    const normalized: ReservationRequest = { owner: request.owner, key: request.key, authEpoch: request.authEpoch, kind: request.kind,
      inputRef: `snapshot:${row.id}`, inputRevision: row.source_revision, inputHash: row.input_hash,
      costCeilingMicros: command.costCeilingMicros, consent: request.consent, acknowledged: request.acknowledged, evidence: request.evidence };
    return { row, command, normalized, envelope };
  }
  async enqueue(usage: SandboxUsage, jobs: DurableJobs, input: InputRequest, costCeilingMicros: number) {
    usage.assertDatabase(this.db);
    const command = inputCommandSchema.parse({ request: input, costCeilingMicros }), request = command.request;
    const requestHash = digest(encodePayload({ command, policyHash: this.policyHash }));
    return this.db.transaction(async () => {
      await this.owner(request.owner, request.authEpoch);
      const previous = await this.db.prepare('SELECT * FROM ai_input_snapshots WHERE owner_ref=? AND request_key=? FOR UPDATE').get(request.owner, request.key);
      if (previous) {
        const saved = this.row(previous);
        if (saved.row.request_hash !== requestHash) throw new HttpError(409, 'This input key belongs to another saved source, cost or acknowledgment.');
        const intent = await jobs.enqueueReservedAi(usage, saved.normalized);
        if (intent.reservation.id !== saved.row.reservation_id) throw new HttpError(409, 'The original private input/native reservation binding changed.');
        return { id: saved.row.id, reservationId: intent.reservation.id, operationId: intent.operation.id, providerEnabled: false as const };
      }
      await this.access(request);
      const selected = await this.source(request), id = randomUUID();
      const normalized: ReservationRequest = { owner: request.owner, key: request.key, authEpoch: request.authEpoch, kind: request.kind,
        inputRef: `snapshot:${id}`, inputRevision: request.expectedRevision, inputHash: selected.inputHash,
        costCeilingMicros: command.costCeilingMicros, consent: request.consent, acknowledged: request.acknowledged, evidence: request.evidence };
      const intent = await jobs.enqueueReservedAi(usage, normalized);
      await this.db.prepare(`INSERT INTO ai_input_snapshots
        (id,owner_ref,user_id,request_key,request_payload,request_hash,policy_id,reservation_id,kind,source_id,source_revision,source_hash,input_hash,payload)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, request.owner, request.owner, request.key, encodePayload(command), requestHash,
          this.policy.id, intent.reservation.id, request.kind, request.sourceId, request.expectedRevision, selected.hash, selected.inputHash, selected.payload);
      const saved = this.row(await this.db.prepare('SELECT * FROM ai_input_snapshots WHERE owner_ref=? AND id=?').get(request.owner, id));
      if (saved.row.input_hash !== selected.inputHash || saved.row.reservation_id !== intent.reservation.id) throw new HttpError(409, 'Private input publication changed.');
      await this.access(request);
      const current = await this.source(request);
      if (current.payload !== selected.payload) throw new HttpError(409, 'Saved input changed during native admission; newer work was not overwritten.');
      await usage.assertQueuedAdmission(request.owner, intent.reservation.id);
      const confirmed = await jobs.enqueueReservedAi(usage, saved.normalized);
      if (confirmed.operation.id !== intent.operation.id) throw new HttpError(409, 'Private input/native operation publication changed.');
      await this.access(request);
      await usage.assertQueuedAdmission(request.owner, intent.reservation.id);
      return { id, reservationId: intent.reservation.id, operationId: intent.operation.id, providerEnabled: false as const };
    });
  }
  async prepare(usage: SandboxUsage, jobs: DurableJobs, owner: string, operationId: string) {
    usage.assertDatabase(this.db);
    return this.db.transaction(async () => {
      await this.owner(owner);
      const raw = await this.db.prepare(`SELECT s.* FROM ai_input_snapshots s JOIN ai_usage_operations o ON o.reservation_id=s.reservation_id
        WHERE s.owner_ref=? AND o.operation_id=? FOR UPDATE OF s`).get(z.uuid().parse(owner), z.uuid().parse(operationId));
      if (!raw) throw new HttpError(404, 'Owned prepared input not found.');
      const saved = this.row(raw); await this.access(saved.command.request);
      const intent = await jobs.enqueueReservedAi(usage, saved.normalized);
      if (intent.operation.id !== operationId || intent.reservation.id !== saved.row.reservation_id) throw new HttpError(409, 'Prepared input belongs to another native intent.');
      await usage.assertQueuedAdmission(owner, saved.row.reservation_id);
      const status = await jobs.ownedStatus(owner, operationId);
      if (!['created', 'active'].includes(status.status)) throw new HttpError(409, 'The original native intent is not available for input preparation.');
      const current = await this.source(saved.command.request);
      if (current.payload !== saved.row.payload) throw new HttpError(409, 'The captured input is stale; do not use it to publish over newer saved work.');
      await this.access(saved.command.request);
      await usage.assertQueuedAdmission(owner, saved.row.reservation_id);
      return { id: saved.row.id, providerEnabled: false as const, input: saved.envelope };
    });
  }
}
