# 51 - Reduced motion in critical flows

**Status: implemented W12 engineering checkpoint; not complete vestibular
assessment, media accessibility review, alternate-engine/physical-device
certification, broad WCAG conformance or launch approval.**

This checkpoint implements
[#44](https://github.com/huangyingting/HelloInterview/issues/44). It establishes
one production-tested reduced-motion contract for shared CSS motion, startup and
deferred-screen status, and the application’s auto-advancing algorithm
visualization.

## Shared motion policy

When `prefers-reduced-motion: reduce` is active, the shared stylesheet applies
to rendered elements and their `::before`/`::after` pseudo-elements:

- CSS animations are disabled;
- CSS transitions are disabled; and
- smooth scrolling is replaced by immediate scrolling.

This covers button/card/progress transitions, mobile navigation movement and
the startup loading animation without maintaining a fragile selector allowlist.
The policy does not hide content or suppress a status merely because its visual
movement is removed.

The startup loading track retains a centered, visible static accent segment.
Removing its animation without defining a static position could leave the
absolutely positioned segment at an implicit or invisible position, so the
reduced-motion rule supplies that position explicitly. Deferred route loading
continues to expose its live `status`, heading, explanation and busy state.

## Interactive auto-play policy

The algorithm playground observes the media query in JavaScript and listens for
changes during the session.

Under reduced motion:

- an existing auto-play interval is stopped;
- the Play/Pause control is replaced by visible guidance that reduced motion is
  active;
- Reset remains available;
- Step remains available for explicit one-step progression; and
- the current explanation and step count remain visible.

Returning to no preference restores Play without a document reload. Switching
back to reduced motion while Play is running removes the auto-play control and
clears its interval before further automatic progression. Essential algorithm
content remains reachable manually.

The preference controls movement, not elapsed-time accounting or operational
polling. Practice timers and privacy-export status polling represent time/state
rather than decorative or auto-advancing visual motion and are not disabled by
this checkpoint.

## Production-built coverage

The Chromium acceptance runs compiled assets with reduced motion emulated. It:

- blocks the real bootstrap response and verifies the startup loading segment is
  visible, static and contained by its track;
- scans rendered elements and pseudo-elements for active animations,
  non-zero transition durations or smooth scrolling;
- samples public authentication and an authenticated dashboard;
- delays a real deferred route chunk and confirms its loading status remains
  visible without motion;
- verifies algorithm Play is absent and manual Step works under reduced motion;
- changes the preference to no preference without reload and starts auto-play;
- changes back to reduced motion, verifies automatic progression stops, then
  advances explicitly with Step.

Computed-style scanning is representative production evidence, not a complete
review of every media asset, browser engine, OS animation setting, canvas,
third-party page or future state.

## Release and rollback

This checkpoint has no database migration and changes no API. Release
verification must:

- run the production-built reduced-motion acceptance;
- preserve the compiled `prefers-reduced-motion: reduce` rule;
- confirm the compiled startup indicator has a static reduced-motion position;
- confirm the algorithm chunk contains the media-query listener and manual
  guidance;
- retain ordinary Play behavior when no reduced-motion preference is active;
- preserve the existing entry, landing and authentication graph budgets.

If a new auto-advancing interaction is added, classify whether its movement is
essential, provide an explicit non-automatic path, and add production evidence.
Do not add selector exemptions to restore decorative transitions under reduced
motion, and do not remove loading/progress content merely to eliminate
animation.

## Still required

W12, D10 and launch acceptance remain open for:

- complete vestibular review of media, canvas, diagrams, drag interactions,
  parallax, flashing and any future timed content;
- transcript/caption/audio-description and playback-control review;
- screen-reader, IME, voice-control, zoom, text-spacing and forced-colors
  evidence;
- supported alternate-engine, operating-system and physical-device evidence;
- managed identity/payment and third-party hosted-page accessibility evidence;
- independently approved accessibility support and release-blocking policy;
- reviewed content/offers, field performance, multi-release asset operation,
  integrated recovery/security and operated-launch evidence.
