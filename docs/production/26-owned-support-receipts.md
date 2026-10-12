# 26 - Owned saved support requests

**Status: first W10 member-support checkpoint, not operated support delivery.**
Managed members can save and revisit their own private requests. Retry keys
prevent duplicate owned submissions after a lost success response. No staff
access, reply workflow, helpdesk, email sender or response-time promise is enabled.
Local support remains explicitly local-only.

## Release and schema

Apply controlled **migration 20 and maintained queue migration** using
`npm run db:migrate` before starting managed replicas. Published migrations 1-19
remain unchanged. The deployment must preserve application and queue data
together; this migration does not enqueue a provider operation.

Migration 20 expands the existing `support` system of record with nullable
`request_key` and `request_hash`. A partial owned uniqueness constraint makes
`(user_id,request_key)` unique. The pair must be absent together or present as a
bounded UUID/fingerprint on an owned request; SQL nullable-check loopholes cannot
create a half-keyed receipt. Owner-reference nulling retires both replay fields,
including when user deletion activates the existing foreign key.

Existing requests retain their IDs, owners, contact/text/timestamps and existing
delivery limitations. The migration invents neither a request key nor a sent/
triaged status for old rows. Old login/security/billing admission facts retain
their counters; only two isolated support scopes are added.

This is an expand-only application migration, not authorization for a live
customer cutover. Restore into the same controlled application schema. Startup
version/checksum checks still reject incompatible releases; do not downgrade a
published migration to run an older binary.

## Member API and authority

| Endpoint | Managed contract |
| --- | --- |
| `POST /api/support` with a signed-in member | Strict `key` UUID, contact `email` and `body`; returns an owned saved receipt |
| `POST /api/support` without a member session | Contact email/body only; returns an unowned reference and `delivery: not-connected`; cannot become an owned request by matching email |
| `GET /api/support/requests` | Current member's first ten requests, newest first, with an optional next cursor |
| `GET /api/support/requests?cursor=...` | Next bounded owned page; foreign/malformed/duplicate/unknown query authority is rejected |

The server derives ownership from the current managed session, never from a
submitted owner ID, contact address or ticket reference. New body objects are
strict: no caller-selected delivery, staff actor, status or owner fields.
Contact text is validated, trimmed and bounded; support bodies require 20-10,000
characters. NUL content is rejected before PostgreSQL writes.

The saved receipt contains only ID, contact/text/timestamp, `status: saved` and
`delivery: not-connected`. It exposes no session, scope, replay fingerprint,
provider secret, internal audit or another member's records. Receipts do not
verify a contact address, grant premium access or authorize external disclosure.

`SupportRequests` requires the **same Database adapter object** as
`ManagedIdentity`. Its commands receive the server's actual identity-context
object and check the current token, epoch, expiry and idle window under owner/
account/session locks before and after their SQL. A fabricated `User` object is
not an authenticated context.

Pending-verification, suspended and deletion-pending members may use this
**support-only** boundary if they still possess a valid unrevoked session.
They gain no product-write, export, billing or staff permission. Revoked sessions
cannot read history. An owned retry carrying a key after session loss returns
401 instead of silently creating an anonymous replacement.

The normal `assertWritable` security/freshness behavior remains unchanged.
There is no public lookup by ticket ID, anonymous history endpoint, staff
listing, member-accessible reply operation or impersonation path.

## Retry, concurrency and reads

The immutable request fingerprint covers the actual normalized owner/key/
contact/text. UUID letter case is normalized. Equal retries across API replicas
return the original receipt ID, bytes and timestamp without creating a duplicate.
Changed contact/text under that key returns 409 and preserves original content.
Changing the key intentionally represents a distinct request.

Receipt insert/readback and final current-session checks share a transaction.
Actual SQL followed by epoch/session changes or altered private text rolls back
the insert; no saved-success response is returned. The request's private bytes
are never copied into a native queue or arbitrary actor/reason field.

Owned history includes older owned requests without fabricating their retry
metadata. Keyset pagination uses descending timestamp and stable ID, including
equal-timestamp ties, and at most ten entries per response. Cursors contain only
the requesting owner and boundary; the SQL always independently scopes to the
current owner. Read consistency is per page, not a frozen multi-page export.

## Shared abuse admission

Managed support writes consume separate `support-network` and, when signed in,
`support-account` budgets. Each permits **30 attempts per shared 15-minute
window**, using the existing atomic PostgreSQL limiter. These are engineering
protection limits, not promised support service capacity.

Invalid submissions and retries consume admission; they do not mint another
ticket merely because a new attempt is counted. Account controls survive network
changes, replica/restart and concurrent pools. Trusted edge addresses are
canonicalized, including mapped IPv4/IPv6, and HMAC fingerprints are stored
instead of raw addresses or contact/text. Support cannot borrow login/security/
billing budgets.

A missing/unavailable shared limiter returns explicit 503 and stores no request;
there is no per-process fallback. Exhaustion returns 429 with bounded
`Retry-After`. Safe owner-history reads remain available when write admission is
exhausted or temporarily unavailable. General read-load/storage/edge controls
remain part of the wider operating and launch work.

## User experience and privacy

The managed Support screen says **Request saved**, displays the reference and
explicitly states that no external delivery occurred. Its private history labels
each entry **Saved - not delivered** and explains that this is not an actively
monitored queue. Errors remain visible with an inline reload action; no modal
or fake response-time/reply is introduced.

A form retains its key and draft on failure, including when the server committed
but the browser lost the success response. Starting another request creates a
new key. History loading is bounded/paginated, aborts stale requests, and account
changes remount private state so another member never inherits the prior
member's draft, confirmation or history.
After a failed attempt, members can refresh saved history and explicitly start
a separate request if needed; this keeps edited retry conflicts from trapping
the form without silently replacing the original receipt.

Anonymous contact cannot be claimed later by email equality. Local support
keeps its existing local-only form/response and does not require managed UUID
keys. No broad repository/preparation dump or automatic attachment is collected.

**Privacy deletion is not completed by this checkpoint.** Existing support
contact/text retention after user-reference nulling is unchanged; retiring
replay keys does not erase that private content. Approved retention, holds,
customer portability, processor/backup deletion and notices remain W10/D08.
Do not claim anonymity or fulfillment of a GDPR/privacy request.

## Evidence and remaining W10 work

`npm run test:support` exercises actual PostgreSQL/HTTPS member sessions,
replica replay, ownership/cursors/legacy history, restrictions, CSRF, known
write-limit outage/exhaustion, and actual insert rollback witnesses. Repeated
migration-19-to-20 upgrades preserve old support and admission rows/checksums.
The runtime-only release repeats a saved request after restart.

Real browser journeys verify pagination, a success response lost after the
actual server write, identical retry keys, pending-contact support, explicit
read-error recovery, narrow-screen layout and private-history clearing on
sign-out. Existing managed/local journeys and encrypted container recovery
remain release checks.

Next work needs explicitly provisioned MFA staff roles and audited narrow
ticket access, category/lifecycle/assignment/reply semantics, an approved
helpdesk/email system of record and authenticated delivery/bounce handling,
verified-contact disclosure rules, support permissions/retention, comprehensive
privacy export/deletion and operated escalation. No local saved receipt is proof
that a support team has received or acted on a request.
