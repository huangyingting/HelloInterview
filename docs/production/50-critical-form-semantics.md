# 50 - Critical form instructions and validation semantics

**Status: implemented W12 engineering checkpoint; not complete WCAG
conformance, assistive-technology/IME certification, hosted-provider form
approval or launch approval.**

This checkpoint implements
[#43](https://github.com/huangyingting/HelloInterview/issues/43). It establishes
one testable contract for names, instructions, native validation, request
suppression and announced outcomes on representative local authentication,
account and support forms.

## Form contract

Every visible `input`, `select` and `textarea` in the sampled flows has an
accessible name from its associated label or an explicit ARIA label. Persistent
instructions use stable element IDs referenced by `aria-describedby`; the
production-built acceptance rejects a visible reference whose target does not
exist.

The local forms now associate:

- the authentication mode description with the authentication form;
- the ten-character and local-scrypt guidance with the signup password;
- the ten-character and other-session-revocation guidance with a changed local
  password;
- the local-storage/no-external-delivery disclosure with the support form; and
- the length and sensitive-content warning with the support question.

Instructions remain visible rather than appearing only after failure. Labels,
instructions and values are separate: changing modes does not reuse a stale
password instruction, and help text is not used as the only accessible name.

## Validation and request boundary

The sampled local forms retain browser-native constraint validation. A submit
handler must not bypass `required`, `type`, `minLength` or `maxLength`.

Production-built acceptance verifies that:

- blank login stays on the authentication screen, focuses email and sends no
  authentication request;
- a short signup password focuses password and sends no signup request;
- a blank profile name focuses the profile field and sends no profile request;
- missing support email focuses email and sends no support request; and
- a support question shorter than 20 characters focuses the textarea and sends
  no support request.

The no-request assertion is part of the contract. Client-side invalid input
must not become a server-side validation request, durable write or success-
shaped response.

Server-side and asynchronous failures remain application errors rather than
native validity messages. A valid-shape rejected login is exercised through the
real local endpoint and must produce a visible live `alert` with explanatory
text.

## Announced success

A valid local support request uses the existing durable API and replaces the
form with a live `status`. The confirmation includes its local ticket reference
and the explicit statement `No external delivery occurred.` This is deliberately
not represented as email delivery, staff acknowledgement or an SLA.

Existing profile/password success notifications continue through the shared
live status region. This checkpoint does not alter server validation,
transaction boundaries, support ownership or delivery authority.

## Production-built coverage

The Chromium acceptance runs against compiled assets and the real local server.
It covers:

- local sign-in and account creation;
- a real rejected credential attempt and live error;
- a newly created non-demo account;
- profile and local-password forms; and
- local support validation and successful persistence.

The suite inspects rendered controls and description references, observes
focused invalid controls, and counts network requests across invalid submits.
It supplements, rather than replaces, server-side validation tests.

## Release and rollback

This checkpoint has no database migration and changes no public API. Release
verification must:

- run the production-built critical-form semantics acceptance;
- preserve the stable instruction IDs and corresponding `aria-describedby`
  tokens in compiled deferred chunks;
- retain native constraint validation and request suppression;
- confirm rejected credentials remain an `alert`;
- confirm support success remains a `status` with the local-only delivery
  statement; and
- preserve the fixed entry, landing and authentication graph budgets.

If an instruction is removed or renamed, update the control association and
the production acceptance together. Do not retain dangling references, replace
visible labels with placeholder-only names, add `noValidate`, or issue a
request before native validity succeeds merely to make a custom error display.

## Still required

W12, D10 and launch acceptance remain open for:

- human screen-reader and IME review, including announcement ordering and
  verbosity;
- complete form coverage across managed identity, billing, staff, moderation,
  community, editors and destructive account actions;
- hosted identity and payment-provider form/accessibility evidence;
- error-summary and multi-error policy for longer forms;
- zoom, text-spacing, reduced-motion, forced-colors, alternate-engine and
  physical-device evidence;
- reviewed wording, localization, password policy and support-delivery policy;
- independently approved accessibility support and release-blocking policy;
- integrated provider, recovery, load, security and operated-launch evidence.
