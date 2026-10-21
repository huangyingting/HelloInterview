# Editorial product workspace

## Product and data boundary

The interface is a personal preparation workspace, not a simulated account.
The landing page prioritizes learning discovery; the signed-in overview leads
with one next action, followed by actual progress, learning paths and interview
targets. Unfinished drafts take priority over enrolled course steps and lessons.
No fictional learning activity, testimonials, community posts, billing prices
or trial entitlements are added for display.

Training materials remain unchanged: authored lessons, exercise briefs, worked
solutions, quizzes, courses, media and version-pinned assessment snapshots are
not deleted or rewritten by this change. Educational examples and practice
fixtures are training content, not user-level demo data.

Migration **42, `remove-user-demonstration-data`**, removes only explicitly
marked records: users with `demo=1`, posts with `sample=1`, dependent discussions
and demo-owned support/legacy gifts. PostgreSQL ownership cascades remove
demo-owned state and sessions. It does not infer demonstration accounts from
names, addresses, activity or account age. Unmarked user accounts and their
state remain intact. The preflight rejects residual demo-marked accounts/posts.

Before deploying, inspect counts of these exact markers and rehearse migration
42 against an authorized backup. If historical demo accounts have protected
immutable audit or staff references, foreign-key safeguards may reject deletion;
resolve those references under a reviewed retention decision. Do not disable
audit triggers or broaden the cleanup to all users. Apply the compiled
`npm run db:migrate` command; startup only verifies released migration checksums.
No live/customer database cleanup has been performed by the implementation.

## Visual architecture

The design uses warm paper, charcoal navigation, terracotta emphasis, restrained
rules and numbered disciplines rather than generic promotional gradients.
The strongest visual element on a member screen is the next preparation action.
The shell, learning/practice readers, community, account, membership and
support controls share the same tokens and typography. Dark mode, keyboard
focus, 44px coarse-pointer controls, reduced motion and forced colors remain
supported; this is not a claim of complete WCAG certification.

As on `genisisiq.com`, primary typography is **Mona Sans** with **JetBrains Mono**
for small editorial labels and code. Noto Sans SC is the system CJK fallback.
Fonts are self-hosted under `public/fonts/`; no runtime third-party font
request or credential is required. The Mona Sans font is distributed by
GitHub's site and JetBrains Mono by its official repository. Their SIL Open
Font License notices are shipped alongside the assets.

## Actual account admission

Auth.js still requires a canonical origin, high-entropy `NEXTAUTH_SECRET` and
the app-owned MFA encryption key. Google and Facebook credential pairs are now
independently optional; an absent or completely empty pair disables that
provider. A partial/invalid pair fails configuration. Bootstrap advertises only
configured providers. Google can admit an invited verified identity; Facebook
remains link-only. Neither email matching nor a client flag merges accounts.

Password-only invitation deployments need no OAuth credentials or static
`AUTH_INVITED_EMAILS` list. The administrator is provisioned exclusively through
the **compiled deployment CLI**, never an HTTP bootstrap endpoint:

```bash
npm run build
npm run db:migrate
npm run bootstrap:admin -- --email admin@example.com --password-stdin
```

Provide the password through private stdin; do not put it into shell history.
The runtime-only artifact includes `dist-server/bootstrap-admin.js` and requires
neither TypeScript sources nor tsx. The administrator can create expiring
invitation links in `/admin/invitations`. Staff operations continue to require
fresh authentication, enrolled TOTP and expiring authorized roles.

Password accounts can reconfirm via Account → Confirm with password. This
uses normal credential authentication for the current account, creates a new
session and returns to Account; sensitive endpoints independently check
server-clock freshness and MFA where required.

## Account email delivery

Account mail uses the existing encrypted PostgreSQL outbox. Queuing returns
`queued`, not `sent`. Enable sending only after configuring a verified Resend
sender and its private API key:

```text
ACCOUNT_MAIL_WORKFLOW_ENABLED=true
RESEND_API_KEY=<private provider credential>
ACCOUNT_MAIL_FROM=Interview Studio <verified-sender@example.com>
```

Run `npm run account-mail:worker`, or enable the separately installed
`interview-studio-account-mail-worker.service` after the exact-release migration
and preflight. Installation does not start or enable it. A bounded one-off pass
is available as `npm run account-mail:process` (at most 25 queued messages).
The optional external claim/ack HTTP protocol additionally needs the private
`ACCOUNT_MAIL_WORKER_SECRET`; the packaged sender does not use that API.

Each dispatch has a fixed Resend endpoint, 15-second timeout, a stable outbox-ID
idempotency key and a leased compare-and-swap acknowledgement. Only a successful
provider acceptance receipt marks `sent`; this is acceptance by the provider,
not proof of arrival in the recipient inbox. Known rejection becomes `failed`.
Network/timeout/server ambiguity or a missing receipt becomes `unconfirmed`.
Neither ambiguous nor failed messages are silently retried. Reconcile the
private outbox ID in Resend before issuing another invitation/reset link.
Worker logs contain only IDs and outcomes, never recipients, tokens, message
payloads, provider responses or API keys.

No real mail was sent during automated acceptance. Verified-domain setup,
deliverability/bounce monitoring, authentic recovery acceptance and worker
supervision are operator launch gates. This sender handles account emails,
not support-ticket delivery or marketing email.

## Publishing and commercial boundaries

Community publishing defaults off. `COMMUNITY_WRITES_ENABLED=true` enables
posts, comments, retry-safe submissions, edits, votes and follows with existing
account/restriction/rate-limit checks. It must be enabled only with moderation
staffing and policy approval. Read-only mode still permits private safety and
reporting workflows, receipts/history and removal of owned contributions.

The membership screen describes real account capabilities without fabricated
pricing, active subscriptions or purchase buttons. Existing sandbox billing
is linked only when actually configured. This change does not enable live
Stripe charges, grant premium access from a demo plan, approve a privacy-erasure
process, invent backups/RPO/RTO, or promote Azure ingress.

## Acceptance and release

Unit coverage verifies next-step priority, truthful configuration and bounded
provider outcome handling. PostgreSQL integration rehearses migration 42 from
the previous schema and compares original content snapshots and real user state
byte-for-byte. Next Route Handler coverage checks every publishing gate and
owner deletions while paused.

After `npm run build`, Playwright launches the **standalone production build**
against its own randomly named PostgreSQL schema. Only this isolated fixture
creates explicit synthetic accounts, using the real CLI/invitation/password
services. Browser acceptance covers empty state, genuine password sign-in,
target persistence/removal, lesson completion, password confirmation, sign-out,
fonts, desktop/mobile reflow, themes, text spacing and keyboard navigation.
Set `TEST_BROWSER_PORT` to a free unprivileged port on a shared host; tests
never terminate or reuse unrelated listeners.

The release container additionally verifies that fonts and the compiled
bootstrap/mail entrypoints are present without development tooling. Authentic
provider configuration, exact-artifact Azure deployment, HTTPS smoke/rollback
and the approved private-beta operating boundary remain deployment requirements.
