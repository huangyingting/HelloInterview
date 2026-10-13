# 48 - Coarse-pointer touch targets

**Status: implemented W12 engineering checkpoint; not broad WCAG conformance,
screen-reader/IME approval, contrast approval, real-device certification or
launch approval.**

This checkpoint implements
[#41](https://github.com/huangyingting/HelloInterview/issues/41). It adds one
coarse-pointer target policy across public authentication and the authenticated
application while preserving the existing compact fine-pointer layout.

## Policy

When the browser reports `pointer: coarse`, actionable controls use a minimum
44 CSS-pixel target:

- native buttons and button-styled links have a minimum width and height of
  44 pixels, including disabled controls;
- navigation links/groups and disclosure summaries have a minimum width and
  height of 44 pixels;
- icon buttons and pagination controls use explicit 44-by-44 geometry;
- tabs use at least 44 pixels in both dimensions;
- text inputs, selects and textareas have a minimum height of 44 pixels;
- topbar, sidebar-bottom, footer and back actions are inline-flex targets with
  at least 44 pixels in both dimensions;
- checkbox and radio labels provide at least a 44-by-44 hit area while the
  visible native control is 20-by-20 pixels.

The policy is CSS-only. It does not change stored values, disabled state,
keyboard order, accessible names, route behavior or action semantics.

## Scope and exemptions

The minimum applies to controls and application-navigation actions, not every
anchor in prose. Inline links embedded in paragraphs, policy text, lesson
content and other reading surfaces retain normal line flow. Enlarging every
prose link would create misleading block-shaped targets, disrupt text layout
and cause adjacent inline targets to overlap.

Fine-pointer layouts retain their established compact geometry. The policy is
not a user-agent sniff and does not assume a viewport width: a narrow device
with a fine pointer is unchanged, while a larger touch/coarse-pointer device
receives the target treatment.

Native platform controls, browser chrome, third-party hosted identity/payment
screens and any future embedded editor or external widget remain governed by
their own reviewed policy. There is no native-application target claim.

## Responsive and interaction behavior

The coarse-pointer rules only add minimum geometry and alignment. Existing
responsive wrapping, keyboard focus styles, reduced-motion behavior, disabled
semantics and document overflow rules remain in force. Disabled controls keep
the same target geometry as enabled controls so state changes do not shift
surrounding actions.

Targets may touch at their boundary but must not overlap. A control whose
content naturally requires more than 44 pixels remains larger; the policy does
not clip labels or force a fixed width except for icon and pagination controls.

## Production-built verification

The production screen suite launches mobile Chromium at a 390-by-844 viewport
with touch enabled. It samples visible actionable controls on:

- public authentication;
- the authenticated dashboard shell;
- an AI-assisted coding practice workspace;
- the community question feed;
- account/profile and data actions;
- member support.

For every sampled screen, the test:

1. waits for route-specific ready content rather than inspecting a loading
   placeholder;
2. includes enabled and disabled visible controls;
3. rejects sampled targets below 43.5 CSS pixels in either dimension, allowing
   only subpixel measurement tolerance around the 44-pixel policy;
4. rejects target rectangles that overlap by more than one CSS pixel;
5. rejects document-level horizontal overflow.

This verifies compiled CSS and representative critical flows in Chromium. It
does not replace manual review on supported physical devices, zoom/text-scaling
review, alternate browser engines, screen-reader testing or a complete
accessibility audit.

## Release and rollback

The touch policy ships inside the ordinary versioned stylesheet and requires no
database migration or feature data. Release verification must inspect the
compiled stylesheet for the `pointer: coarse` policy and run the production
touch-context acceptance.

If a supported flow exposes clipping, overlap or unreachable controls, revert
or narrow the affected selector and republish the same tests. Do not remove the
entire coarse-pointer policy merely to preserve desktop density, and do not
claim the affected flow meets the policy until its production-built geometry
passes again.

## Still required

W12, D10 and launch acceptance remain open for:

- named-browser and physical-device touch review;
- screen-reader, IME, contrast, zoom, text-spacing and reduced-motion evidence;
- complete form validation/error/status semantics;
- keyboard alternatives for every editor, diagram and drag interaction;
- independently approved accessibility support and release-blocking policy;
- integrated provider, recovery, load, security and operated-launch evidence.
