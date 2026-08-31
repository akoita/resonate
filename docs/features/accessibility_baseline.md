---
title: "Accessibility Baseline"
status: implemented
owner: "@akoita"
---

# Accessibility Baseline

Resonate targets WCAG 2.2 Level AA for the web application. This baseline is
an engineering contract and regression floor, not a certification that every
historical screen fully conforms. New work must preserve native semantics,
keyboard operation, visible focus, reflow, reduced motion, and meaningful
names and states for assistive technology.

## Covered Workflows

The automated route baseline covers public Home, Marketplace, and a seeded
Shows campaign plus signed-in Library, Artist Upload, Wallet, Player, and AI DJ
states. Playwright runs axe against WCAG A/AA tags and fails on serious or
critical violations. The complete axe result is attached to each test so
moderate and minor findings remain visible without becoming silent exclusions.

Automated checks do not prove full conformance. They are paired with focused
keyboard tests for skip navigation, current-page state, playlist-panel state,
player sliders, tabs, menus, dialogs, file selection, and notifications.

Run the baseline from `web/`:

```bash
npx playwright test tests/accessibility.spec.ts --project=chromium
npx vitest run src/components/ui
```

The signed-in route checks use the E2E-only development login configured by
Playwright. They do not enable development login in a production server.

## Shared Component Contract

- Tabs expose tablist, tab, selected, controlled-panel, and roving-focus
  semantics. Arrow keys move between tabs; Home and End reach the boundaries.
- Modal dialogs are named, contain focus while open, close with Escape when
  safe, and restore focus to their opener.
- Context menus expose menu and menuitem semantics, receive initial focus, and
  support arrow, Home, End, and Escape keys.
- File drop zones remain usable through the hidden native file input, Enter,
  and Space, including an explicit disabled state.
- Notifications use live-region semantics appropriate to their severity and
  do not make pointer-only actions.
- Navigation offers a skip link and current-page state. Closed off-canvas
  playlist content is removed from keyboard and accessibility-tree traversal.
- Player transport controls have explicit names and pressed states. Playback
  position and volume are labelled native sliders, and keyboard seek commits
  immediately without requiring a pointer event.

Use native HTML before adding ARIA. Custom composites follow the relevant
[WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/); ARIA does not
replace the required keyboard behavior.

## Screen-Reader-Oriented Smoke Checklist

The repository baseline runs the following repeatable semantic smoke through
axe and Playwright's computed roles, names, states, focus, and live-region
locators:

1. Start at Home and verify the skip link moves focus to the main content.
2. Navigate to Library and verify the current link is announced as current.
3. Open and close shared dialogs; verify the title is the dialog name, focus
   stays inside, Escape closes, and focus returns to the opener.
4. Traverse tabs and context menus with their documented arrow keys.
5. Operate file selection with Space or Enter and verify disabled state.
6. Trigger success and error notifications and verify their live-region role.
7. Open Player and verify Play/Pause, previous/next, shuffle/repeat, playback
   position, mute, and volume expose names plus current state.
8. Re-run the mobile containment suite at 320–400 CSS pixels as the narrow
   reflow proxy, and inspect focus visibility with reduced motion enabled.

This smoke validates the browser accessibility contract available in CI. A
release claiming tested interoperability with NVDA, VoiceOver, TalkBack, or
Orca still requires a human pass using that named assistive technology; CI
does not emulate those products.

## Known Gap Backlog

| Severity | Gap | Affected surfaces | Owner / clearing action |
| --- | --- | --- | --- |
| Medium | Some routes render a page-level `main` inside the shell `main`, producing duplicate landmark structure even though the primary target remains discoverable. | Library and other legacy route layouts | Frontend: converge route wrappers on `section` or move main ownership out of the shell in a dedicated layout refactor. |
| Medium | Playlist folder and track rows retain drag/pointer-first operations beyond the panel-level keyboard entry and shared context-menu support. | Global playlist panel, Library playlists | Frontend: define keyboard reorder and direct row activation without nesting interactive controls. |
| Medium | The mobile navigation drawer does not yet implement a modal focus loop; its toggle and links are keyboard accessible, but focus can leave the open drawer. | Phone navigation | Frontend: choose modal-drawer versus non-modal-navigation behavior and implement/test the corresponding APG focus contract. |
| Medium | CI validates computed accessibility semantics but cannot claim interoperability with a named screen-reader/browser pair. | Highest-risk workflows | Release QA: run the checklist with at least one desktop and one mobile screen reader before a formal conformance claim. |
| Low | Moderate/minor axe findings are reported as artifacts rather than merge-blocking failures during baseline adoption. | Critical-route matrix | Frontend: triage recurring rules and promote stable fixes or rules to the blocking threshold incrementally. |

No serious or critical automated finding may be added to a covered route.
Do not exclude a selector globally to make the gate pass; fix the reachable
component or document a narrowly scoped, owner-visible exception.

## Speech Recognition Decision

**Decision: defer production speech input.** The browser
`SpeechRecognition` interface remains limited and non-Baseline. On some
browsers, recognition sends captured audio to a browser/vendor service, which
adds a privacy boundary Resonate has not selected or disclosed. A microphone
control would therefore be inconsistent across supported browsers and could
imply privacy guarantees the application does not own.

A future experiment may use browser-only progressive enhancement for search,
agent prompts, upload metadata, or simple playback commands when all of these
conditions are met:

- text and keyboard input remain the complete primary path;
- capability detection hides the control when unsupported;
- listening starts only after explicit user activation;
- the UI states where audio may be processed and provides visible listening,
  stop, permission-denied, no-match, error, and unsupported states;
- recognized text is editable before submission or any irreversible action;
- tests cover denied permissions, noisy input, empty results, cancellation,
  and screen-reader operation.

Server-side transcription is outside this issue. It would require an
environment-configured service, retention and consent decisions, and explicit
privacy and security review before implementation.

Sources: [MDN `SpeechRecognition`](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition),
[WCAG 2.2](https://www.w3.org/TR/wcag/), and
[Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).

## Product And Business Scope

This is vision-neutral quality under `vision:keep`. It changes no analytics
event, API contract, authority rule, private-data visibility, fee, payout,
price, license, collectible, payment execution, deployment setting, or
ADR-BM-6 value flow. See [#837](https://github.com/akoita/resonate/issues/837)
and the [mobile responsiveness baseline](mobile_responsiveness.md).
