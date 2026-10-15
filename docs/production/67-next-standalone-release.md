# Next.js standalone release

**Status: release and recovery checkpoint; the operated Azure upstream remains
disabled behind the canonical 503.**

The production application container now starts the Next.js standalone server,
not the Express bundle. Migration and worker commands remain separately compiled
Node entrypoints from the same reviewed source tree.

## Build and artifact boundary

`npm run build:release` performs two explicit builds:

1. `next build` with `output: 'standalone'`, Prisma Client generation and
   deterministic copying of `.next/static`, public media and allowlisted private
   media into `.next/standalone`;
2. `build:workers`, which compiles only migration, queue, billing, AI, staff,
   privacy, preflight and usage entrypoints into `dist-server`.

The release artifact contains only:

```text
.next/standalone/
dist-server/
package.json
package-lock.json
```

The standalone preparation step explicitly removes `.next/standalone/data`.
Next output tracing had copied the repository data directory because legacy
SQLite modules remain reachable elsewhere in the source tree. A release must
never rely on ignore rules alone to prevent local databases, test payloads or
other runtime data from entering the artifact.

## Runtime image

The root Dockerfile and `deploy/azure-vm/Dockerfile.release` both:

- use the digest-pinned Node 24 Bookworm slim image;
- install the OpenSSL runtime required by the generated Prisma engine;
- run as UID 1000 with a read-only-compatible filesystem;
- omit Vite, tsx, TypeScript, esbuild, Prisma CLI and source files;
- start `node server.js` from the standalone root;
- retain `dist-server` only for reviewed migration and worker commands;
- check `/api/ready` on the loopback application port.

The Compose staging runtime supplies PostgreSQL and the complete Auth.js
Google/Facebook/MFA configuration. It no longer enables local/demo application
authority.

## Container acceptance

`tests/container.test.ts` builds the exact root image and verifies:

- the application process is non-root and serves the Auth.js Next bootstrap;
- source, environment files, legacy `dist`, Vite entrypoints and traced `data`
  are absent;
- development/build tools are absent while migration/privacy worker entrypoints
  remain;
- a database-backed Auth.js session can save owned state through Next Route
  Handlers;
- application restart preserves the exact owned state;
- an authenticated PostgreSQL custom-format backup can be encrypted with
  AES-256-GCM, rejects tampering, restores into an isolated database and serves
  the same owned state through a second read-only Next container.

Queue installation still runs only through the controlled migration command.
Provider secrets are injected at runtime and are not present in either artifact
or image layers.

## Remaining cutover work

The source repository still contains the Vite/Express/React Router/SQLite
compatibility application and the legacy OIDC identity lifecycle worker. They
are no longer the release web process, but must still be deleted with their
tests, dependencies, configuration and systemd unit before the zero-legacy gate
passes. Authentic provider acceptance, preflight migration to Auth.js-only
configuration, exact-SHA Azure smoke/rollback evidence and Caddy cutover also
remain required.
