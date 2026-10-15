# Managed AI native worker

**Status: participant admission and internal provider-publication checkpoint;
no authentic Azure traffic or public private-beta enablement.**

This checkpoint connects participant-facing Next.js admission, existing owned
input snapshots, the usage ledger and pinned `ai.evaluate` jobs to a separately
invoked Prisma-backed worker. It does not make the browser an AI authority and
does not change the public private-beta 503 boundary.

## Immutable configuration

Managed execution is all-or-nothing. `MANAGED_AI_ENABLED=true` requires:

```text
AZURE_OPENAI_API_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_DEPLOYMENT
AZURE_OPENAI_API_VERSION
MANAGED_AI_MODEL_REVISION
MANAGED_AI_INPUT_PRICE_MICROS_PER_MILLION_TOKENS
MANAGED_AI_OUTPUT_PRICE_MICROS_PER_MILLION_TOKENS
MANAGED_AI_DATA_USE_NOTICE
```

The model revision prevents an operator from silently reinterpreting retained
input after changing an Azure deployment. Token prices are explicit integer
micro-dollars per one million provider-reported tokens; there is no zero-cost or
unknown-model default. The public data-use notice is required but never includes
a key, endpoint credential, learner input or private evidence.

The reviewed private-beta manifest is versioned in code:

- 100 weighted units per original paid calendar month;
- weights of 1 tutor, 2 feedback, 2 mock and 3 project units;
- USD 2 daily and USD 20 monthly provider-cost ceilings;
- two global and one per-owner unresolved calls;
- a five-minute original queue-admission window;
- at most 32,768 exact UTF-8 input bytes and 1,200 completion tokens.

The captured ceiling prices up to 65,536 input tokens, twice the exact byte
limit, so provider/chat framing does not depend on an optimistic bytes-to-token
conversion. Actual settlement uses the provider's prompt and completion token
counts under the configured prices. A result above its captured ceiling is not
published and becomes reconciliation-required.

## Dispatch and publication

Run one pass or a supervised worker from the compiled release:

```bash
npm run ai:process
npm run ai:worker
```

The worker opens `SandboxUsage`, `SandboxInputs` and `DurableJobs` with one exact
Prisma-backed `Database` adapter. A claim must retain its original reservation,
snapshot, operation, job ID, generation and queue lease.

For a fresh held intent:

1. Revalidate the current owner, security epoch, Pro access, original source
   revision, full source fingerprint, cost windows and queue deadline.
2. Commit the `dispatched` accounting state before provider I/O.
3. Send only the captured prompt and minimized saved-input envelope to the
   pinned Azure deployment outside every SQL transaction.
4. Validate exact JSON output and bounded provider token usage.
5. In one Prisma transaction, recheck the current claim and authority, publish
   feedback/tutor output to the unchanged saved record, settle units and measured
   cost, complete the pg-boss attempt and store the minimized operation receipt.

The provider request uses `api-key`, the deployment chat-completions route,
the pinned `api-version` and `max_completion_tokens`. It never emits the key,
raw private input or provider body to normal logs.

## Failure semantics

- Saved input changed before dispatch: cancel the original native job and
  release its held unit/cost reservations at known zero provider cost.
- Provider outage, timeout, malformed response, missing cost evidence,
  publication failure or worker loss after dispatch: retain the reservation as
  `unknown`, fail the claim as reconciliation-required and do not publish a
  result.
- A replacement worker that observes `dispatched` never calls Azure again. It
  converts the ambiguous attempt to `unknown`, preventing duplicate external
  effects.
- Generic AI workers and generic replay remain denied for bound native intents.
  This operation-specific worker is the only dispatch/publication authority.

Elapsed time, an expired lease or absence of feedback is never proof of zero
provider cost. Unknown outcomes retain concurrency, allowance and spend holds
until a future reviewed reconciliation path supplies provider evidence.

## Published result boundaries

Feedback, mock and project outputs are strict score/strength/improvement/summary
objects. Tutor output is one bounded text field. Publication re-locks the exact
saved attempt, mock turn, project revision or tutor question and refuses to
overwrite newer work. Model output never grants access, changes billing, claims
code execution or makes a hiring prediction.

## Participant admission and status

Practice feedback, mock responses and project reviews use owned Next.js Route
Handlers. Managed admission requires:

- an active Auth.js database session and current `pro-v1` grant;
- exact session-bound CSRF for enqueue and cancellation;
- a fresh UUID request key, the exact saved source revision and literal
  `sandbox-ai-usage-v1` consent;
- an explicitly checked inline data-use notice before browser submission;
- the account-scoped `ai` abuse budget introduced by migration 40.

Admission first saves the participant's work, then atomically captures the
private input snapshot, reserves usage and cost capacity, creates the durable
operation and binds its zero-retry pg-boss job. HTTP 202 means only `queued`.
The browser polls the owner-only `/api/ai/operations/[id]` resource and treats
`queued`, `running`, `completed`, `cancelled`, `unknown` and `failed` as distinct
states. Status reads do not consume admission capacity. Completed receipts
expose only the saved source ID and resulting revision; prompts, provider bodies,
cost evidence and native job metadata remain private.

Participants may cancel only a known-undispatched owned intent. Owner lookup
precedes native operation lookup so foreign and missing IDs both return the same
not-found boundary. The original attempt, mock draft or project revision remains
saved when admission, polling, provider execution or publication fails.

When managed AI is absent, the same routes preserve the existing local rubric
behavior. Tutor admission remains local until its user question can be saved and
idempotently bound before provider dispatch.

## Remaining work

The browser currently performs bounded foreground polling but does not yet show
an account-level operation history after navigation or a participant
cancellation control. Authentic Azure execution, quality measurement, operator
reconciliation, alerts/circuit breakers, deployment units and privacy-retention
acceptance remain launch gates.
