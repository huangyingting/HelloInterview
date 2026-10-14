import { emptyState } from '../../shared/domain';
import type { UserState } from '../../shared/types';
import type { Database } from './connection';
import { recordTables } from './records';
import { userStateSchema } from './state-schema';

const resourceFields = ['read', 'bookmarks', 'review', 'activity', 'enrollments', 'watched'] as const;

export class StateRepository {
  constructor(private readonly db: Database) {}

  async initialize(userId: string, state = emptyState()): Promise<void> {
    const checked = userStateSchema.parse(state);
    if (this.db.dialect === 'sqlite') {
      await this.db.prepare('INSERT INTO states (user_id,value) VALUES (?,?)').run(userId, JSON.stringify(checked));
      return;
    }
    await this.db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    await this.writeChanges(userId, emptyState(), checked);
  }

  async read(userId: string): Promise<UserState> {
    return this.db.transaction(async () => {
      await this.lock(userId);
      return this.readLocked(userId);
    });
  }

  async mutate(userId: string, operation: (state: UserState) => void): Promise<UserState> {
    return this.db.transaction(async () => {
      await this.lock(userId);
      const previous = await this.readLocked(userId);
      const current = structuredClone(previous);
      operation(current);
      const checked = userStateSchema.parse(current);
      await this.writeChanges(userId, previous, checked);
      return checked;
    });
  }

  private async lock(userId: string): Promise<void> {
    const row = await this.db.prepare(`SELECT id FROM users WHERE id=?${this.db.dialect === 'postgres' ? ' FOR UPDATE' : ''}`).get(userId);
    if (!row) throw new Error('The owner of this preparation state does not exist.');
  }

  private async readLocked(userId: string): Promise<UserState> {
    if (this.db.dialect === 'sqlite') {
      const row = await this.db.prepare('SELECT value FROM states WHERE user_id=?').get(userId);
      if (!row || typeof row.value !== 'string') throw new Error('Your saved state could not be found.');
      return userStateSchema.parse({ ...emptyState(), ...JSON.parse(row.value) });
    }
    const settings = await this.db.prepare('SELECT plan,plan_expires_at,recognition FROM user_settings WHERE user_id=?').get(userId);
    if (!settings) throw new Error('Your saved state could not be found.');
    const resources = await this.db.prepare('SELECT kind,resource FROM user_resources WHERE user_id=? ORDER BY position,resource').all(userId);
    const state: Record<string, unknown> = { ...emptyState(), plan: settings.plan, planExpiresAt: settings.plan_expires_at, recognition: settings.recognition };
    for (const field of resourceFields) state[field] = resources.filter(row => row.kind === field).map(row => row.resource);
    for (const [field, table] of Object.entries(recordTables)) {
      const rows = await this.db.prepare(`SELECT value FROM ${table} WHERE user_id=? ORDER BY position,id`).all(userId);
      state[field] = rows.map(row => row.value);
    }
    return userStateSchema.parse(state);
  }

  private async writeChanges(userId: string, before: UserState, after: UserState): Promise<void> {
    if (this.db.dialect === 'sqlite') {
      await this.db.prepare('UPDATE states SET value=? WHERE user_id=?').run(JSON.stringify(after), userId);
      return;
    }
    await this.db.prepare('UPDATE user_settings SET plan=?,plan_expires_at=?,recognition=?,revision=revision+1 WHERE user_id=?')
      .run(after.plan, after.planExpiresAt, after.recognition, userId);
    for (const field of resourceFields) {
      const old = new Map(before[field].map((resource, index) => [resource, index]));
      const next = new Set(after[field]);
      for (const resource of old.keys()) {
        if (!next.has(resource)) await this.db.prepare('DELETE FROM user_resources WHERE user_id=? AND kind=? AND resource=?').run(userId, field, resource);
      }
      for (const [position, resource] of after[field].entries()) {
        if (old.get(resource) === position) continue;
        await this.db.prepare('INSERT INTO user_resources (user_id,kind,resource,position) VALUES (?,?,?,?) ON CONFLICT (user_id,kind,resource) DO UPDATE SET position=EXCLUDED.position')
          .run(userId, field, resource, position);
      }
    }
    for (const [field, table] of Object.entries(recordTables)) {
      const key = field as keyof typeof recordTables;
      const old = new Map(before[key].map((item, position) => [item.id, { item, position }]));
      const next = new Set(after[key].map(item => item.id));
      for (const id of old.keys()) {
        if (!next.has(id)) await this.db.prepare(`DELETE FROM ${table} WHERE user_id=? AND id=?`).run(userId, id);
      }
      for (const [position, item] of after[key].entries()) {
        const previous = old.get(item.id);
        if (previous?.position === position && JSON.stringify(previous.item) === JSON.stringify(item)) continue;
        const revision = 'revision' in item && typeof item.revision === 'number' ? item.revision : 0;
        await this.db.prepare(`INSERT INTO ${table} (user_id,id,value,position,revision) VALUES (?,?,?,?,?)
          ON CONFLICT (user_id,id) DO UPDATE SET value=EXCLUDED.value,position=EXCLUDED.position,revision=EXCLUDED.revision,updated_at=now()`)
          .run(userId, item.id, JSON.stringify(item), position, revision);
      }
    }
  }
}
