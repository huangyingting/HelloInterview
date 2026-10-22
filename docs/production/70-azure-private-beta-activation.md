# Azure private-beta activation

**Status: activated on 2026-10-22** at
<https://interview.genisisiq.com>, on the approved existing Azure Southeast Asia
guest. This is an invite-only, free private beta, not a paid/public-production
launch or a claim of complete privacy, recovery or accessibility certification.

## Promoted release

| Evidence | Value |
| --- | --- |
| Application commit | `95d5bfa6a57e2969aeed467ca0e47a7d13124ce5` |
| Successful Application CI run | `39695236579` |
| Immutable CI artifact | `12391430972` |
| Artifact name | `compiled-release-95d5bfa6a57e2969aeed467ca0e47a7d13124ce5` |
| Downloaded ZIP SHA-256 | `dabb05c4480f9baf6bb7686c3f683e6b69fc5968d9a2d069215c49d9a8152153` |
| Runtime image ID | `sha256:a3ba4cf0f7ad554adabb14135d4e8d55319c8689367dd91a2257a70b3bba0262` |
| Application migrations | 42, with exact released checksums verified |
| Maintained queue count | 13 |

The application JavaScript was not rebuilt from source on the guest. The exact
successful CI ZIP was checksum-verified, its paths were restricted to the release
allowlist, and the runtime image was built with the reviewed
`deploy/azure-vm/Dockerfile.release`. Deployment tooling was fetched from the same
commit and checked against its local reviewed file hashes.

ZIP extraction under a private `umask 077` initially made the copied files
unreadable to the image's non-root user. The migration failed before changing
the database. Artifact directories were normalized to `0755` and files to
`0644`, then the image was rebuilt from the same verified bytes and UID 1000
read access was checked. Preserve non-root readability during future extraction;
do not apply those public artifact modes to private configuration or credentials.

## Activated boundary

- The Next.js application and privacy worker are enabled under systemd, with
  read-only, capability-dropped, resource-limited containers.
- The application listens only on `127.0.0.1:10006`. Existing shared Caddy
  configuration and sibling services were not changed.
- PostgreSQL runtime access has DML/queue authority, not superuser, role creation,
  database creation or schema creation authority.
- Registration requires an administrator invitation. Public signup is disabled;
  password-based invited registration does not require outbound email.
- Google/Facebook, outbound account mail, billing, managed AI, telemetry and
  community publishing remain disabled. No placeholder provider credentials
  were installed and no email was sent.
- The obsolete identity-worker unit was disabled and removed; its previous unit
  remains only in the private predeployment rollback snapshot.

The operator/controller is the approved owner, `huangyingting`; participants
must be at least 18, as in the deployment template. The privacy contact is the
application's signed-in `/support` flow, including its existing restricted-account
support access. It is not an unauthenticated contact channel or external helpdesk.
Requests and replies remain in-app, without email delivery or a response-time
promise.

The configured retention notice explicitly says records remain until reviewed
deletion completes and that physical erasure has no automated schedule. Deletion
has the implemented seven-day cooling-off period, with completion blocked pending
the required external/retention/recovery review; no completion date is promised.
The existing no-backup/no-RPO/no-RTO private-beta warning remains visible. These
bounded operational notices do not establish a jurisdiction-specific legal policy.

## Owner access and invitations

The real initial owner account was created by the compiled deployment CLI, not
through HTTP or a demo-data seed. Its login identifier is the authenticated
deployment owner's GitHub noreply alias, not a newly invented private inbox.
Outbound delivery to that identifier is not assumed.

The generated login identifier and password are stored **only on the VM** in:

```text
/etc/interview-studio/bootstrap-admin.credentials
```

That file and `runtime.env`, `service.env`, `migrate.env` and the database pgpass
files are root-owned and mode `0600`. Read the credentials only through private
administrator access to the VM; never copy them into repository files, issue
comments, chat, CI output or public logs.

1. Sign in at `/login`, then change the generated password in Account.
2. Enroll app-owned TOTP in Account before using the MFA-protected staff console.
   Invitation administration separately requires an active verified account and
   an unexpired administrator role; it is not the staff-session MFA gate.
3. Use `/admin/invitations` to create expiring, email-bound invitations. With mail
   disabled, share each returned acceptance link privately with its intended
   recipient; do not publish it.
4. Remove the bootstrap credential file after the owner has changed and safely
   retained the password. Keep session/MFA keys stable across releases.

The bootstrap administrator grant is time-limited, not permanent. Review and
renew authorized administration through the reviewed deployment/staff workflow
before its expiry. A real contact inbox and provider credentials can be
configured privately later; neither is fabricated for this deployment.

## Operated evidence

The existing database contained zero accounts and zero community posts. A
root-only configuration/unit snapshot and encrypted custom-format database dump
were taken before migration under:

```text
/var/backups/interview-studio/pre-95d5bfa/
```

Migrations 38-42 preserved the existing account/post counts and content-version
snapshot count. No authored training material was edited or removed.

Observed after activation:

- Public HTTPS, `/api/ready` and anonymous `/api/bootstrap` return HTTP 200.
- Bootstrap truthfully reports invitation-only password admission and the
  disabled optional services.
- The owner can sign in with secure HttpOnly session cookies. Anonymous
  administration is denied, invitation listing is role-authorized, and the
  staff-session endpoint rejects a session without enrolled/fresh TOTP.
- Application and privacy-worker restart succeeded; the same authenticated owner
  session remained valid and its preparation workspace stayed empty.
- The deployment smoke session was explicitly revoked. Final counts were one
  real owner, zero demo users, zero posts, zero invitations and zero sessions.
- A real Chromium browser loaded the landing, login, privacy, support, learning,
  introductory lesson and community pages without JavaScript/API failures. Both
  self-hosted fonts loaded, all seven disciplines appeared, and the landing
  reflowed at 320 CSS pixels.
- Both supervised containers remained healthy, enabled and active.
- The encrypted predeployment dump decrypted completely, matched its original
  archive listing and parsed through `pg_restore` without connecting to a
  database. This is not a claim of a live recovery rehearsal or a maintained,
  off-host backup service.

## Rollback and follow-on configuration

The previous operated state was a hardened HTTPS 503, not a serving compatible
Next.js release. If this release fails, stop and disable only the application and
privacy-worker units; the unchanged Caddy site returns its existing hardened 503.
Do not downgrade the schema or start an old incompatible image against migration
42. Restoring the predeployment snapshot would discard subsequent user data and
requires an explicitly reviewed maintenance/recovery decision.

Keep this one-time local recovery snapshot private; it does not replace an
off-host backup/retention policy. The USD 200 shared-host budget and existing
ingress were not expanded.

Authentic Google/Facebook acceptance, a verified email sender, externally
reachable privacy/recovery contact, complete physical erasure, independently
reviewed content/accessibility and any paid/public-production expansion remain
separate work. Do not enable those features merely because the private upstream
is now serving.
