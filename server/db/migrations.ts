import { createHash } from 'node:crypto';
import type { Database } from './connection';

export const recordTables = {
  targets: 'targets',
  stories: 'stories',
  attempts: 'attempts',
  quizzes: 'quiz_attempts',
  certificates: 'completion_records',
  chat: 'tutor_messages',
  mocks: 'mock_sessions',
  customQuizzes: 'custom_quizzes',
  studyPlans: 'study_plans',
  projects: 'project_workspaces',
} as const;

export const migrations = [{
  version: 1,
  name: 'owned-learning-records',
  sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password TEXT, demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX sessions_user ON sessions(user_id);
    CREATE INDEX sessions_expiry ON sessions(expires);
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','month','year','lifetime')),
      plan_expires_at TEXT, recognition INTEGER NOT NULL DEFAULT 0 CHECK (recognition >= 0),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    );
    CREATE TABLE user_resources (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('read','bookmarks','review','activity','enrollments','watched')),
      resource TEXT NOT NULL, position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (user_id,kind,resource)
    );
    ${Object.values(recordTables).map(table => `
      CREATE TABLE ${table} (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL, value JSONB NOT NULL CHECK (jsonb_typeof(value) = 'object' AND octet_length(value::text) <= 2097152),
        position INTEGER NOT NULL CHECK (position >= 0),
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id,id),
        CHECK (value->>'id' = id),
        CHECK (COALESCE((value->>'revision')::integer,0) = revision)
      );
      CREATE INDEX ${table}_owner_order ON ${table}(user_id,position,id);
    `).join('\n')}
    CREATE INDEX attempts_problem ON attempts(user_id,(value->>'problemId'));
    CREATE INDEX mock_sessions_problem ON mock_sessions(user_id,(value->>'problemId'));
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      company TEXT NOT NULL, track TEXT NOT NULL, level TEXT NOT NULL, region TEXT NOT NULL,
      author TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL,
      sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0,1))
    );
    CREATE INDEX posts_kind_order ON posts(kind,created_at DESC,id);
    CREATE TABLE votes (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id,user_id)
    );
    CREATE TABLE follows (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id,user_id)
    );
    CREATE TABLE comments (
      id TEXT PRIMARY KEY, resource TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL,
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX comments_resource_order ON comments(resource,created_at,id);
    CREATE TABLE support (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      email TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX support_user ON support(user_id,created_at,id);
    CREATE TABLE gifts (
      hash TEXT PRIMARY KEY, plan TEXT NOT NULL CHECK (plan IN ('month','year','lifetime')),
      creator TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      redeemed_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE legacy_imports (
      fingerprint TEXT PRIMARY KEY, imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      summary JSONB NOT NULL
    );
    CREATE TABLE legacy_state_snapshots (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      version TEXT NOT NULL CHECK (version = 'legacy-v1'), value TEXT NOT NULL,
      checksum TEXT NOT NULL, import_fingerprint TEXT NOT NULL REFERENCES legacy_imports(fingerprint)
    );
  `,
}, {
  version: 2,
  name: 'versioned-assessments',
  sql: `
    CREATE TABLE content_versions (
      id TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (octet_length(value) <= 2097152)
    );
    CREATE TABLE assessment_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      topic TEXT NOT NULL, content_version TEXT NOT NULL REFERENCES content_versions(id),
      answers TEXT NOT NULL CHECK (octet_length(answers) <= 65536),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), completed_at TEXT
    );
    CREATE INDEX assessment_sessions_owner ON assessment_sessions(user_id,completed_at);
  `,
}, {
  version: 3,
  name: 'durable-operation-boundaries',
  sql: `
    CREATE TABLE durable_operations (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      request_key TEXT NOT NULL, request_hash TEXT NOT NULL, resource TEXT NOT NULL,
      payload TEXT NOT NULL CHECK (octet_length(payload) <= 262144),
      retry_mode TEXT NOT NULL CHECK (retry_mode IN ('idempotent','reconcile')),
      job_id TEXT NOT NULL UNIQUE,
      generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ,
      receipt TEXT CHECK (octet_length(receipt) <= 16384),
      UNIQUE (scope,kind,request_key),
      CHECK ((completed_at IS NULL) = (receipt IS NULL))
    );
    CREATE INDEX durable_operations_owner ON durable_operations(owner_id,created_at DESC,id);
    CREATE TABLE verified_event_inbox (
      source TEXT NOT NULL, event_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      payload TEXT NOT NULL CHECK (octet_length(payload) <= 262144),
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (source,event_id)
    );
    CREATE TABLE job_operator_events (
      id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES durable_operations(id),
      actor TEXT NOT NULL, reason TEXT NOT NULL,
      previous_job_id TEXT NOT NULL, next_job_id TEXT NOT NULL,
      generation INTEGER NOT NULL CHECK (generation > 0),
      provider_reconciled INTEGER NOT NULL CHECK (provider_reconciled IN (0,1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `,
}, {
  version: 4,
  name: 'managed-identity-and-browser-sessions',
  sql: `
    ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    CREATE TABLE managed_accounts (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending-verification','active','suspended','deletion-pending')),
      contact_email TEXT, contact_identity_id TEXT,
      contact_verified INTEGER NOT NULL DEFAULT 0 CHECK (contact_verified IN (0,1)),
      session_epoch INTEGER NOT NULL DEFAULT 0 CHECK (session_epoch >= 0),
      CHECK (status <> 'active' OR contact_verified=1),
      CHECK (contact_verified=0 OR (contact_email IS NOT NULL AND contact_identity_id IS NOT NULL))
    );
    CREATE TABLE managed_identities (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issuer TEXT NOT NULL, subject TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('email','google','github')),
      email TEXT, verified INTEGER NOT NULL CHECK (verified IN (0,1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (issuer,subject), UNIQUE (id,user_id)
    );
    ALTER TABLE managed_accounts ADD CONSTRAINT managed_contact_owner
      FOREIGN KEY (contact_identity_id,user_id) REFERENCES managed_identities(id,user_id);
    CREATE INDEX managed_identities_owner ON managed_identities(user_id,id);
    CREATE TABLE managed_sessions (
      token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE,
      id TEXT NOT NULL UNIQUE, identity_id TEXT NOT NULL REFERENCES managed_identities(id) ON DELETE CASCADE,
      epoch INTEGER NOT NULL CHECK (epoch >= 0), csrf_hash TEXT NOT NULL,
      authenticated_at BIGINT NOT NULL, created_at BIGINT NOT NULL, last_used BIGINT NOT NULL
    );
    CREATE TABLE auth_transactions (
      state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('email','google','github')),
      purpose TEXT NOT NULL CHECK (purpose IN ('login','reauth','link','legacy-link')),
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT, legacy_credential_hash TEXT,
      return_to TEXT NOT NULL, expires BIGINT NOT NULL, created_at BIGINT NOT NULL,
      CHECK ((purpose='login') = (user_id IS NULL)),
      CHECK ((purpose='legacy-link') = (legacy_credential_hash IS NOT NULL))
    );
    CREATE INDEX auth_transactions_expiry ON auth_transactions(expires);
    CREATE INDEX auth_transactions_browser ON auth_transactions(binding_hash,expires);
    CREATE TABLE identity_security_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL, identity_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `,
}, {
  version: 5,
  name: 'shared-managed-authentication-admission',
  sql: `
    CREATE TABLE identity_abuse_buckets (
      scope TEXT NOT NULL CHECK (scope IN ('network','legacy-account','account-security')),
      fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
      attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 31),
      started BIGINT NOT NULL CHECK (started >= 0),
      expires BIGINT NOT NULL CHECK (expires > started),
      PRIMARY KEY (scope,fingerprint)
    );
    CREATE INDEX identity_abuse_expiry ON identity_abuse_buckets(expires);
  `,
}, {
  version: 6,
  name: 'managed-credential-lifecycle',
  sql: `
    ALTER TABLE managed_accounts ADD COLUMN security_cutoff BIGINT NOT NULL DEFAULT 0 CHECK (security_cutoff >= 0);
    ALTER TABLE managed_identities ADD COLUMN available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1));
    ALTER TABLE auth_transactions ADD COLUMN requires_fresh INTEGER NOT NULL DEFAULT 0 CHECK (requires_fresh IN (0,1));
    UPDATE auth_transactions SET requires_fresh=1 WHERE purpose<>'login';
    ALTER TABLE auth_transactions ADD CONSTRAINT auth_transaction_fresh_proof CHECK (purpose='login' OR requires_fresh=1);
    CREATE TABLE identity_subject_security (
      issuer TEXT NOT NULL, subject TEXT NOT NULL,
      auth_cutoff BIGINT NOT NULL DEFAULT 0 CHECK (auth_cutoff >= 0),
      canonical_version BIGINT NOT NULL DEFAULT 0 CHECK (canonical_version >= 0),
      disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0,1,2)),
      PRIMARY KEY (issuer,subject)
    );
  `,
}, {
  version: 7,
  name: 'managed-entitlement-authority',
  sql: `
    CREATE TABLE entitlement_grants (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('billing','support','promotion','engineering')),
      source_key TEXT NOT NULL, policy TEXT NOT NULL CHECK (policy IN ('pro-v1','premium-read-v1')),
      starts_at BIGINT NOT NULL CHECK (starts_at >= 0), ends_at BIGINT NOT NULL CHECK (ends_at > starts_at),
      request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_kind,source_key)
    );
    CREATE INDEX entitlement_owner_window ON entitlement_grants(user_id,ends_at,starts_at);
    CREATE TABLE entitlement_revocations (
      source_kind TEXT NOT NULL CHECK (source_kind IN ('billing','support','promotion','engineering')),
      source_key TEXT NOT NULL, user_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (source_kind,source_key)
    );
    CREATE TABLE entitlement_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      grant_id TEXT REFERENCES entitlement_grants(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK (action IN ('issued','revoked')),
      actor TEXT NOT NULL, reason TEXT NOT NULL, source_kind TEXT NOT NULL, source_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX entitlement_events_owner ON entitlement_events(user_id,created_at);
    CREATE FUNCTION retire_entitlement_sources() RETURNS trigger LANGUAGE plpgsql AS $entitlement$
    BEGIN
      INSERT INTO entitlement_revocations (source_kind,source_key,user_id)
        SELECT source_kind,source_key,user_id FROM entitlement_grants WHERE user_id=OLD.id
        ON CONFLICT (source_kind,source_key) DO NOTHING;
      RETURN OLD;
    END
    $entitlement$;
    CREATE TRIGGER retire_entitlement_sources BEFORE DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION retire_entitlement_sources();
  `,
}, {
  version: 8,
  name: 'sandbox-billing-notification-evidence',
  sql: `
    CREATE TABLE stripe_billing_reference (
      singleton INTEGER PRIMARY KEY CHECK (singleton=1),
      account_id TEXT NOT NULL, bound_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE stripe_event_notifications (
      account_id TEXT NOT NULL, event_id TEXT NOT NULL,
      event_type TEXT NOT NULL, object_id TEXT NOT NULL, object_kind TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      classification TEXT NOT NULL CHECK (classification IN ('supported','unsupported')),
      state TEXT NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted','observed','ignored')),
      payload TEXT NOT NULL CHECK (octet_length(payload) <= 4096),
      observation TEXT CHECK (octet_length(observation) <= 8192),
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(), observed_at TIMESTAMPTZ,
      PRIMARY KEY (account_id,event_id),
      CHECK ((state='observed') = (observation IS NOT NULL)),
      CHECK ((state='accepted') = (observed_at IS NULL)),
      CHECK (state<>'ignored' OR classification='unsupported'),
      CHECK (state<>'observed' OR classification='supported')
    );
    CREATE INDEX stripe_notification_backlog ON stripe_event_notifications(state,accepted_at);
    CREATE INDEX stripe_notification_object ON stripe_event_notifications(account_id,object_kind,object_id);
  `,
}] as const;

function checksum(sql: string) { return createHash('sha256').update(sql).digest('hex'); }

export async function migrateDatabase(db: Database): Promise<void> {
  if (db.dialect !== 'postgres') throw new Error('Controlled migrations require PostgreSQL.');
  await db.transaction(async () => {
    await db.prepare('SELECT pg_advisory_xact_lock(?)').get(749131620);
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const applied = await db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
    for (const row of applied) {
      const migration = migrations.find(item => item.version === row.version);
      if (!migration || row.name !== migration.name || row.checksum !== checksum(migration.sql)) {
        throw new Error('Database migration history does not match this application release.');
      }
    }
    for (const migration of migrations) {
      if (applied.some(row => row.version === migration.version)) continue;
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO schema_migrations (version,name,checksum) VALUES (?,?,?)').run(migration.version, migration.name, checksum(migration.sql));
    }
  });
}

export async function assertDatabaseVersion(db: Database): Promise<void> {
  if (db.dialect === 'sqlite') return;
  const table = await db.prepare("SELECT to_regclass('schema_migrations') AS name").get();
  if (!table?.name) throw new Error('PostgreSQL migrations are missing. Run npm run db:migrate before starting this release.');
  const rows = await db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all();
  if (rows.length !== migrations.length || migrations.some(migration => !rows.some(row => row.version === migration.version && row.name === migration.name && row.checksum === checksum(migration.sql)))) {
    throw new Error('PostgreSQL schema is incompatible with this release. Run the controlled migration command.');
  }
}
