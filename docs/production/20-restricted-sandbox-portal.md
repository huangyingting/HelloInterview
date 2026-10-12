# 20 - Restricted owned sandbox Customer Portal

**Status: private test-mode engineering checkpoint, not live billing approval.**
This adds fresh hosted card-method management and invoice history to W08. It
does not implement plan changes, renewal resumption, immediate invoice retries,
live checkout, commercial grace, paid deletion or operated payment recovery.

## Release and explicit configuration

Apply controlled **migration 14** with `npm run db:migrate` before starting this
release. Published migrations 1-13 remain unchanged. Migration 14 adds
`stripe_portal_access`: minimized preparation/issuance history linked to the
retained owned customer, captured owner/security epoch, selected configuration,
canonical origin, exact `sandbox-restricted-portal-v1` policy, coherent state/
timestamps and nullable unique provider-session ID and policy fingerprint.
There is no new maintained queue or delayed URL-delivery job.

Existing managed identity, PostgreSQL, canonical HTTPS origin, own-account test
credentials and pinned official Stripe SDK/API remain required. Portal is
**default-off**, independently of offers and sandbox service access:

```text
STRIPE_TEST_PORTAL_CONFIGURATION=bpc_OperatorRestrictedTestConfiguration
```

The setting must identify an explicitly selected test configuration. Empty,
default, boolean, payment-method IDs, URLs and unsupported Stripe settings fail
startup validation. The app never creates or modifies a provider configuration.
An operator must first review an owned test configuration and its explicit
payment-method policy. Do not enable the flag against an unrestricted default.
No provider configuration, account, real card or customer was provisioned for
this checkpoint.

Drain incompatible binaries before migration/policy enablement. Rollback must
preserve retained preparations and use a compatible release. Disabling this flag
stops **new app openings**, not already delivered provider links, notification
ingestion, owned cancellation, financial reconciliation or retained grants.
Removing `STRIPE_TEST_OFFERS` stops new Checkout reservations, not management of
an existing owned mapped customer. Existing service-policy continuity remains
mandatory whenever retained billing access evidence exists.

## Owned request and capability contract

```text
POST /api/billing/portal
Content-Type: application/json
X-CSRF-Token: current managed token

{}

200 { url: <fresh private hosted bearer URL> }
```

The authenticated active, contact-verified owner needs recent authentication
under the existing ten-minute window, CSRF and shared billing admission. The
body is strictly empty: customer, customer account, configuration, flow,
Connect scope, metadata and return destination are not client authority.
An unmapped account must first prepare its owned sandbox customer; the Portal
endpoint never creates a replacement customer or subscription.

`GET /api/billing` adds `portalEnabled`, meaning an operator configuration was
selected, **not** that a live provider policy has already passed inspection.
The owned DTO contains no Portal session ID, policy fingerprint, customer/
configuration references, contact fields or hosted URL. There is no GET to
recover a bearer URL, public Portal-login shortcut or URL stored in browser
storage. The opening response inherits private/no-store API headers.

Each deliberately admitted request creates a new UUID preparation and consumes
the shared billing attempt limit once. Concurrent replica requests can issue
different hosted sessions to the same owner; they do not create different
financial intents. This is intentionally unlike retry-safe Checkout and
cancellation: a new Portal session is not a new subscription/payment, and the
SDK cannot retrieve a previously issued secret. The browser neither stores a
Portal retry key nor automatically loops on an unknown opening.

## Transaction and provider boundaries

The interactive flow has three phases:

1. Under SQL owner/account/customer locks, verify current ownership and service
   configuration continuity, capture the security epoch and database clock,
   and commit a `requested` preparation.
2. Outside SQL, inspect the provider and create the scoped session with the
   preparation UUID as its single POST idempotency key. Immediately before that
   POST, a separate short SQL transaction rechecks the same owner, fresh
   session, customer mapping, epoch, configuration, origin and preparation age.
   Fresh proof is checked again after the guard, not only before it.
3. After final provider policy/customer reads, reacquire SQL authority and fresh
   session proof, verify provider creation time, and atomically record issuance.
   Recheck current authority and fresh proof after the write. Only a committed,
   non-aborted flow may return the URL; issuance is not proof of HTTP delivery.

SDK I/O never holds the admission/publication transaction or its owner locks.
Normal issuance uses exactly **eight SDK calls**, with an eight-call cap:
account, customer, Portal configuration, payment-method configuration, session
POST, final Portal configuration, final payment-method configuration and final
customer. Network retries are disabled and production SDK calls have the
existing three-second timeout. Request disconnect, process shutdown and a
30-second flow signal are checked between calls and before/after publication;
an in-flight SDK request may still finish within its own timeout.

The captured preparation must have nonnegative database-clock age strictly
less than **60 seconds** at each guard. Provider creation seconds must fall
between preparation time minus ten seconds and final database time plus ten
seconds, allowing bounded clock skew/second precision but refusing old session
responses. These are local admission bounds, **not a claimed provider expiry**.

The only provider mutation is:

```text
billingPortal.sessions.create({
  customer: ownedCapturedCustomer,
  configuration: explicitCapturedConfiguration,
  return_url: canonicalOrigin + "/billing?portal=returned"
}, { idempotencyKey: preparationUUID })
```

No email/profile/customer-account/Connect selector or caller-selected deep
link is sent. The response must independently match the owned customer,
selected configuration and exact return destination, be test mode, have no
Connect or customer-account scope and no unexpected flow, and use a recognized
Portal session ID. The supported destination is
`https://billing.stripe.com/p/session?secret=test_...`: exactly one query
parameter, no user-info, fragment, foreign host or live secret.

## Restricted provider policy

Both initial and final reads must establish:

| Boundary | Required policy |
| --- | --- |
| Account/customer | Configured own account; exact undeleted test customer with server-created ownership metadata |
| Portal configuration | Exact selected active test configuration; no Connect application |
| Invoice history | Enabled |
| Payment-method update | Enabled and tied to an explicit `pmc_...`, not a nullable/default selection |
| Customer/profile updates | Disabled, with an empty allowed-update list |
| Subscription changes/cancellation | Both disabled; owned cancellation remains the separately fenced app command |
| Shareable email-login page | Disabled, with no login URL |
| Payment-method configuration | Active own test configuration, no Connect application or inherited parent |
| Card | Available and resolved display preference `on` |
| Other rails | Explicitly unavailable/off or null; wallets, bank/debit/BNPL and future enabled families are rejected |
| Unknown policy shape | Unsupported feature families, malformed methods and unknown display values fail explicitly |

All returned method families are inspected rather than checking a finite wallet
blacklist. The object/method snapshot has explicit complexity/byte bounds.
The final feature configuration and normalized method snapshot must equal their
initial values. Disabled but changed policy shape is not silently substituted.
Only a hash of this policy evidence is retained, not a hosted response or
customer contact data. Policy checks are deliberately narrower than everything
the provider Portal supports.

These reads detect movement **during preparation**; they cannot freeze a
mutable provider configuration after URL delivery. Operator IAM, configuration
change monitoring and rules for retiring configurations with outstanding
sessions remain required before an operated launch.

## Unknown outcomes, lifecycle and privacy

| Retained state | Meaning |
| --- | --- |
| `requested` | Preparation committed; issuance did not commit. A provider session may be absent, failed, created but withheld, or externally successful with lost local publication |
| `issued` | Owned session/policy observation committed; does not prove browser receipt, Portal use, card update, payment, entitlement or provider expiry |

Actual initial SQL security changes roll back the preparation before provider
I/O. SQL failure, changed mapping/epoch/session/freshness, deletion, inconsistent
policy or aborted processing can withhold a URL after a provider session already
exists. The app does not convert those failures into success, use an earlier
secret, mutate financial records or claim the hosted session was revoked.

The pinned SDK exposes Portal session **creation only**, not retrieve/list/
revoke or an `expires_at` field. Do not invent those APIs or present a local
timer as provider expiry. An unknown HTTP response can be deliberately retried
as another bounded audited opening; the original row is never replaced or
reset. A lost successful response can leave two `issued` observations, not two
subscriptions. Provider credentials/session contacts and bearer URLs are not
included in audit rows, general billing DTOs or request/error logs.

Logging out, changing an app session epoch, disabling this flag or deleting an
owner cannot revoke a link already delivered by the provider. App deletion
retains the unowned customer/audit correlation and fences new dispatch/
publication; it does not complete financial privacy or paid cancellation.
Financial retention, authorized support access, authentic hosted-session
lifecycle and deletion composition remain W08/W10 launch gates.

## Hosted return, access and owned UI

The private billing page exposes an inline restricted Portal button only when
configured. It requires a mapped customer and fresh proof, explains deliberate
retry and the inability to revoke an already delivered link, and navigates
using only the newly prepared private response.

`?portal=returned`, payment/plan claims and provider-hosted UI messages are
untrusted navigation context. The page prompts an owned canonical ledger
refresh; it does not report a successful card update or optimistically grant
Pro. Existing maintained canonical reconciliation remains the source of
financial/service evidence. The payment-method flow updates the customer's
default method; a subscription-level default can take precedence. This
checkpoint does not claim a failed invoice was retried or settled.

Portal issuance leaves renewal flags, invoices, payments, grant source/hash/
interval/audit, independent permissions and owned premium archives unchanged.
Only subsequent independently verified eligible funding and service evidence
can authorize an interval under the separately configured sandbox policy.
Commercial billing, grace, refunds and recovery are still unapproved.

## Evidence and remaining work

The focused suite uses real PostgreSQL replicas, managed HTTPS/CSRF requests and
the pinned official SDK against a synthetic loopback provider. It covers
default-off/strict admission, foreign/unverified/stale owners, explicit policy
rejections, eight-call issuance, withdrawn offers, separate concurrent sessions,
policy/customer movement, bounded preparation, unknown publication, shared
rate admission and minimized audit/DTOs.

An SDK barrier updates the real owner row with a bounded SQL timeout, proving
network I/O does not hold SQL owner locks. Nontransactional sequence witnesses
prove preparation/issuance SQL actually executed before security/SQL rollback.
Fresh proof is also invalidated after the last pre-POST guard. Existing paid
grants, funding, renewal and mock archives remain unchanged. A compiled Node
entry verifies the managed default-off endpoint without development loaders.

Actual Chromium journeys use the compiled UI, fresh managed cookies and
CSRF-bearing requests, a synthetic hosted destination, forged return claims,
and a lost real accepted HTTP response followed by deliberate fresh opening.
They check independent audit rows, no replacement customer/Checkout, no
browser-stored secret, unchanged Free access and mobile layout.

This is not authentic Stripe-hosted Portal/test-clock/card recovery evidence.
Acknowledged owned resumption and repeat cycles are subsequently implemented in
[checkpoint 21](21-owned-sandbox-renewal-cycles.md), not enabled in the Portal.
Provider approval/configuration review, real sandbox evidence, ended-subscription
recheckout, approved commercial rules, historical partitioning, staffed
financial/privacy support, operated recovery and live-mode approval remain.
Public accounts, real charging and service launch remain gated.

Provider references:
[session object](https://docs.stripe.com/api/customer_portal/sessions/object),
[session creation](https://docs.stripe.com/api/customer_portal/sessions/create),
[Portal flows](https://docs.stripe.com/customer-management/portal-deep-links),
[payment-method configuration](https://docs.stripe.com/api/payment_method_configurations/object).
