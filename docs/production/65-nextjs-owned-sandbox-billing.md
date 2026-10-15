# Next.js owned sandbox billing transport

**Status: implemented transport-migration checkpoint; sandbox only, with no
live commerce or Azure cutover approval.**

This checkpoint moves the existing owned Stripe sandbox HTTP surface from
Express to Next.js Route Handlers without changing financial authority.
The established checkout, canonical-ledger, funding, entitlement, cancellation,
resumption and Portal domain services remain authoritative.

## Migrated routes

```text
GET    /api/billing
POST   /api/billing/checkouts
POST   /api/billing/checkouts/:id/open
POST   /api/billing/checkouts/:id/refresh
POST   /api/billing/reconcile
POST   /api/billing/portal
POST   /api/billing/subscriptions/:id/cancel
POST   /api/billing/subscriptions/:id/resume
POST   /api/webhooks/stripe
```

Browser routes require an active Auth.js account. Every mutation additionally
requires session-bound CSRF, provider authentication from the last ten minutes
and admission through the shared account billing bucket. Session/account
authority is checked before and after the business transaction through the same
Prisma-backed `Database` adapter used by durable jobs and billing repositories.

IDs, provider customer references, prices, amounts, redirect URLs and service
authority remain server-owned. The browser can select only an allowlisted
reference offer and submit the documented UUID retry/predecessor evidence.

## Raw webhook boundary

The Stripe Route Handler:

- accepts only `application/json`;
- rejects compressed requests;
- reads at most 256 KiB while streaming;
- retains exact raw bytes for official SDK signature verification;
- rejects missing, malformed, duplicate-timestamp or stale signatures;
- validates own-account test-mode event snapshots against the pinned API
  version;
- atomically stores immutable notification evidence and its durable
  reconciliation operation before acknowledging.

Webhook delivery is not cookie authenticated and does not use browser CSRF.
No request body, signature, customer email or provider secret is logged.

## Portal and provider I/O

Restricted Portal preparation commits the owned one-minute scope first.
Provider reads and session creation run outside SQL transactions with a
30-second request bound. Account epoch, fresh authentication, owned customer,
captured configuration and policy evidence are rechecked immediately before
the provider mutation and before publication of the private hosted URL.

The Portal configuration remains limited to card-method updates and invoice
history. Portal return parameters do not prove payment, access or a successful
method update.

## Configuration

Next.js reuses the exact test-only parser used by the legacy runtime:

```text
STRIPE_TEST_ACCOUNT_ID
STRIPE_TEST_SECRET_KEY
STRIPE_TEST_WEBHOOK_SECRET
STRIPE_TEST_OFFERS
STRIPE_TEST_ACCESS_POLICY
STRIPE_TEST_PORTAL_CONFIGURATION
```

Live keys and unknown `STRIPE_*` settings fail closed. Billing requires the
complete Auth.js configuration, PostgreSQL and the canonical HTTPS
`NEXTAUTH_URL`. The bootstrap capability advertises only sandbox availability;
global commerce remains `disabled`.

## Worker authority

The separately supervised `billing:worker` and one-pass `billing:reconcile`
commands now open the same Prisma-backed `Database` adapter as the Route
Handlers. Provider calls remain outside SQL transactions. Claim completion,
ledger mutation, entitlement evidence and the pg-boss completion command share
one Prisma transaction client, so a worker cannot publish success independently
of its business mutation.

The controlled database and pg-boss schema migration entrypoint intentionally
retains the PostgreSQL driver because queue installation uses multi-statement
DDL. That exception does not grant runtime billing workers a second relational
authority.

## Remaining boundary

Authentic Stripe test-account evidence, deployment-unit migration, commercial
prices, tax and refund/grace policies, paid deletion, financial retention and
operated recovery remain launch gates. No Azure traffic switch is authorized by
this checkpoint.

## Acceptance evidence

Disposable PostgreSQL coverage verifies visitor capability disclosure,
authenticated owner views, CSRF denial, UUID retry replay, changed-offer
conflict, private pre-open denial, unavailable Portal behavior, compressed and
invalid webhook rejection, exact signed raw webhook ingestion and duplicate
event replay through the Prisma transaction adapter. Compiled worker death,
retry, reconciliation and canonical-ledger suites execute the maintained
billing CLI through that same adapter.
