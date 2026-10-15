# Auth.js TOTP MFA and recovery

**Status: implemented private-beta security checkpoint; authentic provider and
operator acceptance remain required before Azure cutover.**

This checkpoint makes the existing Auth.js staff freshness policy usable
without weakening social-provider authority. Google or Facebook still proves
the account identity. A Studio-owned TOTP authenticator provides a separate
MFA factor for privileged operations.

## Security boundary

- Enrollment requires an active account, session-bound CSRF and provider
  authentication from the last ten minutes.
- A random 160-bit TOTP secret is encrypted with AES-256-GCM. The account ID is
  authenticated as additional data, so ciphertext cannot be moved between
  owners.
- `AUTH_MFA_ENCRYPTION_KEY` is a stable, unpadded base64url 32-byte secret. It
  must be stored outside the repository and backed up with the deployment
  secrets. Generate it with:

  ```bash
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
  ```

- The authenticator uses standard SHA-1 TOTP, six digits and a 30-second
  period. Verification permits one adjacent time step for bounded clock skew.
- `last_used_step` prevents replay of an accepted authenticator code, including
  concurrent retries.
- Ten recovery codes contain 100 random bits each. Plaintext is returned only
  at enrollment or replacement; PostgreSQL stores keyed SHA-256 hashes.
- A recovery code is consumed atomically before the current session receives
  MFA evidence. Reuse fails with the same response as an invalid code.
- TOTP or recovery verification updates `mfa_at` only. It never refreshes
  provider-backed `authenticated_at`.

## Routes

```text
POST   /api/identity/mfa/enrollment
POST   /api/identity/mfa/enrollment/verify
POST   /api/identity/mfa/challenge
POST   /api/identity/mfa/recovery-codes
DELETE /api/identity/mfa
```

All mutations require the authenticated session's application CSRF proof and
consume the shared account-security admission bucket. Enrollment expires after
ten minutes. Replacing recovery codes and disabling MFA require both provider
authentication and MFA evidence from the last ten minutes.

The Account screen keeps the workflow inline: QR and manual setup key,
six-digit verification, one-time recovery-code display, session challenge,
replacement and disable. No modal or hidden fallback is used.

## Staff admission

Auth.js staff admission now requires all of:

- active account and verified contact;
- available linked provider identity;
- current account/session epoch and security cutoff;
- session age under 12 hours and activity within 30 minutes;
- provider authentication within ten minutes;
- session MFA verification within ten minutes;
- active app-owned TOTP credential;
- unexpired append-only role grant.

Neither a database `mfa_at` value without an active credential nor an active
credential without a recent challenge is sufficient.

## Recovery and key handling

Changing `AUTH_MFA_ENCRYPTION_KEY` makes existing TOTP ciphertext unavailable.
An unused recovery code still works because recovery hashes use the independent
`NEXTAUTH_SECRET`; the member can then disable and re-enroll TOTP after fresh
provider authentication. Operators must not rotate either secret casually.
A future formal keyring migration is required before routine encryption-key
rotation is offered.

Losing the authenticator and every recovery code does not authorize support to
bypass MFA or edit session evidence. Recovery must use an approved, audited
account-recovery policy before public launch.

## Acceptance evidence

Automated PostgreSQL coverage verifies encrypted-at-rest secrets, QR/manual URI
material, wrong-code rejection, accepted-step replay rejection, one-time
recovery consumption, recovery replacement, disable/re-enroll, session MFA
timestamps and denial of staff access when the active credential is absent.
