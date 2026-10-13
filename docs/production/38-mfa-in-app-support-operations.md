# MFA-gated in-app support operations

**Status:** implemented as a bounded W10 checkpoint. This is an authenticated
in-app queue, not external helpdesk or email delivery.

## Delivered boundary

Migration 29 extends saved support receipts with:

- `open`, `pending` and `resolved` handling states;
- monotonic ticket revisions and update timestamps;
- optional staff assignment;
- append-only, UUID-keyed owner-visible replies;
- append-only staff assignment/status/reply evidence.

The original request email, body, creation time and owner retry binding remain
immutable. Owner deletion still retires the owner/replay key without allowing
email-based adoption.

## Staff authority

All support queue reads and mutations require the existing privileged staff
admission:

- active verified managed account;
- explicit OIDC `mfa` evidence;
- session created within twelve hours and used within thirty minutes;
- authentication and MFA within ten minutes;
- an unexpired `support-agent` or `administrator` role.

Queue DTOs include the support request body, masked contact, state, revision,
timestamps and whether assignment is `me`, `other` or unassigned. They expose
no owner ID, identity-provider record, preparation archive, billing record or
other private account data.

Support agents may claim unassigned tickets, mutate only tickets assigned to
themselves and release their own assignment. Administrators may perform
reviewed reassignment/state repair through the same revision boundary.
Anonymous requests can be triaged, but cannot receive an in-app reply because
no authenticated owner inbox exists and external delivery is not connected.

## API

```text
GET   /api/staff/support
PATCH /api/staff/support/:id
POST  /api/staff/support/:id/replies
```

Queue reads use a bounded twenty-ticket cursor. Assignment/status updates
require the exact current revision and a 20-500 character reason. One request
changes either assignment or status, never both.

Replies require:

```json
{
  "requestId": "staff-supplied-uuid",
  "revision": 1,
  "body": "Owner-visible reply"
}
```

The same actor/key/body returns the original reply after a lost response.
Changed bytes or another actor conflict. Publishing a reply assigns an
unassigned ticket to the actor, moves it to `pending`, advances the revision
and commits the immutable evidence atomically. A ticket is capped at fifty
in-app replies; exceeding the cap requires reviewed escalation rather than
silent truncation.

## Owner experience

`GET /api/support/requests` remains owner-only and paginated. Each receipt now
includes handling status and all bounded owner-visible replies. Replies are
labeled `Support team`; staff account IDs, roles, internal reasons and
assignment are never returned.

The Staff screen provides in-page queue loading, assignment, status and reply
controls. The owner Support screen displays in-app replies. Neither screen uses
a dialog or claims external delivery.

## Persistence invariants

- Staff mutations preserve the original request bytes and owner binding.
- Every state mutation increments exactly one ticket revision.
- Reply and staff-event rows reject update/delete.
- Lost reply retries never create duplicate owner-visible text.
- Staff action failure rolls back ticket state, reply and evidence together.
- Published migrations 1-28 remain unchanged.
- Comprehensive owner exports include handling state and replies but exclude
  staff identities and internal reasons.

## Verification

Automated coverage verifies MFA/role admission, masked queue DTOs, cursor
bounds, assignment ownership, stale revision rejection, exact reply replay,
owner visibility, staff-identity exclusion, immutable evidence, browser queue
operation and existing support admission/privacy behavior.

## Explicitly not delivered

No email or helpdesk provider, attachments, webhook delivery, provider retry,
automatic escalation, response-time SLA, staffed coverage schedule, approved
support retention period, impersonation, private preparation access or public
launch approval is provided. `delivery: not-connected` remains truthful for
external delivery even when an in-app reply exists.
