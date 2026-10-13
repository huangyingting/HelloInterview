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
}, {
  version: 9,
  name: 'owned-sandbox-checkout-intents',
  sql: `
    ALTER TABLE identity_abuse_buckets DROP CONSTRAINT identity_abuse_buckets_scope_check;
    ALTER TABLE identity_abuse_buckets ADD CONSTRAINT identity_abuse_buckets_scope_check
      CHECK (scope IN ('network','legacy-account','account-security','billing'));
    CREATE TABLE stripe_owned_customers (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_id TEXT, state TEXT NOT NULL CHECK (state IN ('reserved','mapped','retired')),
      auth_epoch BIGINT NOT NULL CHECK (auth_epoch >= 0),
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      UNIQUE (account_id,user_id), UNIQUE (account_id,customer_id),
      CHECK (state<>'mapped' OR customer_id IS NOT NULL),
      CHECK ((state='retired') = (user_id IS NULL))
    );
    CREATE TABLE stripe_checkout_attempts (
      id TEXT PRIMARY KEY, customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      request_key TEXT NOT NULL, offer_key TEXT NOT NULL CHECK (offer_key IN ('pro_monthly','pro_annual')),
      price_id TEXT NOT NULL, origin TEXT NOT NULL, auth_epoch BIGINT NOT NULL CHECK (auth_epoch >= 0),
      state TEXT NOT NULL CHECK (state IN ('waiting-customer','queued','open','complete','expired','retired')),
      operation_id TEXT UNIQUE REFERENCES durable_operations(id),
      refresh_operation_id TEXT REFERENCES durable_operations(id),
      session_id TEXT UNIQUE, subscription_id TEXT, payment_status TEXT,
      hosted_url TEXT CHECK (octet_length(hosted_url) <= 8192),
      currency TEXT, unit_amount BIGINT CHECK (unit_amount > 0),
      expires_at BIGINT NOT NULL CHECK (expires_at > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), observed_at TIMESTAMPTZ,
      UNIQUE (customer_ref,request_key),
      CHECK ((currency IS NULL) = (unit_amount IS NULL)),
      CHECK (currency IS NULL OR currency='usd'),
      CHECK (payment_status IS NULL OR payment_status IN ('paid','unpaid','no_payment_required')),
      CHECK (state<>'waiting-customer' OR operation_id IS NULL),
      CHECK (state NOT IN ('queued','open','complete','expired') OR operation_id IS NOT NULL),
      CHECK (state NOT IN ('open','complete','expired') OR session_id IS NOT NULL),
      CHECK ((state='open') = (hosted_url IS NOT NULL))
    );
    CREATE UNIQUE INDEX stripe_one_unresolved_checkout ON stripe_checkout_attempts(customer_ref)
      WHERE state IN ('waiting-customer','queued','open','complete');
    CREATE INDEX stripe_checkout_refresh ON stripe_checkout_attempts(state,observed_at);
    CREATE FUNCTION retire_billing_customer() RETURNS trigger LANGUAGE plpgsql AS $billing$
    BEGIN
      UPDATE stripe_checkout_attempts SET state='retired',hosted_url=NULL
        WHERE customer_ref IN (SELECT id FROM stripe_owned_customers WHERE user_id=OLD.id);
      UPDATE stripe_owned_customers SET state='retired',user_id=NULL WHERE user_id=OLD.id;
      RETURN OLD;
    END
    $billing$;
    CREATE TRIGGER retire_billing_customer BEFORE DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION retire_billing_customer();
  `,
}, {
  version: 10,
  name: 'owned-canonical-billing-observations',
  sql: `
    CREATE TABLE stripe_customer_ledger_state (
      customer_ref TEXT PRIMARY KEY REFERENCES stripe_owned_customers(id),
      requested_revision BIGINT NOT NULL DEFAULT 0 CHECK (requested_revision >= 0),
      reconciled_revision BIGINT NOT NULL DEFAULT 0 CHECK (reconciled_revision >= 0 AND reconciled_revision <= requested_revision),
      operation_id TEXT REFERENCES durable_operations(id),
      observed_at TIMESTAMPTZ,
      snapshot TEXT CHECK (octet_length(snapshot) <= 262144),
      CHECK ((observed_at IS NULL) = (snapshot IS NULL))
    );
    CREATE TABLE stripe_ledger_notification_links (
      account_id TEXT NOT NULL, event_id TEXT NOT NULL,
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      revision BIGINT NOT NULL CHECK (revision > 0),
      PRIMARY KEY(account_id,event_id),
      FOREIGN KEY(account_id,event_id) REFERENCES stripe_event_notifications(account_id,event_id)
    );
    CREATE INDEX stripe_ledger_notifications_revision ON stripe_ledger_notification_links(customer_ref,revision);
    CREATE INDEX stripe_observed_customer ON stripe_event_notifications(account_id,((observation::jsonb)->>'customerId')) WHERE observation IS NOT NULL;
    CREATE TABLE stripe_owned_subscription_ledger (
      id TEXT PRIMARY KEY, customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      account_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      revision BIGINT NOT NULL CHECK (revision > 0),
      status TEXT NOT NULL, payload TEXT NOT NULL CHECK (octet_length(payload) <= 16384),
      UNIQUE(account_id,subscription_id)
    );
    CREATE TABLE stripe_owned_invoice_ledger (
      id TEXT PRIMARY KEY, customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      account_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
      revision BIGINT NOT NULL CHECK (revision > 0),
      created_at_seconds BIGINT NOT NULL CHECK (created_at_seconds >= 0),
      status TEXT NOT NULL, payload TEXT NOT NULL CHECK (octet_length(payload) <= 131072),
      UNIQUE(account_id,invoice_id)
    );
    CREATE TABLE stripe_customer_ledger_snapshots (
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      revision BIGINT NOT NULL CHECK (revision > 0),
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      fingerprint TEXT NOT NULL, payload TEXT NOT NULL CHECK (octet_length(payload) <= 262144),
      PRIMARY KEY(customer_ref,revision)
    );
  `,
}, {
  version: 11,
  name: 'owned-invoice-charge-correlations',
  sql: `
    CREATE TABLE stripe_invoice_charge_links (
      account_id TEXT NOT NULL, charge_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      first_revision BIGINT NOT NULL CHECK (first_revision > 0),
      PRIMARY KEY(account_id,charge_id,invoice_id),
      FOREIGN KEY(account_id,invoice_id) REFERENCES stripe_owned_invoice_ledger(account_id,invoice_id)
    );
    CREATE INDEX stripe_charge_customer ON stripe_invoice_charge_links(customer_ref,charge_id);
  `,
}, {
  version: 12,
  name: 'sandbox-owned-service-authority',
  sql: `
    CREATE TABLE stripe_invoice_service_evidence (
      account_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      source_key TEXT NOT NULL UNIQUE, policy_version TEXT NOT NULL CHECK (policy_version='sandbox-card-service-v1'),
      revision BIGINT NOT NULL CHECK (revision > 0),
      payload TEXT NOT NULL CHECK (octet_length(payload) <= 8192),
      PRIMARY KEY(account_id,invoice_id),
      FOREIGN KEY(account_id,invoice_id) REFERENCES stripe_owned_invoice_ledger(account_id,invoice_id)
    );
    CREATE INDEX stripe_service_customer ON stripe_invoice_service_evidence(customer_ref);
  `,
}, {
  version: 13,
  name: 'owned-sandbox-renewal-control',
  sql: `
    CREATE TABLE stripe_subscription_cancellations (
      id TEXT PRIMARY KEY,
      policy_version TEXT NOT NULL CHECK (policy_version='sandbox-renewal-control-v1'),
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      subscription_ref TEXT NOT NULL UNIQUE REFERENCES stripe_owned_subscription_ledger(id),
      attempt_id TEXT NOT NULL REFERENCES stripe_checkout_attempts(id),
      auth_epoch BIGINT NOT NULL CHECK (auth_epoch >= 0),
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      state TEXT NOT NULL CHECK (state IN ('queued','confirmed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      confirmed_at TIMESTAMPTZ, result TEXT CHECK (result IN ('nonrenewing','ended')),
      CHECK ((state='confirmed') = (confirmed_at IS NOT NULL)),
      CHECK ((state='confirmed') = (result IS NOT NULL))
    );
    CREATE INDEX stripe_cancellation_customer ON stripe_subscription_cancellations(customer_ref);
  `,
}, {
  version: 14,
  name: 'restricted-sandbox-portal-access',
  sql: `
    CREATE TABLE stripe_portal_access (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      customer_id TEXT NOT NULL, configuration_id TEXT NOT NULL, origin TEXT NOT NULL,
      auth_epoch BIGINT NOT NULL CHECK (auth_epoch >= 0),
      policy_version TEXT NOT NULL CHECK (policy_version='sandbox-restricted-portal-v1'),
      state TEXT NOT NULL CHECK (state IN ('requested','issued')),
      created_at TIMESTAMPTZ NOT NULL, issued_at TIMESTAMPTZ,
      provider_session_id TEXT UNIQUE, policy_proof TEXT CHECK (policy_proof ~ '^[a-f0-9]{64}$'),
      CHECK ((state='issued') = (issued_at IS NOT NULL)),
      CHECK ((state='issued') = (provider_session_id IS NOT NULL)),
      CHECK ((state='issued') = (policy_proof IS NOT NULL))
    );
    CREATE INDEX stripe_portal_customer ON stripe_portal_access(customer_ref,created_at);
  `,
}, {
  version: 15,
  name: 'owned-sandbox-renewal-cycles',
  sql: `
    ALTER TABLE stripe_subscription_cancellations DROP CONSTRAINT stripe_subscription_cancellations_subscription_ref_key;
    ALTER TABLE stripe_subscription_cancellations DROP CONSTRAINT stripe_subscription_cancellations_policy_version_check;
    ALTER TABLE stripe_subscription_cancellations
      ADD COLUMN cycle BIGINT NOT NULL DEFAULT 0 CHECK (cycle >= 0),
      ADD COLUMN previous_resumption_id TEXT UNIQUE,
      ADD CONSTRAINT stripe_cancellation_cycle UNIQUE(subscription_ref,cycle),
      ADD CONSTRAINT stripe_cancellation_scope UNIQUE(id,customer_ref,subscription_ref,attempt_id),
      ADD CONSTRAINT stripe_cancellation_cycle_policy CHECK (
        (cycle=0 AND previous_resumption_id IS NULL AND policy_version='sandbox-renewal-control-v1') OR
        (cycle>0 AND previous_resumption_id IS NOT NULL AND policy_version='sandbox-renewal-control-v2'));
    CREATE TABLE stripe_subscription_resumptions (
      id TEXT PRIMARY KEY,
      policy_version TEXT NOT NULL CHECK (policy_version='sandbox-renewal-resumption-v1'),
      customer_ref TEXT NOT NULL REFERENCES stripe_owned_customers(id),
      subscription_ref TEXT NOT NULL REFERENCES stripe_owned_subscription_ledger(id),
      attempt_id TEXT NOT NULL REFERENCES stripe_checkout_attempts(id),
      cancellation_id TEXT NOT NULL UNIQUE,
      auth_epoch BIGINT NOT NULL CHECK (auth_epoch >= 0),
      price_id TEXT NOT NULL, offer_key TEXT NOT NULL CHECK (offer_key IN ('pro_monthly','pro_annual')),
      currency TEXT NOT NULL CHECK (currency='usd'), unit_amount BIGINT NOT NULL CHECK (unit_amount > 0),
      item_id TEXT NOT NULL, period_start BIGINT NOT NULL CHECK (period_start >= 0),
      period_end BIGINT NOT NULL CHECK (period_end > period_start),
      billing_anchor BIGINT NOT NULL CHECK (billing_anchor >= 0),
      invoice_id TEXT NOT NULL, eligibility_proof TEXT NOT NULL CHECK (eligibility_proof ~ '^[a-f0-9]{64}$'),
      acknowledged INTEGER NOT NULL CHECK (acknowledged=1),
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      state TEXT NOT NULL CHECK (state IN ('queued','confirmed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      confirmed_at TIMESTAMPTZ, result TEXT CHECK (result='renewing'),
      UNIQUE(id,customer_ref,subscription_ref,attempt_id),
      FOREIGN KEY(cancellation_id,customer_ref,subscription_ref,attempt_id)
        REFERENCES stripe_subscription_cancellations(id,customer_ref,subscription_ref,attempt_id),
      CHECK ((state='confirmed') = (confirmed_at IS NOT NULL)),
      CHECK ((state='confirmed') = (result IS NOT NULL))
    );
    ALTER TABLE stripe_subscription_cancellations ADD CONSTRAINT stripe_cancellation_predecessor
      FOREIGN KEY(previous_resumption_id,customer_ref,subscription_ref,attempt_id)
        REFERENCES stripe_subscription_resumptions(id,customer_ref,subscription_ref,attempt_id);
    CREATE INDEX stripe_resumption_customer ON stripe_subscription_resumptions(customer_ref);
  `,
}, {
  version: 16,
  name: 'owned-ended-subscription-recheckout',
  sql: `
    ALTER TABLE stripe_checkout_attempts ADD CONSTRAINT stripe_checkout_scope UNIQUE(id,customer_ref);
    ALTER TABLE stripe_owned_subscription_ledger ADD CONSTRAINT stripe_subscription_scope UNIQUE(id,customer_ref);
    ALTER TABLE stripe_checkout_attempts
      ADD COLUMN previous_subscription_ref TEXT,
      ADD COLUMN previous_attempt_id TEXT,
      ADD COLUMN previous_subscription_id TEXT,
      ADD COLUMN recheckout_acknowledged INTEGER,
      ADD CONSTRAINT stripe_recheckout_subscription FOREIGN KEY(previous_subscription_ref,customer_ref)
        REFERENCES stripe_owned_subscription_ledger(id,customer_ref),
      ADD CONSTRAINT stripe_recheckout_attempt FOREIGN KEY(previous_attempt_id,customer_ref)
        REFERENCES stripe_checkout_attempts(id,customer_ref),
      ADD CONSTRAINT stripe_recheckout_scope CHECK (
        (previous_subscription_ref IS NULL AND previous_attempt_id IS NULL AND previous_subscription_id IS NULL AND recheckout_acknowledged IS NULL) OR
        (previous_subscription_ref IS NOT NULL AND previous_attempt_id IS NOT NULL AND previous_attempt_id<>id
          AND previous_subscription_id IS NOT NULL AND recheckout_acknowledged IS NOT NULL AND recheckout_acknowledged=1));
    CREATE TABLE stripe_customer_checkout_cursor (
      customer_ref TEXT PRIMARY KEY REFERENCES stripe_owned_customers(id),
      attempt_id TEXT NOT NULL,
      FOREIGN KEY(attempt_id,customer_ref) REFERENCES stripe_checkout_attempts(id,customer_ref)
    );
    INSERT INTO stripe_customer_checkout_cursor(customer_ref,attempt_id)
      SELECT DISTINCT ON (customer_ref) customer_ref,id FROM stripe_checkout_attempts
      ORDER BY customer_ref,(state IN ('waiting-customer','queued','open','complete')) DESC,created_at DESC,id DESC;
    DROP INDEX stripe_one_unresolved_checkout;
    CREATE UNIQUE INDEX stripe_one_unresolved_checkout ON stripe_checkout_attempts(customer_ref)
      WHERE state IN ('waiting-customer','queued','open');
  `,
}, {
  version: 17,
  name: 'owned-sandbox-ai-usage-ledger',
  sql: `
    CREATE TABLE ai_usage_policies (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(octet_length(payload)<=16384),
      request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE ai_usage_lineages (
      id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      anchor BIGINT NOT NULL CHECK(anchor>=0), service_start BIGINT NOT NULL CHECK(service_start>=0),
      service_end BIGINT NOT NULL CHECK(service_end>service_start),
      UNIQUE(id,owner_ref), CHECK(user_id IS NULL OR user_id=owner_ref)
    );
    CREATE INDEX ai_usage_lineage_owner ON ai_usage_lineages(owner_ref);
    CREATE TABLE ai_usage_windows (
      id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, lineage_id TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES ai_usage_policies(id),
      starts_at BIGINT NOT NULL CHECK(starts_at>=0), ends_at BIGINT NOT NULL CHECK(ends_at>starts_at),
      unit_limit INTEGER NOT NULL CHECK(unit_limit>0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),
      consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0),
      FOREIGN KEY(lineage_id,owner_ref) REFERENCES ai_usage_lineages(id,owner_ref),
      UNIQUE(lineage_id,starts_at), UNIQUE(id,owner_ref), CHECK(reserved::bigint+consumed<=unit_limit)
    );
    CREATE TABLE ai_usage_cost_budgets (
      kind TEXT NOT NULL CHECK(kind IN ('day','month')), starts_at BIGINT NOT NULL CHECK(starts_at>=0),
      ends_at BIGINT NOT NULL CHECK(ends_at>starts_at), policy_id TEXT NOT NULL REFERENCES ai_usage_policies(id),
      cost_limit BIGINT NOT NULL CHECK(cost_limit>0 AND cost_limit<=1000000000000),
      reserved BIGINT NOT NULL DEFAULT 0 CHECK(reserved>=0), consumed BIGINT NOT NULL DEFAULT 0 CHECK(consumed>=0),
      PRIMARY KEY(kind,starts_at), CHECK(reserved+consumed<=cost_limit)
    );
    CREATE TABLE ai_usage_reservations (
      id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      request_key TEXT NOT NULL, window_id TEXT NOT NULL, policy_id TEXT NOT NULL REFERENCES ai_usage_policies(id),
      request_payload TEXT NOT NULL CHECK(octet_length(request_payload)<=16384),
      request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
      units INTEGER NOT NULL CHECK(units>0), cost_ceiling BIGINT NOT NULL CHECK(cost_ceiling>0 AND cost_ceiling<=1000000000000),
      state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','unknown','consumed','released')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), dispatched_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
      result_hash TEXT CHECK(result_hash ~ '^[a-f0-9]{64}$'), actual_cost BIGINT CHECK(actual_cost>=0 AND actual_cost<=cost_ceiling),
      settlement_hash TEXT CHECK(settlement_hash ~ '^[a-f0-9]{64}$'),
      FOREIGN KEY(window_id,owner_ref) REFERENCES ai_usage_windows(id,owner_ref),
      UNIQUE(owner_ref,request_key), UNIQUE(id,owner_ref), CHECK(user_id IS NULL OR user_id=owner_ref),
      CHECK((state IN ('consumed','released'))=(finished_at IS NOT NULL)),
      CHECK((state IN ('consumed','released'))=(actual_cost IS NOT NULL)),
      CHECK((state IN ('consumed','released'))=(settlement_hash IS NOT NULL)),
      CHECK((state='consumed')=(result_hash IS NOT NULL)),
      CHECK(state<>'reserved' OR dispatched_at IS NULL),
      CHECK(state NOT IN ('dispatched','unknown','consumed') OR dispatched_at IS NOT NULL),
      CHECK(dispatched_at IS NULL OR dispatched_at>=created_at),
      CHECK(finished_at IS NULL OR finished_at>=coalesce(dispatched_at,created_at))
    );
    CREATE INDEX ai_usage_inflight ON ai_usage_reservations(state,owner_ref);
    CREATE TABLE ai_usage_budget_links (
      reservation_id TEXT NOT NULL REFERENCES ai_usage_reservations(id),
      kind TEXT NOT NULL CHECK(kind IN ('day','month')), starts_at BIGINT NOT NULL,
      PRIMARY KEY(reservation_id,kind), FOREIGN KEY(kind,starts_at) REFERENCES ai_usage_cost_budgets(kind,starts_at)
    );
    CREATE TABLE ai_usage_events (
      id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES ai_usage_reservations(id), owner_ref TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('reserved','dispatched','unknown','consumed','released')),
      actor TEXT NOT NULL CHECK(length(actor) BETWEEN 1 AND 200), reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE(reservation_id,action),
      FOREIGN KEY(reservation_id,owner_ref) REFERENCES ai_usage_reservations(id,owner_ref)
    );
  `,
}, {
  version: 18,
  name: 'owned-ai-reservation-native-intents',
  sql: `
    ALTER TABLE durable_operations ADD CONSTRAINT durable_operation_scoped_id UNIQUE(id,scope,kind);
    CREATE TABLE ai_usage_operations (
      reservation_id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE, operation_scope TEXT NOT NULL,
      operation_kind TEXT NOT NULL CHECK(operation_kind='ai.evaluate'),
      operation_request_hash TEXT NOT NULL CHECK(operation_request_hash ~ '^[a-f0-9]{64}$'),
      job_id TEXT NOT NULL UNIQUE, generation INTEGER NOT NULL CHECK(generation=0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      CHECK(operation_scope='user:'||owner_ref),
      FOREIGN KEY(reservation_id,owner_ref) REFERENCES ai_usage_reservations(id,owner_ref),
      FOREIGN KEY(operation_id,operation_scope,operation_kind) REFERENCES durable_operations(id,scope,kind)
    );
  `,
}, {
  version: 19,
  name: 'owned-ai-input-provenance',
  sql: `
    CREATE TABLE ai_input_policies (
      id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(octet_length(payload)<=131072),
      request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE ai_input_snapshots (
      id TEXT PRIMARY KEY, owner_ref TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      request_key TEXT NOT NULL, request_payload TEXT NOT NULL CHECK(octet_length(request_payload)<=16384),
      request_hash TEXT NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
      policy_id TEXT NOT NULL REFERENCES ai_input_policies(id),
      reservation_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('tutor','feedback','mock','project')),
      source_id TEXT NOT NULL, source_revision INTEGER NOT NULL CHECK(source_revision>=0),
      source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
      input_hash TEXT NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
      payload TEXT CHECK(octet_length(payload)<=131072), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(owner_ref,request_key), CHECK(user_id IS NULL OR user_id=owner_ref),
      CHECK((user_id IS NULL)=(payload IS NULL)),
      FOREIGN KEY(reservation_id,owner_ref) REFERENCES ai_usage_reservations(id,owner_ref)
    );
    CREATE INDEX ai_input_live_source ON ai_input_snapshots(owner_ref,kind,source_id) WHERE user_id IS NOT NULL;
    CREATE FUNCTION erase_owned_ai_inputs() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        UPDATE ai_input_snapshots SET user_id=NULL,payload=NULL WHERE owner_ref=OLD.id AND user_id IS NOT NULL;
        RETURN OLD;
      END;
    $$;
    CREATE TRIGGER erase_owned_ai_inputs BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION erase_owned_ai_inputs();
    CREATE FUNCTION erase_deleted_ai_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        UPDATE ai_input_snapshots SET user_id=NULL,payload=NULL
          WHERE owner_ref=OLD.user_id AND source_id=OLD.id AND kind=TG_ARGV[0] AND user_id IS NOT NULL;
        RETURN OLD;
      END;
    $$;
    CREATE TRIGGER erase_attempt_ai_input AFTER DELETE ON attempts FOR EACH ROW EXECUTE FUNCTION erase_deleted_ai_source('feedback');
    CREATE TRIGGER erase_mock_ai_input AFTER DELETE ON mock_sessions FOR EACH ROW EXECUTE FUNCTION erase_deleted_ai_source('mock');
    CREATE TRIGGER erase_project_ai_input AFTER DELETE ON project_workspaces FOR EACH ROW EXECUTE FUNCTION erase_deleted_ai_source('project');
    CREATE TRIGGER erase_tutor_ai_input AFTER DELETE ON tutor_messages FOR EACH ROW EXECUTE FUNCTION erase_deleted_ai_source('tutor');
  `,
}, {
  version: 20,
  name: 'owned-support-receipts-and-admission',
  sql: `
    ALTER TABLE support ADD COLUMN request_key TEXT;
    ALTER TABLE support ADD COLUMN request_hash TEXT;
    ALTER TABLE support ADD CONSTRAINT support_request_pair CHECK (
      (request_key IS NULL AND request_hash IS NULL) OR
      (request_key IS NOT NULL AND request_hash IS NOT NULL AND user_id IS NOT NULL AND
        request_key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' AND request_hash ~ '^[a-f0-9]{64}$')
    );
    CREATE UNIQUE INDEX support_owned_request ON support(user_id,request_key) WHERE request_key IS NOT NULL;
    CREATE FUNCTION retire_owned_support_key() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF NEW.user_id IS NULL THEN NEW.request_key=NULL; NEW.request_hash=NULL; END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER retire_owned_support_key BEFORE UPDATE OF user_id ON support
      FOR EACH ROW EXECUTE FUNCTION retire_owned_support_key();
    ALTER TABLE identity_abuse_buckets DROP CONSTRAINT identity_abuse_buckets_scope_check;
    ALTER TABLE identity_abuse_buckets ADD CONSTRAINT identity_abuse_buckets_scope_check
      CHECK (scope IN ('network','legacy-account','account-security','billing','support-network','support-account'));
  `,
}, {
  version: 21,
  name: 'bounded-community-read-indexes',
  sql: `
    CREATE INDEX posts_owner_order ON posts(author_id,created_at DESC,id DESC);
    CREATE INDEX posts_created_order ON posts(created_at DESC,id DESC);
    CREATE INDEX follows_owner ON follows(user_id,post_id);
  `,
}, {
  version: 22,
  name: 'owned-community-post-revisions',
  sql: `
    CREATE TABLE community_post_revisions (
      post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    );
    INSERT INTO community_post_revisions(post_id) SELECT id FROM posts;
    CREATE FUNCTION maintain_community_post_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF TG_OP='INSERT' THEN INSERT INTO community_post_revisions(post_id) VALUES(NEW.id);
        ELSE
          UPDATE community_post_revisions SET revision=revision+1 WHERE post_id=NEW.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Missing community post revision.'; END IF;
        END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER maintain_community_post_revision AFTER INSERT OR UPDATE ON posts
      FOR EACH ROW EXECUTE FUNCTION maintain_community_post_revision();
  `,
}, {
  version: 23,
  name: 'owned-community-comment-revisions',
  sql: `
    CREATE TABLE community_comment_revisions (
      comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
    );
    INSERT INTO community_comment_revisions(comment_id) SELECT id FROM comments;
    CREATE FUNCTION maintain_community_comment_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF TG_OP='INSERT' THEN INSERT INTO community_comment_revisions(comment_id) VALUES(NEW.id);
        ELSE
          UPDATE community_comment_revisions SET revision=revision+1 WHERE comment_id=NEW.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Missing community comment revision.'; END IF;
        END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER maintain_community_comment_revision AFTER INSERT OR UPDATE ON comments
      FOR EACH ROW EXECUTE FUNCTION maintain_community_comment_revision();
  `,
}, {
  version: 24,
  name: 'bounded-community-discussion-pages',
  sql: `CREATE INDEX comments_resource_cursor ON comments(resource,created_at,id);`,
}, {
  version:25,
  name:'owned-local-comment-submission-receipts',
  sql:`
    CREATE TABLE community_comment_submissions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,comment_id TEXT NOT NULL UNIQUE,resource TEXT NOT NULL,
      input_hash TEXT NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),created_at TEXT NOT NULL,
      PRIMARY KEY(user_id,request_id)
    );
    CREATE INDEX community_comment_submissions_owner ON community_comment_submissions(user_id,created_at DESC,request_id DESC);
    CREATE INDEX community_comment_submissions_resource ON community_comment_submissions(user_id,resource,created_at DESC,request_id DESC);
    CREATE FUNCTION immutable_community_comment_submission() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN RAISE EXCEPTION 'Comment submission receipts are immutable.'; END;
    $$;
    CREATE TRIGGER immutable_community_comment_submission BEFORE UPDATE ON community_comment_submissions
      FOR EACH ROW EXECUTE FUNCTION immutable_community_comment_submission();
  `,
}, {
  version:26,
  name:'mfa-staff-account-administration',
  sql:`
    ALTER TABLE managed_sessions ADD COLUMN mfa_at BIGINT NOT NULL DEFAULT 0 CHECK (mfa_at >= 0);
    ALTER TABLE managed_accounts ADD COLUMN admin_revision INTEGER NOT NULL DEFAULT 0 CHECK (admin_revision >= 0);
    CREATE TABLE staff_role_events (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('support-agent','moderator','content-editor','billing-operator','administrator')),
      state TEXT NOT NULL CHECK (state IN ('granted','revoked')),
      actor_ref TEXT NOT NULL CHECK (actor_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 500),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      CHECK ((state='granted' AND ends_at IS NOT NULL AND ends_at>starts_at AND ends_at<=starts_at+interval '90 days') OR
        (state='revoked' AND ends_at IS NULL))
    );
    CREATE INDEX staff_role_events_owner ON staff_role_events(user_id,role,created_at DESC,id DESC);
    CREATE TABLE staff_audit_events (
      id TEXT PRIMARY KEY,actor_ref TEXT NOT NULL CHECK (actor_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
      actor_role TEXT CHECK (actor_role IS NULL OR actor_role IN ('support-agent','moderator','content-editor','billing-operator','administrator')),
      target_ref TEXT NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 200),
      action TEXT NOT NULL CHECK (action IN ('staff.role.granted','staff.role.revoked','account.suspended','account.reactivated')),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 500),
      prior_revision INTEGER,result_revision INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      CHECK ((prior_revision IS NULL AND result_revision IS NULL) OR
        (prior_revision IS NOT NULL AND prior_revision>=0 AND result_revision=prior_revision+1))
    );
    CREATE INDEX staff_audit_events_order ON staff_audit_events(created_at DESC,id DESC);
    CREATE FUNCTION immutable_staff_record() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN RAISE EXCEPTION 'Staff role and audit records are append-only.'; END;
    $$;
    CREATE TRIGGER immutable_staff_role_event BEFORE UPDATE ON staff_role_events
      FOR EACH ROW EXECUTE FUNCTION immutable_staff_record();
    CREATE TRIGGER immutable_staff_audit_event BEFORE UPDATE ON staff_audit_events
      FOR EACH ROW EXECUTE FUNCTION immutable_staff_record();
  `,
}, {
  version:27,
  name:'durable-owner-privacy-exports',
  sql:`
    CREATE TABLE privacy_exports (
      id TEXT NOT NULL CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL UNIQUE REFERENCES durable_operations(id),
      state TEXT NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','ready','expired')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      ready_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,
      artifact TEXT CHECK (artifact IS NULL OR octet_length(artifact)<=33554432),
      artifact_hash TEXT CHECK (artifact_hash IS NULL OR artifact_hash ~ '^[a-f0-9]{64}$'),
      artifact_bytes INTEGER CHECK (artifact_bytes IS NULL OR artifact_bytes BETWEEN 1 AND 33554432),
      CHECK ((state<>'requested')=(ready_at IS NOT NULL)),
      CHECK ((state<>'requested')=(expires_at IS NOT NULL)),
      CHECK ((state='ready')=(artifact IS NOT NULL)),
      CHECK ((state='ready')=(artifact_hash IS NOT NULL)),
      CHECK ((state='ready')=(artifact_bytes IS NOT NULL)),
      PRIMARY KEY(user_id,id),
      CHECK (expires_at IS NULL OR expires_at=ready_at+interval '24 hours')
    );
    CREATE INDEX privacy_exports_owner_order ON privacy_exports(user_id,requested_at DESC,id DESC);
    CREATE FUNCTION protect_privacy_export() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.operation_id<>OLD.operation_id OR
          NEW.requested_at<>OLD.requested_at OR NOT (
            OLD.state='requested' AND NEW.state='ready' OR
            OLD.state='ready' AND NEW.state='expired' AND OLD.expires_at<=clock_timestamp() AND
              NEW.ready_at=OLD.ready_at AND NEW.expires_at=OLD.expires_at AND
              NEW.artifact IS NULL AND NEW.artifact_hash IS NULL AND NEW.artifact_bytes IS NULL
          ) THEN
          RAISE EXCEPTION 'Privacy export records allow only one publish and one post-expiry erasure.';
        END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER protect_privacy_export_update BEFORE UPDATE ON privacy_exports
      FOR EACH ROW EXECUTE FUNCTION protect_privacy_export();
  `,
}, {
  version:28,
  name:'owner-privacy-deletion-foundation',
  sql:`
    CREATE TABLE privacy_deletions (
      id TEXT NOT NULL CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      operation_id TEXT UNIQUE REFERENCES durable_operations(id),
      state TEXT NOT NULL DEFAULT 'cooling-off' CHECK (state IN ('cooling-off','cancelled','blocked')),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      cancel_before TIMESTAMPTZ NOT NULL,
      cancelled_at TIMESTAMPTZ,blocked_at TIMESTAMPTZ,
      blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers)='array' AND jsonb_array_length(blockers)<=8),
      PRIMARY KEY(user_id,id),
      CHECK (cancel_before=requested_at+interval '7 days'),
      CHECK ((state='cancelled')=(cancelled_at IS NOT NULL)),
      CHECK ((state='blocked')=(blocked_at IS NOT NULL)),
      CHECK (state='blocked' OR blockers='[]'::jsonb),
      CHECK (operation_id IS NULL OR state IN ('cooling-off','blocked'))
    );
    CREATE UNIQUE INDEX privacy_deletions_open_owner ON privacy_deletions(user_id)
      WHERE state IN ('cooling-off','blocked');
    CREATE INDEX privacy_deletions_due ON privacy_deletions(cancel_before,id)
      WHERE state='cooling-off' AND operation_id IS NULL;
    CREATE FUNCTION protect_privacy_deletion() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.requested_at<>OLD.requested_at OR
          NEW.cancel_before<>OLD.cancel_before OR NOT (
            OLD.state='cooling-off' AND OLD.operation_id IS NULL AND NEW.state='cancelled' AND
              NEW.operation_id IS NULL AND NEW.cancelled_at>=OLD.requested_at AND NEW.cancelled_at<=OLD.cancel_before AND
              NEW.blocked_at IS NULL AND NEW.blockers='[]'::jsonb OR
            OLD.state='cooling-off' AND OLD.operation_id IS NULL AND NEW.state='cooling-off' AND
              NEW.operation_id IS NOT NULL AND OLD.cancel_before<=clock_timestamp() AND
              NEW.cancelled_at IS NULL AND NEW.blocked_at IS NULL AND NEW.blockers='[]'::jsonb OR
            OLD.state='cooling-off' AND OLD.operation_id IS NOT NULL AND NEW.operation_id=OLD.operation_id AND
              NEW.state='blocked' AND NEW.cancelled_at IS NULL AND NEW.blocked_at>=OLD.cancel_before AND
              NEW.blockers='["billing-cancellation-unapproved","processor-erasure-unavailable",
                "retention-policy-unapproved","backup-restore-reconciliation-unavailable"]'::jsonb
          ) THEN
          RAISE EXCEPTION 'Privacy deletion records allow only timely cancellation, due operation binding and blocked publication.';
        END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER protect_privacy_deletion_update BEFORE UPDATE ON privacy_deletions
      FOR EACH ROW EXECUTE FUNCTION protect_privacy_deletion();
  `,
}, {
  version:29,
  name:'mfa-in-app-support-operations',
  sql:`
    ALTER TABLE support ADD COLUMN handling_status TEXT NOT NULL DEFAULT 'open'
      CHECK (handling_status IN ('open','pending','resolved'));
    ALTER TABLE support ADD COLUMN support_revision INTEGER NOT NULL DEFAULT 0 CHECK (support_revision>=0);
    ALTER TABLE support ADD COLUMN assigned_to TEXT REFERENCES users(id);
    ALTER TABLE support ADD COLUMN support_updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();
    CREATE INDEX support_staff_queue ON support(handling_status,support_updated_at DESC,id DESC);
    CREATE INDEX support_assignee_queue ON support(assigned_to,handling_status,support_updated_at DESC,id DESC);
    CREATE TABLE support_replies (
      id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      ticket_id TEXT NOT NULL REFERENCES support(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL CHECK (request_key ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
      actor_ref TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 200),
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(ticket_id,request_key)
    );
    CREATE INDEX support_replies_ticket_order ON support_replies(ticket_id,created_at,id);
    CREATE TABLE support_staff_events (
      id TEXT PRIMARY KEY CHECK (id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      ticket_id TEXT NOT NULL REFERENCES support(id) ON DELETE CASCADE,
      actor_ref TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 200),
      actor_role TEXT NOT NULL CHECK (actor_role IN ('support-agent','administrator')),
      action TEXT NOT NULL CHECK (action IN ('assigned','unassigned','status.open','status.pending','status.resolved','replied')),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 500),
      prior_revision INTEGER NOT NULL CHECK (prior_revision>=0),
      result_revision INTEGER NOT NULL CHECK (result_revision=prior_revision+1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    );
    CREATE INDEX support_staff_events_ticket_order ON support_staff_events(ticket_id,created_at,id);
    CREATE FUNCTION immutable_support_record() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN RAISE EXCEPTION 'Support replies and staff events are append-only.'; END;
    $$;
    CREATE TRIGGER immutable_support_reply BEFORE UPDATE OR DELETE ON support_replies
      FOR EACH ROW EXECUTE FUNCTION immutable_support_record();
    CREATE TRIGGER immutable_support_staff_event BEFORE UPDATE OR DELETE ON support_staff_events
      FOR EACH ROW EXECUTE FUNCTION immutable_support_record();
    CREATE FUNCTION protect_support_ticket() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        IF NOT (
          OLD.user_id IS NOT NULL AND NEW.user_id IS NULL AND NEW.request_key IS NULL AND NEW.request_hash IS NULL AND
            NEW.id=OLD.id AND NEW.email=OLD.email AND NEW.body=OLD.body AND NEW.created_at=OLD.created_at AND
            NEW.handling_status=OLD.handling_status AND NEW.support_revision=OLD.support_revision AND
            NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to AND NEW.support_updated_at=OLD.support_updated_at OR
          NEW.id=OLD.id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id AND NEW.email=OLD.email AND
            NEW.body=OLD.body AND NEW.created_at=OLD.created_at AND NEW.request_key IS NOT DISTINCT FROM OLD.request_key AND
            NEW.request_hash IS NOT DISTINCT FROM OLD.request_hash AND NEW.support_revision=OLD.support_revision+1 AND
            NEW.support_updated_at>=OLD.support_updated_at AND
            (NEW.handling_status<>OLD.handling_status OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
        ) THEN
          RAISE EXCEPTION 'Support tickets allow only ownership retirement or revision-fenced staff state changes.';
        END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER zz_protect_support_ticket BEFORE UPDATE ON support
      FOR EACH ROW EXECUTE FUNCTION protect_support_ticket();
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
