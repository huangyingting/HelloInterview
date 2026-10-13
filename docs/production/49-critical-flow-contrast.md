# 49 - Critical-flow text and focus contrast

**Status: implemented W12 engineering checkpoint; not complete WCAG
conformance, screen-reader/IME approval, image-content analysis, alternate-
engine/physical-device certification or launch approval.**

This checkpoint implements
[#42](https://github.com/huangyingting/HelloInterview/issues/42). It establishes
one computational contrast policy for representative public and authenticated
flows in both supported themes, then corrects shared tokens rather than adding
screen-specific exceptions.

## Policy and thresholds

The production-built acceptance uses WCAG 2.2 AA thresholds:

| Rendered content | Required contrast |
| --- | ---: |
| Normal text and placeholders | 4.5:1 |
| Text at least 24 CSS pixels | 3:1 |
| Text at least 18.66 CSS pixels and weight 700 or greater | 3:1 |
| Shared keyboard focus indicator against the adjacent surface | 3:1 |

Ratios use sRGB channel linearization and relative luminance. The comparison is
against the effective rendered background, not just a named design token.

Disabled controls are excluded from the text threshold, matching the normative
exception. Elements hidden from the accessibility tree with `aria-hidden` are
treated as decorative and excluded. Hidden or non-rendered elements are not
measured.

## Effective-background evaluation

For each visible element with a direct text node, the browser acceptance:

1. reads the computed foreground color, font size and weight;
2. walks the rendered ancestor chain from the document to the text element;
3. alpha-composites every computed background color in paint order;
4. extracts computed color stops for CSS gradients and checks the complete
   declared stop envelope;
5. applies computed foreground opacity;
6. compares the lowest resulting contrast with the applicable threshold.

Empty text inputs and textareas with placeholders are checked using the
computed `::placeholder` color and opacity.

An unsupported non-gradient background image under sampled text is a test
failure, not a silent pass. This checkpoint does not inspect text baked into
images, videos, canvas output or third-party hosted pages.

## Shared token corrections

The light theme now uses:

- a darker muted text token that remains above 4.5:1 on white, the application
  background and sampled tinted panels;
- a slightly darker accent that preserves the palette while keeping ordinary
  accent text and soft-button text above 4.5:1;
- full-opacity placeholder text using the accessible muted token;
- a dedicated error token for status borders/icons/text;
- a darker dashboard quiz eyebrow on its pale olive panel.

The dark theme retains its already-compliant muted/accent palette and adds a
lighter dedicated error token plus a theme-specific dashboard quiz eyebrow.

The shared focus style is a three-pixel solid accent outline with a three-pixel
offset. The earlier translucent color mix was removed because its rendered
contrast depended on the underlying surface and could fall below 3:1.

## Status and current-state semantics

Color is not the only sampled state signal:

- error feedback is exposed as an `alert` with explanatory text;
- the current primary navigation destination uses `aria-current="page"`;
- focus uses a visible geometric outline, not a color-only text change;
- existing pressed, expanded and disabled controls retain their semantic
  attributes and text/icon labels.

The acceptance deliberately triggers the local password-recovery error and
checks its alert text and contrast. It also verifies the authenticated dashboard
current-page state.

## Production-built coverage

The compiled browser suite checks light and dark themes on:

- public authentication, including an explicit error alert;
- the authenticated dashboard shell;
- an AI-assisted coding practice workspace;
- the community question feed;
- account/profile and data actions;
- member support.

The test evaluates actual computed styles from production assets at a
1280-by-900 viewport. It also enters keyboard navigation, finds the rendered
`:focus-visible` target and checks outline style, width and adjacent-surface
contrast.

This is deterministic engineering evidence for representative critical flows.
It is not a substitute for visual review at zoom/text-spacing settings,
high-contrast/forced-colors modes, assistive technology, physical displays,
alternate browser engines or every application state.

## Release and rollback

The policy ships in the ordinary versioned stylesheet and requires no database
migration. Release verification must:

- run the production-built contrast test;
- inspect the compiled light/dark muted, accent and error tokens;
- confirm placeholders are not made translucent;
- confirm the solid focus outline remains present;
- preserve the existing entry, landing and authentication graph budgets.

If a future surface introduces a background image or new text combination that
the evaluator cannot measure, the release must either add an explicit,
reviewable measurement model or remove that unsupported text/background
combination. Do not add a blanket selector exemption to make the test green.

## Still required

W12, D10 and launch acceptance remain open for:

- complete screen-reader, IME, zoom, text-spacing, reduced-motion and
  forced-colors review;
- physical-device and supported alternate-browser evidence;
- full form validation, instruction and error association review;
- contrast review for every state, chart, diagram, media caption and editor;
- keyboard alternatives for every drag/canvas interaction;
- independently approved accessibility support and release-blocking policy;
- integrated provider, recovery, load, security and operated-launch evidence.
