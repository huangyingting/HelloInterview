# 47 - Bounded browser example runner

**Status: implemented W12 engineering checkpoint; not an authoritative judge,
reliable memory sandbox, remote execution service, independent security review,
accessibility approval or launch approval.**

This checkpoint implements
[#40](https://github.com/huangyingting/HelloInterview/issues/40). It preserves
the existing client-only synchronous JavaScript examples while adding explicit
request, result, structure and diagnostic limits. Submitted code is never sent
to the application server.

## Supported boundary

The runner is for visible examples attached to the learning content:

- one synchronous `solve(input)` JavaScript function;
- client-visible inputs and expected values;
- one opaque-origin sandboxed iframe per run;
- one blob worker inside that iframe;
- no iframe same-origin permission;
- a runner-specific CSP with `default-src 'none'`, `connect-src 'none'` and
  only the inline/eval/blob permissions required by this isolated runner;
- a two-second worker execution deadline;
- deterministic iframe, event-listener, timer, message-port, worker and object
  URL cleanup.

It does not provide hidden tests, server-side grading, multiple languages,
package imports, filesystem/process access, durable execution receipts or
remote container/microVM isolation. Passing examples is learning feedback, not
proof that a solution is generally correct.

## Exact limits

`src/sandbox.ts` exports one immutable limit object used by admission, worker
execution, result validation, tests and this contract:

| Dimension | Limit | Failure behavior |
| --- | ---: | --- |
| Submitted source | 40,000 JavaScript string code units | Reject before creating an iframe |
| Example count | 50 | Reject before creating an iframe |
| Example label | 1-200 string code units | Reject before creating an iframe |
| Serialized examples | 256 KiB UTF-8 | Reject before creating an iframe |
| Per-value serialized result | 64 KiB UTF-8 | Mark that example failed with a bounded error |
| Result structure depth | 20 | Mark that example failed |
| Result structure values/nodes | 10,000 | Mark that example failed |
| Combined result message | 256 KiB UTF-8 | Reject the run |
| Diagnostic text | 500 string code units | Truncate before crossing the worker boundary |
| Worker CPU deadline | 2,000 ms | Terminate the worker and reject the run |
| Parent response deadline | 6,000 ms | Remove the frame and reject the run |

The 40,000-unit source limit matches the largest exposed code editor. Project
files use the existing smaller 20,000-unit editor limit. Limits are product
guardrails, not a browser-process memory quota.

## Request admission

Before DOM or worker allocation, the parent:

1. checks the source, case count and every label;
2. JSON-serializes the exact visible cases;
3. rejects cyclic or otherwise non-JSON-compatible fixtures;
4. measures the serialized UTF-8 bytes;
5. sends only the admitted source and serialized cases to the opaque iframe.

Content fixtures remain repository-controlled. The runtime checks still fail
closed so a malformed future fixture cannot create an unbounded frame request.

## Worker result protocol

The iframe creates a `MessageChannel` and transfers one private reply port to
the worker. User code executes through `new Function` in the worker but never
receives that port. Calls to the worker-global `postMessage` therefore cannot
forge a passing result on the protocol consumed by the iframe.

The worker converts return values to a bounded JSON subset:

- `null`, booleans, strings and finite numbers are supported;
- non-finite numbers follow JSON behavior and become `null`;
- arrays and plain objects are traversed under the depth/node limits;
- top-level `undefined` remains the displayed `undefined` result;
- functions, symbols, bigints, class instances and other non-plain objects are
  rejected;
- circular references are rejected;
- oversized strings and serialized values are rejected.

The bounded representation is compared with the bounded expected
representation. Only bounded strings, booleans and optional bounded errors
cross the private reply port. Result arrays and records use prototypes that
cannot be changed by submitted code to override JSON serialization.

The parent then independently verifies:

- one result per admitted case, in the same order;
- the exact case label;
- boolean pass state;
- string actual/expected values within the per-value budget;
- only the allowlisted fields;
- optional diagnostic type and length;
- the complete response UTF-8 budget.

Invalid or oversized worker messages are errors, never success-shaped results.

## Cleanup and failure behavior

The iframe revokes the blob worker URL immediately after worker creation. One
settlement function clears the worker deadline, closes the reply port,
terminates the worker and publishes at most one token-bound response.

The parent accepts messages only from the current iframe window and only the
matching random run token. Its settlement removes the global message listener,
clears the response deadline and removes the iframe for success, worker error,
invalid output and timeout. Removing the frame also destroys any worker that
did not cooperate with an iframe-side callback.

The UI re-enables execution after every terminal outcome. A timed-out or
invalid run cannot leave a hidden runner frame attached or prevent a later
valid run.

## Network and memory limits

The opaque iframe has no same-origin capability and its CSP denies connections.
The nested blob worker inherits the isolated runner policy. Browser acceptance
executes submitted `fetch` code and verifies that no external request leaves
the application while ordinary synchronous results still return.

This is not a reliable memory sandbox. Submitted JavaScript can allocate memory
before returning, and browsers do not expose a portable per-worker heap limit.
The structural/output checks prevent large results from being deliberately
serialized back into the application, while the CPU deadline and frame
removal provide bounded cleanup in tested Chromium. They do not prove that
hostile allocation cannot destabilize a renderer.

If independent D10 review does not accept this residual browser-process risk
for the supported beta, disable the execution buttons and retain code editing,
downloads and non-executed reasoning workflows. Do not market stronger
isolation. A future authoritative runner requires a separate remote-execution
design and review.

## User-facing disclosure

Practice and project surfaces state that:

- examples are client-visible;
- execution is network-disabled and opaque-origin;
- there is a two-second CPU deadline and bounded result protocol;
- results are not authoritative grading;
- the browser is not a reliable memory sandbox;
- project imports and non-JavaScript languages are not executed.

These boundaries are displayed beside the action, not hidden only in policy
documentation.

## Verification

Automated evidence covers:

- valid repository reference solutions;
- infinite-loop termination and a successful run afterward;
- source, case-count and serialized-input admission;
- per-value, combined-result, depth and node limits;
- cyclic outputs;
- attempts to replace JSON prototype behavior or forge global worker messages;
- external network denial;
- exact result validation;
- zero retained runner iframes after success and failure;
- the same output, cycle, timeout, recovery, disclosure and network behavior
  against production-built assets.

## Still required

W12 and D10 remain open for:

- accountable frontend/security acceptance of the exposed runner or a decision
  to disable it;
- supported-browser/device and memory-pressure exercises beyond tested
  Chromium;
- broad screen-reader, contrast, touch, zoom, reduced-motion and IME review;
- reviewed curriculum/access/marketing scope and correction policy;
- field performance and operated multi-release asset retention;
- integrated provider, recovery, load and launch acceptance.
