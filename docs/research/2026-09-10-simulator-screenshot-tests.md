# Feasibility spike: simulator screenshot / visual-regression tests

Date: 2026-09-10
Type: read-only research spike. No code was written. No file was changed.
Author lens: kiko:explorer + qa.

## Question

Is it feasible to run screenshot / visual-regression tests with the iOS
simulator for this app, to produce screenshots?

## Scope rule (do not contradict)

Live-on-device is the channel for **design** review. Screenshots are for
**regression** only. This document is about regression / visual-diff testing.
It is not about design review.

## Verdict

Yes, it is feasible. The recommended approach is **Maestro `takeScreenshot`
in end-to-end (E2E) flows, plus an external pixel-diff step**.

Reasons:
1. Maestro is already the sanctioned E2E tool. The binary is already installed.
2. This path adds no second E2E framework and no New-Architecture-risky native module.
3. It produces real iOS simulator screenshots as PNG files.

The one gap: Maestro does not do a deterministic pixel diff by itself. You must
add a small external diff step (for example `odiff` or `pixelmatch`, or
`jest-image-snapshot` used only as a diff engine on the captured PNG files).

## Verified repository facts

The spike verified these facts from the repository:

- React Native `0.87.1`, React `19.2.3` (`package.json`).
- Hermes is on (`USE_HERMES = true` in `ios/Kiko.xcodeproj/project.pbxproj`).
- New Architecture is the default-on state for RN 0.87. No disable flag was found.
- iOS deployment target is `16.0` (`ios/Podfile`).
- Existing tests: Jest `^29` + `@testing-library/react-native` `^14` (unit / component).
- No Detox, no `react-native-owl`, no `jest-image-snapshot` are installed.
- Maestro is installed at `~/.maestro/bin/maestro`. **No Maestro flow file exists in the repo yet.**
- `xcrun simctl` is available on this machine.
- The app renders blur and animation: `@callstack/liquid-glass`,
  `react-native-reanimated`, `react-native-nitro-sfsymbols`. These raise
  pixel-diff flakiness risk.
- No continuous integration (CI) is wired. The CLAUDE.md "Future stubs" are disabled.

## Option comparison

| Option | Real simulator screenshots? | Fit with Jest/Maestro | Setup cost | Flakiness risk | CI feasibility |
|---|---|---|---|---|---|
| Maestro `takeScreenshot` + external diff | Yes | High. Reuses the installed Maestro. Diff is a separate script. | Low to medium | Medium | Yes, needs a macOS runner with Xcode + simulator |
| jest-image-snapshot on rendered output | No | Poor. Jest + RNTL render a virtual tree, not real pixels. | Low | Low (but not real UI) | Yes, but the screenshots are not the real app |
| react-native-owl | Yes | Medium. Separate build + native module. | Medium to high | Medium | Yes, but New-Arch / RN 0.87 support is a real risk |
| Detox + screenshot diffing | Yes | Low. A second E2E framework next to Maestro. | High | Medium | Yes, but New-Arch / RN 0.87 support is a real risk |
| XCUITest snapshot (native) | Yes | Poor. Separate Swift/ObjC toolchain, not JS. | High | Medium | Yes, on a macOS runner |
| Storybook / react-test-renderer snapshots | **No** | High with Jest. | Low | Low | Yes, but not real screenshots |

## Notes per option

### Maestro `takeScreenshot` (recommended)

- `takeScreenshot` is a real Maestro command. It saves a PNG from the running
  simulator or device.
- Maestro does **not** assert a pixel diff by itself. You add an external diff
  step on the saved PNG files.
- It reuses the sanctioned toolchain. It adds no second native module.
- The repo has no Maestro flow yet, so you must author the flows.

### jest-image-snapshot / pixel-diff on rendered output

- This does **not** produce real simulator screenshots.
- Jest + React Native Testing Library render to a virtual element tree, not to
  device pixels. There is no real native frame to capture.
- `jest-image-snapshot` is still useful, but only as a **diff engine** on PNG
  files that another tool (Maestro) captured.

### react-native-owl

- It builds the app and takes real simulator screenshots, then diffs them.
- It relies on its own native module and its own build step.
- Risk: its New Architecture and RN 0.87 support is uncertain. Verify before you
  invest. I did not verify owl against RN 0.87 in this spike.

### Detox + screenshot diffing

- `device.takeScreenshot()` produces real simulator screenshots. Detox has no
  built-in pixel diff, so you pair it with `jest-image-snapshot`.
- Detox is a second, heavy E2E framework next to Maestro. This duplicates the
  E2E layer.
- Risk: New Architecture / RN 0.87 support is a real risk. Verify before you invest.

### XCUITest snapshot testing (native)

- It produces real simulator screenshots through the native test target.
- It is a separate Swift/ObjC toolchain. It does not fit the JS/Jest workflow.
- Navigating a React Native screen from XCUITest needs accessibility
  identifiers, which raises the cost.

### Storybook / react-test-renderer snapshots

- **Call-out: these are NOT real simulator screenshots.**
- `react-test-renderer` `toMatchSnapshot` stores a serialized element tree, not
  pixels. It catches tree changes, not visual changes.
- It is cheap and it fits Jest, but it does not answer the screenshot question.

## Recommended setup steps (Maestro path)

1. Author Maestro YAML flows under a `.maestro/` directory (none exist yet).
2. Seed deterministic data before each flow (fixed accounts, fixed amounts,
   fixed locale and time zone) so the screenshots are stable.
3. Disable animations for the run (reanimated) and account for blur surfaces
   (`@callstack/liquid-glass`).
4. Run the flow on a pinned simulator (fixed device model + iOS version) and
   call `takeScreenshot` at each checkpoint.
5. Add an external diff step (`odiff`, `pixelmatch`, or `jest-image-snapshot` as
   a diff engine) with a small per-pixel tolerance.
6. Store baseline PNG files in the repo. Fail the run when the diff is above the
   tolerance.

## Rough cost

- Low to medium for the Maestro path if it stays local.
- The diff step is a small script plus a baseline image set.
- CI adds real cost: it needs a macOS runner with Xcode and a simulator. No CI
  is wired today, so this is a new, heavy addition.

## Risks

1. **Flakiness from blur and animation.** `@callstack/liquid-glass` and
   reanimated make pixel output vary. Pin the simulator, disable animation, and
   use a tolerance.
2. **Non-deterministic data.** The app reads a database and live rates. Seed
   fixed data or the diff always fails.
3. **Simulator drift.** A different iOS version or device model shifts fonts and
   layout. Pin one simulator for the baseline.
4. **New Architecture support** for owl and Detox is a real risk on RN 0.87. I
   did not verify either against RN 0.87 in this spike.
5. **CI is not wired.** A macOS runner is required and does not exist yet.
