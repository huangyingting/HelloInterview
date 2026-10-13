# 53 - Retained frontend assets

**Status: implemented W12 runtime checkpoint; not operated CDN/load-balancer,
retention-duration, multi-replica rollout, field-performance or launch
approval.**

This checkpoint implements
[#46](https://github.com/huangyingting/HelloInterview/issues/46). It gives the
production runtime a bounded way to serve current HTML and assets while also
retaining explicitly mounted prior hashed assets for already-open tabs.

## Runtime contract

`RETAINED_FRONTEND_DIRS` is an optional platform-path-delimiter-separated list
of prior release directories. Relative entries resolve from the application
root. Entries must be distinct and cannot name the current `dist` directory.
Production startup fails if any configured `<release>/assets` directory is
missing or is not a directory.

The serving order is:

1. current `dist/assets`;
2. each configured prior `<release>/assets` directory in declared order;
3. an explicit plain-text 404 for an unavailable `/assets/*` request.

Only the `assets` subtree is exposed from prior releases. Old `index.html`,
server code, package metadata and arbitrary release files are never served.
Current HTML remains authoritative, and a retained filename collision cannot
override the current asset.

Current and retained assets receive one-year immutable cache policy. Missing
assets no longer fall through to current SPA HTML, preventing a JavaScript
request from receiving a success-shaped HTML document.

## Deployment composition

An operator can mount releases such as:

```sh
RETAINED_FRONTEND_DIRS=/releases/previous:/releases/older
```

Use the host platform path delimiter (`:` on Linux/macOS, `;` on Windows).
Promote current `dist` atomically with its server artifact, then retain prior
release directories for the approved old-tab window. All serving replicas or
the approved edge must expose the same retained set; one local replica is not
an availability guarantee.

Remove a retained release only after the approved window and telemetry/release
procedure establish that its chunks are no longer required. Rollback must
restore matching HTML and assets rather than combining arbitrary releases.

## Verification

Runtime acceptance verifies:

- hashed current assets receive immutable caching;
- a synthetic prior hashed chunk is delivered byte-for-byte;
- current assets win an exact filename collision;
- missing assets return a plain-text 404 rather than SPA HTML;
- malformed asset addresses retain the JSON error boundary; and
- missing retained directories fail production startup.

Release verification must also preserve archive allowlisting, exact package
provenance, manifest closure and fixed entry/landing/authentication graph
ceilings.

## Still required

W12/W13 and launch acceptance remain open for:

- an approved retention duration and storage/cost owner;
- actual CDN/load-balancer/object-storage configuration and cache invalidation;
- multi-replica rolling release and rollback rehearsal;
- field Core Web Vitals, compression, cache-hit and asset-error telemetry;
- supported-browser old-tab/new-release journeys under real network failure;
- alert ownership, runbooks and sustained operated evidence;
- reviewed product/content scope, broad accessibility, D08/D10 and launch
  approval.
