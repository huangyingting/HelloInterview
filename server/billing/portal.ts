import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BillingConfig } from './config';
import type { Database } from '../db/connection';
import { HttpError } from '../http-error';
import { TerminalJobFailure } from '../jobs';
import { assertSandboxOwner, ownedSandboxCustomer } from './ownership';
import { portalAuthority, portalScopeSchema, type PortalScope } from './portal-schema';
import { assertSandboxAccessConfiguration } from './service';

export class SandboxPortal {
  constructor(private readonly db: Database, private readonly settings: BillingConfig, private readonly origin: string) {}
  async prepare(owner: string): Promise<PortalScope> {
    if (!this.settings.portalConfiguration) throw new HttpError(503, 'Restricted sandbox billing Portal is not configured. Live commerce remains disabled.');
    const epoch = await assertSandboxOwner(this.db, owner), customer = await ownedSandboxCustomer(this.db, this.settings.accountId, owner);
    if (!customer || customer.state !== 'mapped' || !customer.customer_id) throw new HttpError(409, 'Prepare your owned sandbox customer before opening billing management.');
    await assertSandboxAccessConfiguration(this.db, this.settings);
    const created = await this.db.prepare('SELECT clock_timestamp() AS now').get();
    const scope = portalScopeSchema.parse({ id: randomUUID(), owner, customerRef: customer.id, customerId: customer.customer_id,
      configurationId: this.settings.portalConfiguration, origin: this.origin, authEpoch: epoch, createdAt: created?.now });
    await this.db.prepare(`INSERT INTO stripe_portal_access
      (id,user_id,customer_ref,customer_id,configuration_id,origin,auth_epoch,policy_version,created_at,state)
      VALUES (?,?,?,?,?,?,?,?,?::timestamptz,'requested')`).run(scope.id, owner, customer.id, customer.customer_id, scope.configurationId,
        scope.origin, scope.authEpoch, portalAuthority, scope.createdAt.toISOString());
    return scope;
  }
  async guard(scope: PortalScope, owner: string, expected: 'requested' | 'issued' = 'requested') {
    if (scope.owner !== owner || scope.configurationId !== this.settings.portalConfiguration || scope.origin !== this.origin) throw new TerminalJobFailure('not-eligible');
    await assertSandboxOwner(this.db, owner, scope.authEpoch);
    const customer = await ownedSandboxCustomer(this.db, this.settings.accountId, owner, scope.customerRef);
    if (!customer || customer.state !== 'mapped' || customer.customer_id !== scope.customerId) throw new TerminalJobFailure('not-eligible');
    await assertSandboxAccessConfiguration(this.db, this.settings);
    const row = await this.db.prepare('SELECT * FROM stripe_portal_access WHERE id=? FOR UPDATE').get(scope.id);
    if (!row || row.user_id !== owner || row.customer_ref !== scope.customerRef || row.customer_id !== scope.customerId ||
      row.configuration_id !== scope.configurationId || row.origin !== scope.origin || Number(row.auth_epoch) !== scope.authEpoch ||
      row.policy_version !== portalAuthority || row.state !== expected ||
      z.date().parse(row.created_at).getTime() !== scope.createdAt.getTime()) throw new TerminalJobFailure('not-eligible');
    const now = z.date().parse((await this.db.prepare('SELECT clock_timestamp() AS now').get())?.now).getTime();
    if (now < scope.createdAt.getTime() || now - scope.createdAt.getTime() >= 60000) throw new HttpError(409, 'Sandbox Portal preparation expired; no billing or payment outcome was inferred.');
    return now;
  }
  async complete(scope: PortalScope, owner: string, result: { id: string; created: number; proof: string }) {
    const now = await this.guard(scope, owner);
    if (result.created * 1000 < scope.createdAt.getTime() - 10000 || result.created * 1000 > now + 10000) {
      throw new HttpError(409, 'The provider Portal session was not created within this fresh preparation.');
    }
    await this.db.prepare("UPDATE stripe_portal_access SET state='issued',provider_session_id=?,policy_proof=?,issued_at=clock_timestamp() WHERE id=?")
      .run(result.id, result.proof, scope.id);
    await this.guard(scope, owner, 'issued');
  }
}
