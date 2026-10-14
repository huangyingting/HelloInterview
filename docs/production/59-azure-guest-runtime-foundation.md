# Azure guest runtime foundation

Issue [#52](https://github.com/huangyingting/HelloInterview/issues/52) establishes the database and supervised-process foundation on `WebStack`. It deliberately does **not** open the private beta: the app and workers remain disabled and condition-gated until authentic Auth0, invite and participant-policy configuration exists.

## Release authority

The VM must run the downloadable artifact produced by the successful CI run for the exact promoted commit. It must not rebuild application JavaScript from a mutable checkout.

1. Download the exact run artifact through an authenticated, short-lived GitHub artifact URL.
2. Verify the downloaded ZIP SHA-256 against the independently inspected promotion record.
3. Build `deploy/azure-vm/Dockerfile.release` with the artifact contents as the Docker context and `--build-arg RELEASE_SHA=<full commit>`.
4. Tag the local image `interview-studio:<full commit>` and write only these non-secret values to root-owned `/etc/interview-studio/release.env`:

   ```dotenv
   STUDIO_RELEASE=<full commit>
   STUDIO_IMAGE=interview-studio:<full commit>
   ```

5. Verify `org.opencontainers.image.revision`, `/app/package.json`, `/app/package-lock.json`, `dist/.vite/manifest.json`, and the complete `dist/` and `dist-server/` file hashes against the extracted artifact.

The release image installs only lockfile-pinned production dependencies on the digest-pinned Node image. It never contains source, development dependencies, a compiler or provider secrets.

## Database authority

Run `deploy/azure-vm/provision-database.sh` once as root. It:

- creates database `interview_studio`;
- creates a non-superuser `interview_studio_migrator` owner and an independent non-superuser `interview_studio_runtime` login;
- revokes public database/schema creation authority;
- generates independent 256-bit hexadecimal passwords without printing them;
- writes only root-owned mode `0600` connection and pgpass files under `/etc/interview-studio`.

The migration role owns schema changes but is never supplied to the app or workers. The runtime role receives `USAGE` plus table DML, sequence use, and function execution in `public` and the pg-boss `public_jobs` schema. `grant-runtime.sql` also establishes matching default privileges for future objects created by the migration role. It grants neither DDL nor role/database administration.

`interview-studio-migrate.service` runs the immutable application migrations and pg-boss installation with the migration connection, then applies the runtime grants through host `psql`. Released numbered migration SQL and recorded checksums remain immutable.

## Supervised processes

`deploy/azure-vm/install-runtime-units.sh` installs four reviewed units:

| Unit | Purpose | Startup |
|---|---|---|
| `interview-studio-migrate.service` | One-shot application and queue migration | Manual per promoted release |
| `interview-studio.service` | HTTPS-ingress upstream on `127.0.0.1:10006` | Disabled until launch approval |
| `interview-studio-identity-worker.service` | Identity reconciliation lifecycle | Disabled until launch approval |
| `interview-studio-privacy-worker.service` | Export/deletion lifecycle | Disabled until launch approval |

Every container uses the exact image named in `release.env`, host networking, a read-only root filesystem, bounded tmpfs storage, all Linux capabilities dropped, `no-new-privileges`, PID/CPU/memory limits and journald logs. Only the app binds a socket, and service configuration fixes it to loopback.

The three long-running units require all of:

- `/etc/interview-studio/release.env`;
- `/etc/interview-studio/runtime.env`;
- `/etc/interview-studio/service.env`.

`service.env` is intentionally absent at this checkpoint. Copying the example is not approval to start: real Auth0 tenant credentials, separate read-only Management API authority, hook secret, exact invited addresses, participant-facing privacy facts and callback verification must exist first. Stripe and AI variables remain absent.

## Verification and rollback

Before opening the beta, verify:

- all four unit files pass `systemd-analyze verify`;
- app and worker units are disabled and inactive;
- port `10006` has no listener and public HTTPS returns the hardened explicit `503`;
- database and roles exist with no superuser/create-role/create-database privileges;
- the migration unit succeeds and the runtime role can read migration state and perform `jobs status`;
- the runtime role cannot create a table or schema;
- configuration files are root-owned `0600`, while journal and process inspection expose no connection URLs or provider secrets.

Rollback before launch is to leave the long-running units disabled, retain the exact image/database for investigation, and keep Caddy's explicit `503`. After launch, rollback means stop/disable the three services, restore the prior exact release tag and run only forward-compatible controlled migrations; never edit migration history or expose local mode.

This checkpoint does not prove application operation, authentic identity, participant notice, backup durability, recovery targets, spend controls, accessibility review or invite-cohort acceptance. Those gates remain open.
