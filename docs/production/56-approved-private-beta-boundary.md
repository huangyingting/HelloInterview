# 56 - Approved invite-only private-beta boundary

**Status: approved W00/W03 decision checkpoint; not deployed-service,
recovery, legal/privacy, accessibility or launch acceptance.**

This checkpoint records
[#49](https://github.com/huangyingting/HelloInterview/issues/49). On
2026-10-14, maintainer and operating owner
[@huangyingting](https://github.com/huangyingting) approved the reduced MVP
scope and supplied the target hosting facts below. Approval makes these choices
authoritative for engineering; it does not manufacture evidence for work that
has not been performed.

## Approved product boundary

| Decision | Approved private-beta choice |
| --- | --- |
| Audience | Invite-only testers; not a public launch or paid cohort |
| Access | Free testing only; no live checkout, subscription or charge |
| Identity | Managed Auth0 email, Google and GitHub remain the selected account model; authentic tenant configuration/recovery evidence is still required |
| Existing data | Start with a clean database; do not import local/demo/runtime data |
| External AI | Managed external AI dispatch stays disabled; local study behavior and synthetic provider verification remain available |
| Community | Managed community writing stays read-only; do not imply staffed moderation |
| Content | Current curriculum may be evaluated in the invite-only beta; public licensing, marketing and final free/paid manifest approval remain separate |
| Expansion | Payments, public community writing, managed AI and public/paid launch stay outside this beta |

Production demo-plan, local-password, unrestricted gift and local community-write
authority must not become a public service merely because the VM exists.
`APP_MODE=service` now has a fail-closed engineering composition requiring full
managed identity lifecycle, HTTPS/proxy/request telemetry and private verified
email admission while rejecting billing, managed AI and legacy migration. See
[checkpoint 57](57-invite-only-service-runtime.md). No real tenant, invite
cohort or Azure guest deployment was configured by that code boundary.

## Approved hosting and ownership

| Item | Approved value |
| --- | --- |
| Provider | Microsoft Azure |
| Region | Southeast Asia |
| Existing VM | `WebStack` |
| Canonical published origin | `https://interview.genisisiq.com` |
| Database topology | PostgreSQL in the VM guest OS |
| Application budget ceiling | USD 200 per month |
| Deployment/on-call/support owner | `@huangyingting` |
| Content/accessibility reviewer | `@huangyingting` |

The Azure management plane was checked without printing addresses, subscription
identifiers or credentials. It confirmed that `WebStack` exists, is running and
is located in `southeastasia`. A later bounded guest inspection verified the
Caddy/PostgreSQL service topology without reading application secrets or
database contents.

The USD 200 value is an approved application ceiling, not proof of a matching
Azure resource-group budget, alert recipient or automatic shutdown policy.
Those controls require separate configuration and evidence. An unrelated
subscription-level budget is not accepted as this application's cost control.

## Explicit no-SLA and data-loss boundary

The owner stated that formal RPO/RTO targets are not required for this
invite-only test. Therefore this beta makes **no availability, durability,
recovery-time or maximum-data-loss promise**. This is not equivalent to proving
zero risk or completing backup acceptance.

The guest-OS database, application and VM form one failure domain. A VM, disk,
filesystem, database or operator failure can make the service unavailable and
can lose tester data. Testers must be told that their beta preparation data may
be reset or lost and must not rely on it as their only copy.

No backup may later be described as recoverable customer protection until its
encryption, retention, deletion behavior and isolated restore have been
operated and verified. If backups are intentionally absent, privacy notices and
support responses must say so rather than promising recovery.

## Assigned versus still required

The named owner is accountable for deployment, incident response, support,
content review, accessibility review and acceptance decisions for this beta.
The following facts/evidence are still required before inviting external
testers:

- the participant-facing privacy/controller identity, age eligibility and
  retention/deletion notice;
- the actual Auth0 tenant, email/Google/GitHub connections, callbacks,
  verification/reset delivery and recovery exercise;
- private secret injection and application-process composition on `WebStack`;
- a scoped Azure cost alert or an explicit manual spend-review procedure that
  demonstrates the USD 200 ceiling;
- guest PostgreSQL role separation, disk/volume ownership, startup/restart and
  capacity checks;
- an explicit no-migration initialization and database reset procedure;
- human curriculum/accessibility/browser review evidence, not merely assignment
  of the reviewer;
- deletion/export/support behavior under the approved no-SLA/no-backup
  boundary; and
- a small invite-only smoke cohort with recorded incidents and rollback.

Parent issues
[#1](https://github.com/huangyingting/HelloInterview/issues/1) and
[#4](https://github.com/huangyingting/HelloInterview/issues/4) remain open for
these factual and operated gates. Paid, managed-AI and managed-community
packages remain deferred, not falsely completed.
