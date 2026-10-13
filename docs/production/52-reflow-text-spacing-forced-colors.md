# 52 - Reflow, text spacing and forced colors

**Status: implemented W12 engineering checkpoint; not complete low-vision,
screen-magnifier, assistive-technology, alternate-engine/physical-device,
broad WCAG conformance or launch approval.**

This checkpoint implements
[#45](https://github.com/huangyingting/HelloInterview/issues/45). It establishes
production-built evidence for 400%-equivalent narrow reflow, WCAG text-spacing
overrides and Windows-style forced-colors behavior on representative critical
flows.

## Reflow and text-spacing policy

Critical reading, authentication, learning, practice, community, account and
support flows must remain usable at a 320 CSS-pixel viewport without requiring
two-dimensional page scrolling.

The production acceptance applies the WCAG text-spacing values as author-
overriding styles:

| Property | Test value |
| --- | ---: |
| Line height | 1.5 |
| Paragraph spacing | 2em |
| Letter spacing | 0.12em |
| Word spacing | 0.16em |

At those values, the test rejects:

- document-level horizontal overflow beyond a one-pixel subpixel tolerance;
- visible direct text clipped by an element with `hidden` or `clip` overflow;
  and
- visible buttons, links, fields, selects, textareas or summaries extending
  outside the viewport.

The acceptance checks actual compiled layouts after content and authenticated
state load. It does not disable responsive navigation or replace application
styles with a separate accessibility-only layout.

The 320 CSS-pixel viewport is deterministic engineering evidence for the WCAG
reflow geometry commonly associated with 400% zoom on a 1280-pixel-wide
viewport. It is not a claim about every browser’s zoom UI, screen magnifier,
device-pixel ratio or operating-system scaling behavior.

## Forced-colors policy

The application does not opt any sampled subtree out of user-agent forced-color
mapping. No `forced-color-adjust: none` exception is introduced.

Under `forced-colors: active`, shared styles use system colors for the
information that otherwise depends on palette fills:

- keyboard focus outlines use `Highlight`;
- loading and progress tracks retain a `CanvasText` border;
- loading and progress fill uses `Highlight`; and
- active navigation, tabs and current-page elements receive a geometric
  `Highlight` outline in addition to their semantic state.

This preserves a visible focus/current/progress distinction without attempting
to recreate the light or dark theme inside a user-controlled high-contrast
palette. Existing `aria-current`, `alert`, `status`, progressbar and form
semantics remain the primary non-color signals.

## Production-built coverage

The 320-pixel text-spacing acceptance samples:

- public local authentication;
- the authenticated dashboard;
- AI coding practice;
- community questions;
- account/profile; and
- support.

The forced-colors acceptance:

- triggers a real public authentication error `alert`;
- verifies authenticated dashboard current-page semantics;
- opens a learning path with a semantic progressbar;
- rejects any rendered `forced-color-adjust: none`;
- verifies the progress track and fill remain visible through system colors;
  and
- keyboard-focuses a real control and requires a solid outline at least two
  pixels wide.

This is representative compiled Chromium evidence. It does not inspect every
content state, image, video, SVG/canvas visualization, chart, editor, hosted
provider page or operating-system high-contrast palette.

## Release and rollback

This checkpoint has no database migration and changes no API. Release
verification must:

- run the production-built reflow/text-spacing/forced-colors acceptance;
- preserve the compiled `forced-colors: active` system-color rules;
- retain semantic current-page, alert/status and progressbar state;
- reject new 320-pixel document overflow, clipped direct text and offscreen
  critical controls;
- avoid `forced-color-adjust: none` unless a separately reviewed essential
  image exception includes an equivalent accessible representation; and
- preserve the fixed entry, landing and authentication graph budgets.

Do not resolve a failure by hiding content, shrinking text below the product
typography policy, removing instructions, clipping overflow or disabling user
spacing. Fix the responsive container, wrapping, intrinsic sizing or state
indicator at its shared source.

## Still required

W12, D10 and launch acceptance remain open for:

- browser-native zoom and screen-magnifier review across supported engines and
  operating systems;
- complete forced-colors review of all SVG, image, canvas, diagram, editor,
  chart, media and third-party hosted states;
- screen-reader, IME, voice-control and physical-device evidence;
- human review of reading order, cognitive load, localization and long-content
  expansion;
- independently approved accessibility support and release-blocking policy;
- reviewed content/offers, field performance, multi-release asset operation,
  integrated provider/recovery/security and operated-launch evidence.
