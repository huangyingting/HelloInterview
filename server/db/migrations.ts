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
