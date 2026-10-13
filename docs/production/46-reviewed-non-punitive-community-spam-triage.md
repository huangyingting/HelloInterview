# 46 - Reviewed non-punitive community spam triage

**Status: implemented W11 engineering checkpoint; not an approved abuse policy,
automated enforcement system, user risk score, external notification, staffed
moderation service, managed community-writing authority or public-launch
approval.**

This checkpoint implements
[#39](https://github.com/huangyingting/HelloInterview/issues/39) under W11
[#12](https://github.com/huangyingting/HelloInterview/issues/12). Each newly
saved community report receives one bounded, deterministic spam suggestion.
Only authorized staff can see or review it. The suggestion cannot change the
reported contribution, report, account or any restriction.

No AI model, external classifier, credential or network service is used.

## Generation contract

Report creation remains:

```text
POST /api/community/reports
{
  "requestId": "<uuid>",
  "targetType": "post" | "comment",
  "targetId": "<exact live contribution>",
  "category": "spam" | "harassment" | "privacy" | "misinformation" | "other",
  "details": "<20-1,000 characters>"
}
```

Inside the same report transaction, a newly inserted report creates one
`community-spam-rules-v1` snapshot. Exact report-key replay returns the existing
report and does not create or replace triage evidence. Reports that existed
before migration 37 retain an explicit `null` staff triage field; queue reads
never fabricate or backfill evidence.

The classifier reads only:

- the exact reported post title, when present;
- the exact reported post/comment body;
- the reporter-selected category;
- the current post/comment content revision.

It does not read reporter/author identity, email, account history, prior
reports, mutes, blocks, restrictions, billing, learning activity, IP/network
data or private drafts.

The title, one newline and body are bounded to the first 20,000 JavaScript
string code units. The snapshot records whether truncation occurred. Its
SHA-256 input hash binds the algorithm version, report category, content
revision, bounded text and truncation flag. Raw contribution text is not copied
into the triage tables.

## Version-one signals and score

`community-spam-rules-v1` is intentionally small and inspectable:

| Evidence | Stored signal | Score |
| --- | --- | ---: |
| Each detected `http://`, `https://` or `www.` token, capped at three for scoring and 20 for storage | `multiple-links` when at least two occur | 15 each |
| Contact solicitation, an email-shaped token, or a configured off-platform messaging name | `contact-solicitation` | 20 |
| Configured promotion phrases such as “buy now”, “promo code”, “guaranteed income” or “investment opportunity” | `promotional-language` | 25 |
| Eight repeated characters or the same word repeated four times | `repetitive-content` | 20 |
| Reporter selected the spam category | no separate public signal | 10 |
| Source exceeded the 20,000-unit bound | `input-truncated` | 0 |

The score is capped at 100:

```text
0-29   -> unlikely-spam
30-59  -> uncertain
60-100 -> likely-spam
```

These labels are queue-ordering/review evidence, not factual determinations.
Version-one changes require a new algorithm version and forward migration or an
explicit new-snapshot contract. Existing evidence is never reinterpreted in
place.

## Staff review contract

The MFA/fresh `moderator` or `administrator` queue includes:

```text
triage: {
  algorithmVersion,
  classification,
  score,
  signals,
  contentRevision,
  state: "pending" | "reviewed",
  revision,
  outcome: null | "confirmed" | "rejected",
  createdAt,
  updatedAt
}
```

It excludes the input hash, raw classifier input and every account identifier.
Reporter history, public DTOs and owner privacy artifacts do not include this
staff-internal derived evidence.

Review uses:

```text
PATCH /api/staff/community/reports/:reportId/triage
{
  "revision": 0,
  "decision": "confirmed" | "rejected",
  "reason": "<20-500 characters>"
}
```

A moderator must first own the report assignment. An administrator can perform
the review without assignment. Exactly one pending revision-zero suggestion can
become reviewed revision one. Confirmation means the reviewer agrees that the
bounded suggestion is useful; rejection records a false positive or otherwise
unsupported suggestion.

Confirmation also requires the contribution's current content revision to
equal the snapshot revision. If the contribution was edited or removed, the UI
marks the suggestion stale and permits only rejection. The reviewer cannot
confirm old evidence while looking at newer text.

Neither decision:

- changes report assignment, state or revision;
- hides, restores, removes or edits the contribution;
- creates, extends or lifts a restriction;
- changes account/session authority;
- sends a notice;
- influences later moderation automatically.

A moderator must separately use the existing report action, target revision,
reason and evidence path for any moderation decision.

## Migration 37

Migration 37 adds:

- `community_spam_triage`: one report-keyed version/input hash/content revision,
  bounded fixed signals, score, classification, pending/reviewed state,
  confirmed/rejected outcome, one review revision and timestamps;
- `community_spam_triage_events`: immutable reviewer role/reference, decision,
  reason, exact prior/result revision and timestamp.

PostgreSQL and SQLite enforce:

- one snapshot per report;
- exact algorithm version and 64-character lowercase input hash;
- bounded score, link count, states and decisions;
- pending revision zero with no outcome on insert;
- one immutable-input transition to reviewed revision one with an outcome;
- event evidence referencing the resulting exact decision;
- no triage or event update/delete outside the allowed review transition.

Migrations 1-36 remain unchanged.

## Concurrency, failure and rollback

Staff review locks the report and triage snapshot. PostgreSQL uses row locks;
SQLite uses its serialized transaction boundary. Concurrent reviewers using
revision zero produce one saved decision and one explicit conflict. A stale
retry must reload the reviewed result and cannot overwrite it.

Report and triage insertion are atomic. If snapshot generation or storage
fails, the new report is not presented as saved. Exact report replay never
silently repairs missing pre-migration evidence.

Safe operational rollback disables or hides the triage review control while
preserving the tables. The existing report queue and human moderation actions
continue to work. Do not delete, rewrite or recompute published snapshots to
make a new algorithm look historically present.

## Observability and calibration

Operate this only with aggregate, access-controlled metrics:

- generated snapshots by algorithm version and classification;
- pending-review age and count;
- confirmed/rejected counts by version/classification;
- generation/review conflicts and failures.

Do not emit raw contribution/report text, input hashes, reviewer reasons,
account identifiers or per-member scores to general telemetry. Before changing
thresholds, sample reviewed false-positive/false-negative evidence under an
approved policy and publish a new version. The current implementation provides
no accuracy, recall or abuse-prevention guarantee.

## Evidence

The repository verifies:

- migration 37 upgrade preservation, indexes and both-adapter guards;
- deterministic bounded classification and exact input hashing;
- automatic one-per-new-report snapshots and explicit pre-migration absence;
- staff-only minimized DTOs with no member/privacy-export disclosure;
- assignment/role admission and exact revision-fenced review;
- competing-review serialization and immutable event evidence;
- unchanged report, target, restriction and account authority after review;
- managed browser review without an automatic moderation action;
- build/type safety and fixed eager/landing/sign-in graph ceilings.

## Still required

W11 remains open for:

- approved community abuse, appeal, legal retention and takedown policy;
- external author/reporter/restriction notices;
- moderation staffing, escalation ownership and published response targets;
- operated calibration, alerting and abuse-surge exercises;
- managed contribution writing or explicit read-only operating approval;
- complete privacy erasure and backup/processor handling;
- integrated load, accessibility, recovery and public-launch acceptance.
