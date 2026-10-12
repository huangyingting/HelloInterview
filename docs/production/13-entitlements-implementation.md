# 13 - Managed entitlement implementation and operating boundary

**Status: private engineering checkpoint, not paid-service approval.** This
implements W06 against the published identity, content and maintained-job
boundaries. It does not provision a provider, charge a customer, approve an offer,
expose staff authority, or satisfy the remaining identity/launch gates.

## Authority and migration

Apply the controlled `npm run db:migrate` command using the migration role before
starting this release. Migration **7** adds source grants, terminal revocations,
owned audit events and account-deletion retirement. Released migrations 1-6 are
unchanged. Startup rejects a missing/incompatible schema and rejects a switch to
unconfigured local authentication while grant or revocation authority exists.
Do not bypass checksums or remove authority rows to downgrade a release.

`server/entitlements` is a trusted internal domain, not an HTTP administrative
API. `issue()` requires a managed UUID owner, globally unique `(kind,key)` source,
versioned policy, finite millisecond UTC service interval and opaque actor/reason
evidence. Owner then source locking serializes replicas. The full normalized
request, including evidence, is fingerprinted: identical replay returns the same
grant; changing owner, policy, interval or evidence conflicts. First issuance
and its audit commit together. Grants are not extended or edited in place;
another independently verified service interval needs a new source key.

`revoke()` persists a terminal source tombstone, including when issuance has not
yet arrived. Duplicate revocation preserves the first audit. Later issuance or
replay cannot reactivate that source. Independent sources union permissions;
revoking one does not cancel an unrelated grant. Before deleting a user, the
database atomically retires every known grant source; owned grants/audit then
cascade, but minimized source/owner tombstones remain and cannot be reassigned.
Unknown later billing facts still require W08's deleted-customer correlation
policy; this trigger is not a substitute for that mapping.

Source kinds are billing, support, promotion and engineering. Engineering grants
are limited to one day; other intervals to 400 days. These are defensive bounds,
**not** approved prices, duration promises, credits or lifetime offers. No public
endpoint or operator CLI issues grants. W08 must establish verified provider
facts and customer/interval ownership before calling the domain. W10 must supply
staff RBAC, fresh MFA, scoped approvals and audit before offering courtesy tools.
Neither a source kind string nor the domain audit proves that a payment settled.

## Versioned policy and request matrix

Eligibility requires the current account to be active with a verified contact.
Current time comes from PostgreSQL after reading authority. Intervals are
half-open: `startsAt <= now < endsAt`. Scheduled, expired, revoked, restricted
and missing grants do not authorize new paid work.

| Capability | Free verified owner | `premium-read-v1` | `pro-v1` |
| --- | --- | --- | --- |
| Own archive read/export; free preparation | Yes | Yes | Yes |
| Current premium lessons, briefs, references, private media/ranges | No | Yes | Yes |
| Premium reading completion, enrollment, video progress, certificate issuance | No | No | Yes |
| New/continued premium ordinary practice and evaluation | No | No | Yes |
| Mock creation, drafts and responses | No | No | Yes |
| Custom quiz creation, answers and finalization | No | No | Yes |
| Study-plan creation and reflections | No | No | Yes |
| Project creation, saves and review | No | No | Yes |
| Paid lesson retrieval in the local study helper | No | No | Yes |
| External AI consumption | No | No | No |

Active account restrictions override every grant, including free archive access.
Bookmarking discovery metadata, free exercises and ordinary free quizzes remain
free. Removing an existing reading mark remains an archive-management action;
adding premium completion requires premium write permission.

Every paid mutation checks authorization before work and again before and after
actual domain SQL, inside the owner transaction. Expiry during publication rolls
back the write. Provider eligibility is checked before dispatch and atomic
receipt publication. Managed AI queue admission/dispatch/publication is denied
until W09 supplies consent, reservation/settlement, budgets and provider policy.
System principals cannot borrow user AI authority. Non-user billing/security
jobs retain their separate internal principal boundary.

Managed mode does not register local signup, demo-plan, gift or local-password
handlers. `UserState.plan`, imported legacy plans, client payloads, gift codes and
eventual checkout return URLs confer no managed permission. Local mode retains
its existing demo policy; local expired custom-question reads remain gated.

## Saved work and licensed snapshots

Paid expiry/revocation does not erase owned answers, drafts, reports, files,
patches, study plans, issued certificates or historical exports. It does not
authorize fresh library content, new grading or continued premium editing.
Local unsaved editor changes remain exportable, explicitly labeled as not stored
on the server; expiration does not silently replace them with an older draft.
Managed custom quizzes can read their owned pinned next prompt without receiving
an unanswered key; new answers/finalization still require current permission.
The preparation export includes minimized current access, not private grant
evidence or a complete privacy-request export.

New projects pin the original safe task brief and a SHA-256 content version.
Only requirements, starter and example checks are retained, not private rubric
keywords or worked solutions. Hashing reuses the bounded canonical JSON codec
so PostgreSQL JSONB key order cannot change the version. Owned expired readers
receive that licensed snapshot even if the current library changes or disappears.
A legacy project without a snapshot requires current content permission for a
premium live brief; otherwise it returns an explicit legacy diagnostic. Its
owned files, feedback and patch remain available in the UI/export. A corrupt
snapshot fails explicitly rather than silently substituting current content.

## Client contract and expiry

Bootstrap and managed-only `GET /api/entitlements` expose the caller's minimized
`AccessView`: effective decisions/reasons/deadlines, database observation time,
next scheduled boundary and at most 50 source descriptors. All sources determine
policy even when displayed history is truncated. Source keys, request hashes,
provider objects, actor evidence and reasons are not returned.

Client capability hints use the server observation plus monotonic elapsed time,
not the browser wall clock. Scheduled boundaries and focus/visibility restoration
refresh bootstrap; content loaders key on effective policy, not demo plan state.
Failed refreshes surface an error and conservatively disable paid hints while
preserving the saved archive. UI controls distinguish read-only content from
writing; every direct API request remains independently authorized.

There is no notification push channel for arbitrary revocation while a page stays
focused. Such a page refreshes on its scheduled boundary/focus or explicit reload;
the server nevertheless denies the next unauthorized request immediately.

## Evidence and remaining gates

`npm run test:entitlements` requires a dedicated `TEST_DATABASE_URL`. It exercises
real TLS identity and PostgreSQL replicas, concurrent immutable issuance,
pre-issuance revocation, source ownership/deletion, independent permissions,
restrictions, history truncation, the route matrix, licensed historical briefs,
and actual post-write expiry rollback. Maintained workers demonstrate admission,
dispatch and final-result fences. Unit cases test exclusive client deadlines.
The HTTPS Chromium suite covers read-only controls, Pro expiry with a one-year
wall-clock skew, visible refresh failures and retained drafts. Runtime-only
release evidence covers grants across restart and immediate revocation.

Operate only synthetic/private rehearsal until W04 recovery/delivery, W08 billing,
W09 usage budgets, W10 staff/privacy controls, W12 reviewed content/offer manifests,
and approved hosting, legal/retention and launch evidence are complete.
Tombstones are pseudonymous security/billing authority, not automatically
anonymous data. Approved retention, purpose, deletion exceptions and operated
cleanup remain required; no automatic pruning or undocumented fallback is used.
