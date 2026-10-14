# Service launch preflight

Issue [#55](https://github.com/huangyingting/HelloInterview/issues/55) adds a no-side-effect exact-release preflight for the private-beta handoff.

## Command

The compiled command is:

```bash
npm run service:preflight
```

On `WebStack`, run the reviewed one-shot unit:

```bash
sudo systemctl start interview-studio-preflight.service
sudo journalctl -u interview-studio-preflight.service --no-pager -n 20
```

The unit is condition-gated on all three root-owned files:

- `/etc/interview-studio/release.env`;
- `/etc/interview-studio/runtime.env`;
- `/etc/interview-studio/service.env`.

It uses the exact promoted image, host networking for guest PostgreSQL, a read-only container filesystem, bounded tmpfs/CPU/memory/PIDs, no Linux capabilities and `no-new-privileges`. It does not start an HTTP listener.

## Verified scope

The command uses the same `loadConfig()` path as the application. Service mode must therefore satisfy the complete production, HTTPS/proxy, Auth0 lifecycle/invite and participant-policy contract before any database work occurs.

After configuration succeeds, the runtime database role:

- verifies all checksum-pinned application migrations;
- validates the installed maintained queues with the same immutable policy checks used immediately before normal queue startup, without starting pg-boss;
- reads only migration, operation and maintained-queue counts;
- closes the database connection.

Successful output is one compact JSON object containing only:

- service mode and loopback/port classification;
- trusted-proxy count;
- provider names, lifecycle presence and invite count;
- participant minimum age, contact protocol and no-durability acknowledgement;
- migration/queue counts;
- disabled AI/billing and read-only community state.

It never prints database URLs, issuer/management URLs, client IDs or secrets, invite addresses/hashes, controller/contact values, retention/deletion text, operation IDs or user records. Configuration errors may name the invalid setting and requirement but never echo its submitted value; other failures use one generic diagnostic.

## Boundary

The preflight proves local exact-release syntax and database/queue composition only. It does not contact or authenticate to Auth0, verify callbacks/connections/reset delivery, approve policy text, start the app/workers, admit a participant or prove public smoke behavior.

`service.env` remains absent and the unit remains condition-gated until the owner supplies the final private configuration. A successful preflight becomes required evidence immediately before enabling the three long-running services.
