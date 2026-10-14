import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Azure VM ingress uses the exact canonical host, loopback upstream and explicit unavailable fallback', async () => {
  const caddy = await readFile('deploy/azure-vm/interview.caddy', 'utf8');
  assert.equal(caddy.match(/^interview\.genisisiq\.com \{$/gm)?.length, 1);
  assert.match(caddy, /^\s+reverse_proxy 127\.0\.0\.1:10006$/m);
  assert.equal(caddy.match(/^\s+Strict-Transport-Security "max-age=86400"$/gm)?.length, 2);
  assert.equal(caddy.match(/^\s+-Server$/gm)?.length, 2);
  assert.match(caddy, /^\s+respond "Interview Studio private beta is not available\." 503$/m);
  assert.doesNotMatch(caddy, /0\.0\.0\.0|localhost|http:\/\//);
});

test('Azure VM runtime consumes only the verified release and remains secret-gated', async () => {
  const files = [
    'deploy/azure-vm/interview-studio.service',
    'deploy/azure-vm/interview-studio-identity-worker.service',
    'deploy/azure-vm/interview-studio-privacy-worker.service',
    'deploy/azure-vm/interview-studio-migrate.service',
  ];
  for (const file of files) {
    const unit = await readFile(file, 'utf8');
    assert.match(unit, /^EnvironmentFile=\/etc\/interview-studio\/release\.env$/m);
    assert.match(unit, /--network host/);
    assert.match(unit, /--read-only/);
    assert.match(unit, /--cap-drop ALL/);
    assert.match(unit, /--security-opt no-new-privileges/);
    assert.match(unit, /\$\{STUDIO_IMAGE\}/);
    assert.doesNotMatch(unit, /docker build|npm run build/);
    assert.match(unit, /docker image inspect --format=\{\{\.Id\}\}/);
  }
  for (const file of files.slice(0, 3)) {
    const unit = await readFile(file, 'utf8');
    assert.match(unit, /^ConditionPathExists=\/etc\/interview-studio\/service\.env$/m);
    assert.match(unit, /--env-file \/etc\/interview-studio\/runtime\.env --env-file \/etc\/interview-studio\/service\.env/);
    assert.doesNotMatch(unit, /APP_MODE=local/);
  }
  const migration = await readFile(files[3], 'utf8');
  assert.match(migration, /--env-file \/etc\/interview-studio\/migrate\.env --env APP_MODE=local/);
  const release = await readFile('deploy/azure-vm/Dockerfile.release', 'utf8');
  assert.match(release, /^FROM node:24-bookworm-slim@sha256:[a-f0-9]{64}$/m);
  assert.match(release, /^COPY dist \.\/dist$/m);
  assert.match(release, /^COPY dist-server \.\/dist-server$/m);
  assert.doesNotMatch(release, /npm run build|COPY \. \./);

  const installer = await readFile('deploy/azure-vm/install-runtime-units.sh', 'utf8');
  assert.match(installer, /systemctl disable interview-studio\.service/);
  assert.doesNotMatch(installer, /systemctl (?:enable|start|restart)/);

  const serviceEnv = await readFile('deploy/azure-vm/service.env.example', 'utf8');
  for (const setting of ['PRIVACY_CONTROLLER_NAME', 'PRIVACY_CONTACT_URL', 'PARTICIPANT_MINIMUM_AGE',
    'PRIVACY_RETENTION_NOTICE', 'PRIVACY_DELETION_NOTICE', 'PRIVATE_BETA_NO_DURABILITY_ACK']) {
    assert.match(serviceEnv, new RegExp(`^${setting}=`, 'm'));
  }
});

test('Azure VM database authority separates migration from runtime DML', async () => {
  const provision = await readFile('deploy/azure-vm/provision-database.sh', 'utf8');
  assert.match(provision, /interview_studio_migrator/);
  assert.match(provision, /interview_studio_runtime/);
  assert.match(provision, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION/g);
  assert.match(provision, /install -o root -g root -m 0600/);
  assert.match(provision, /^FIELD_METRICS_ENABLED=false$/m);
  assert.doesNotMatch(provision, /^FIELD_METRICS=/m);
  assert.doesNotMatch(provision, /echo.*password|set -x/);

  const grants = await readFile('deploy/azure-vm/grant-runtime.sql', 'utf8');
  assert.match(grants, /GRANT USAGE ON SCHEMA public, public_jobs TO interview_studio_runtime/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES/);
  assert.match(grants, /ALTER DEFAULT PRIVILEGES FOR ROLE interview_studio_migrator IN SCHEMA public_jobs/);
  assert.doesNotMatch(grants, /GRANT (?:ALL|CREATE).*interview_studio_runtime/);
});

test('Azure private-beta budget is conservative, bounded and owner-notified', async () => {
  const budget = await readFile('deploy/azure/resource-group-budget.bicep', 'utf8');
  assert.match(budget, /^targetScope = 'resourceGroup'$/m);
  assert.match(budget, /param monthlyAmount int = 200/);
  assert.match(budget, /category: 'Cost'/);
  assert.match(budget, /timeGrain: 'Monthly'/);
  for (const threshold of [50, 75, 90, 100]) {
    assert.match(budget, new RegExp(`threshold: ${threshold}`));
  }
  assert.equal(budget.match(/thresholdType: 'Actual'/g)?.length, 4);
  assert.equal(budget.match(/thresholdType: 'Forecasted'/g)?.length, 1);
  assert.equal(budget.match(/contactGroups: \[/g)?.length, 5);
  assert.doesNotMatch(budget, /subscriptions\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});
