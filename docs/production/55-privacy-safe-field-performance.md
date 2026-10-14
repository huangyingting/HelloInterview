# 55 - Privacy-safe field performance telemetry

**Status: implemented W12 instrumentation checkpoint; not operated field
evidence, a performance SLO or launch approval.**

This checkpoint implements
[#48](https://github.com/huangyingting/HelloInterview/issues/48). It adds a
default-off path for observing Core Web Vitals without sending raw addresses,
queries, opaque resource identifiers, account/session identifiers, answers,
code or arbitrary browser text.

## Configuration and client contract

`FIELD_METRICS_ENABLED=true` is required at server startup. The bootstrap
response exposes only `fieldMetrics: true`; it does not expose an ingestion
destination, retention setting or operator detail. Disabled deployments do not
register the metric endpoint and the browser installs no observers.

The compiled browser uses native buffered `PerformanceObserver` entries:

- LCP uses the final observed largest-contentful-paint start time;
- CLS sums layout shifts that did not follow recent input; and
- INP uses the interaction-duration percentile candidate across observed
  interaction IDs.

Observations flush on page hide through `sendBeacon`, with a bounded keepalive
request fallback. Delivery failure is non-blocking and visible only as a
generic browser warning; learning/account actions are never retried or delayed.

The client sends exactly four fields:

```json
{"metric":"LCP","value":2512.4,"screen":"practice","navigation":"navigate"}
```

`screen` is selected from a fixed product-area allowlist such as `practice`,
`community` or `account`. Unknown routes become `other`. The value is derived
from the browser entry; no rating, URL, query, referrer, user ID, session ID,
content ID or free text is accepted.

## Server boundary

The same-origin endpoint has a 2 KiB JSON limit, a strict no-extra-fields
schema and a bounded per-address admission limit of 60 observations per minute.
The address is used only as an in-memory rate-limit key and is not emitted.
The server rejects unsupported metrics, screens, navigation types, negative,
nonfinite or excessive values.

The server, not the browser, normalizes values and applies the standard
good/needs-improvement/poor thresholds:

- LCP: 2.5 seconds / 4 seconds;
- CLS: 0.1 / 0.25; and
- INP: 200 milliseconds / 500 milliseconds.

Accepted observations emit one structured `web_vital.observed` record containing
only event, metric, normalized value, rating, screen and navigation. This release
does not persist observations, attach request/account identifiers or provide a
dashboard. Existing request telemetry still records only route templates.

## Verification

Acceptance covers:

- default-off configuration and an unregistered disabled endpoint;
- strict invalid/extra-field rejection and server-side normalization;
- standard boundary ratings and finite value ceilings;
- rate limiting without logging the address;
- route classification that discards IDs and queries;
- compiled Chromium observation and exact four-field beacon payloads; and
- release-artifact checks for the observer, endpoint and absence of fixture
  secrets.

## Operating requirements and remaining work

An operator enabling this flag must route structured logs to an approved
low-cardinality metrics pipeline, assign retention/access controls and define
sample minimums, supported browsers/devices, alert ownership and rollback.
Aggregate by metric/rating/screen/navigation and release, not by user or raw
request. Do not add client-provided dimensions without a separate privacy and
cardinality review.

W12/W13 remain open for representative production traffic, sustained percentile
evidence, compression/cache-hit/asset-error telemetry, real-network and
multi-release testing, an approved SLO, broad accessibility/cross-platform
acceptance, reviewed product scope and launch approval.
