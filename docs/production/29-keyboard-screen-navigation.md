# 29 - Keyboard screen navigation and reliable Search input

**Status: implemented W12 engineering checkpoint, not a complete accessibility
assessment or launch approval.** This improves the existing screen shell and
Search without changing account, content, payment, provider or write authority.
There is no schema migration, modal dialog, focus trap or new dependency.

## Verified gaps and intended behavior

Production-built browser checks reproduced three problems before the changes:
rapid Search typing lost characters, the skip link did not focus the main
landmark, and the visually off-screen closed mobile sidebar remained visible to
accessibility queries and available to keyboard navigation.

| Surface | Delivered behavior |
| --- | --- |
| Skip to content | Native fragment link focuses `main#main`; subsequent Tab starts inside the screen rather than traversing the sidebar |
| SPA path/owner change | The committed selected screen receives main-landmark focus if the user has not deliberately moved focus elsewhere |
| Deferred module | Loading status remains accessible; focus is not prematurely moved to a not-yet-committed screen |
| Deferred failure | The explicit failure screen participates in the same navigation focus behavior; Tab reaches manual Reload page |
| Ordinary query/hash update | Does not schedule a screen focus shift or remount healthy screen state; changed canonical post selection is a screen change per runbook 30 |
| Existing form/autofocus | Remains focused; alias changes and Search updates do not interrupt editing |
| Closed mobile navigation | Hidden from accessibility queries, pointer interaction and sequential keyboard focus at the existing mobile breakpoint |
| Open/dismissed navigation | Announced expanded/control relationship; opening focuses Close navigation, dismissal returns focus to the trigger |
| Rapid Search typing | Every typed character, literal punctuation, Unicode text and middle-of-value insertion survives deferred URL updates |
| Search shortcut | Ctrl/Cmd+K opens Search or refocuses its existing input; composing and already-handled key events are not intercepted |

## Focus lifecycle

`useScreenFocus` records the focused element on an actual screen or owner change
after bootstrap is available. It intentionally records, but does not focus,
the initial document's screen. The initial keyboard order therefore retains
the skip link; existing native/autofocus behavior still applies.

`ScreenReady` reports committed screen readiness from **inside Suspense**.
Parent layout bookkeeping precedes this passive ready callback, including when
an already-loaded screen commits without showing a fallback. The failure
boundary uses the same ready callback for its explicit error view.
Changing its path/query reset key clears failure before rendering the next
screen, rather than committing the old error under the new route first.
This prevents stale error readiness from consuming the next delayed screen's
focus request; healthy child state is not remounted.

The callback consumes the pending request once. It focuses the existing main
landmark only when focus is still on the recorded origin or has returned to
the document body, and no control inside main already owns focus. Choosing
a theme/navigation control while a chunk loads prevents a later focus steal.
Search autofocus, existing form focus and query-only updates are preserved.
Navigating elsewhere supersedes the earlier pending request; a late old chunk
cannot steal focus back from the current screen.

[Runbook 30](30-opaque-community-addresses.md) extends screen identity to the
kind/ID/track of a query-addressed community detail. Equivalent parameter
reordering preserves drafts/focus; changing the selected post is navigation,
not ordinary Search-style query editing.

Main has `tabIndex=-1`: programmatically/native-fragment focusable, not an
extra stop in normal sequential tabbing. Keyboard focus uses the existing
visible outline. Focus does not add a second scroll jump; the shell retains
its existing path-change scroll/title behavior.

Readiness here means the selected screen module has committed, not that every
content API or native workspace operation has finished. Existing API loading,
error, access-refresh and unsaved-draft handling remain separate. This is not
a global focus manager for every nested disclosure or form validation.

## Mobile navigation

The existing `max-width: 1050px` CSS rule now applies `visibility:hidden` to a
closed sidebar and restores visibility when opened. Translation alone was
insufficient: it left its links keyboard-accessible outside the viewport.
The visibility change is immediate on dismissal; the existing entrance
transform and reduced-motion policy remain. Desktop navigation stays visible
without a duplicate JavaScript breakpoint or a desktop `aria-hidden` flag.

The trigger publishes `aria-expanded` and `aria-controls=studio-navigation`.
Opening focuses the existing close button. Close button, Escape and backdrop
dismissal restore trigger focus when that trigger is rendered. Choosing a
route instead closes the sidebar and follows the new screen's readiness.
Composing or already-handled key events do not close/intercept navigation.

This is still a navigation disclosure, not a dialog. Keyboard focus is not
trapped, body content is not made inert and no modal role is claimed. Broader
mobile interaction, touch target and assistive-device review remains required.

## Search and concurrent URL updates

The old textbox was controlled directly by committed Router search parameters.
Router navigation can defer a render; restoring an older controlled value
during that delay discarded subsequent characters.

React's existing stable `useOptimistic` hook mirrors each input value immediately
inside a transition that updates the URL. The committed query remains the base
value and the source of catalog filtering, API queries and cursor binding.
Incoming canonical URL/history changes replace the base rather than leaving
an independently managed text draft out of sync.

This is an optimistic **textbox display**, never an optimistic save, successful
search response or authority grant. Existing 200-character input/API bounds,
150 ms community-search debounce, aborts, viewer/query response fences,
body-only matches and explicit Load more remain. URL edits still replace the
current history entry instead of adding one entry per keystroke; browser Back
and external same-screen URL changes remain usable. Results may still reflect
the previous committed query during a transition/debounce.

The explicit `studio-search` input ID lets the shell shortcut refocus an already
open Search without recreating the screen or clearing its query/category.
The shortcut does not apply to an independent iframe browsing context.

## Evidence and remaining gates

```sh
npm run build
CHROME_PATH=/usr/bin/google-chrome npm run test:screens
```

The production-built browser suite checks the skip link and following Tab,
ready/delayed/superseded navigation, failure recovery tab order, visible main
focus, preserved theme/form/Search focus, real rapid typing/caret editing,
Unicode/punctuation and URL/history behavior, mobile hidden/open/dismissed/
resized navigation, and synthetic composing/already-handled shortcut guards.
Synthetic key guards do not certify a real operating-system IME.

The original fixed transitive JavaScript ceilings remain **350 KiB raw and
100 KiB gzip estimate** for entry, cold landing and cold sign-in. Current
measurements are recorded in the [delivery runbook](28-deferred-screen-delivery.md);
no threshold increase or new eager discovery dependency is introduced.
Managed identity/billing/support/expiry, all local workflows, private-content
boundaries and runtime-only manifest packaging remain release gates.

Still required: human screen-reader/device/IME assessment, color/contrast and
touch target review, all-field validation/status announcements, broader
workspace/iframe/media accessibility, reviewed public content/offers,
deployed performance/asset-retention operation and all commercial/privacy/
provider/launch approvals. W12 and the overall production objective remain open.
