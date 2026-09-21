---
name: kiko-gestures
description: Invoke when touching a Gesture/GestureDetector, react-native-sortables grid, react-native-reanimated worklet, ActionSheetIOS/haptics call, or PanResponder gesture math. Read before wiring drag-and-drop, a long-press menu, a swipe action, or any touch-and-hold interaction, and before debugging two gestures fighting over the same touch.
---

# Kiko gesture and animation conventions

Source files: `src/design-system/` (grid-interaction),
`src/design-system/components/card-context-menu/`,
`src/screens/accounts/accounts.screen.tsx`,
`src/screens/account-detail/account-detail.screen.tsx`,
`src/screens/settings/categories/`,
`src/design-system/components/bottom-sheet/bottom-sheet.gesture.ts`.

## LongPress-vs-Sortables-drag arbitration

A grid card carries two gestures that both begin from a touch-and-hold, and
they must never both fire on one hold:

- `CardContextMenu` (`src/design-system/components/`) wraps a deletable
  card in a `react-native-gesture-handler` `Gesture.LongPress()`. Read its
  own `HOLD_DURATION_MS` and `HOLD_MAX_DISTANCE` constants in that file
  before touching either arbitration boundary — do not hardcode their
  values elsewhere, they can be retuned on-device.
- `react-native-sortables`' `Sortable.Grid` wraps the whole grid and claims
  a hold that moves.

The split: a hold that **stays still** past the long-press's min-duration
opens the delete menu (`maxDistance` not exceeded); a hold that **moves**
past `maxDistance` fails the long-press gesture, freeing the finger for the
enclosing sortables drag-to-reorder; a quick tap satisfies neither gesture
and falls through to the card's own `onPress` (open detail). See
`onGridDragEnd`'s doc comment (`src/design-system/`) for the drag side of
this: `react-native-sortables` fires `onDragEnd` on every release
(`fromIndex === toIndex` means "held in place, not a reorder" — persist
nothing) — only `fromIndex !== toIndex` persists a new order.

If a hold on-device sometimes opens the wrong thing, this is the first
place to look: read both files' current constants, not what this skill
used to say.

## Every function called inside a worklet needs its own `'worklet'` directive

Any function — imported from another module or defined locally — that is
called SYNCHRONOUSLY inside a reanimated worklet hook (`useAnimatedStyle`,
`useDerivedValue`, `useAnimatedReaction`, `useAnimatedScrollHandler`, or a
`Gesture.*` worklet callback) MUST carry its own `'worklet'` directive at
its definition, or be defined inline in the worklet — otherwise the
worklets runtime captures it as a "remote function." See
`src/design-system/components/bottom-sheet/bottom-sheet.keyboard.ts`'s
`resolveKeyboardLift`/`resolveKeyboardAwareMaxHeight`/
`resolveKeyboardAwareBottomPadding` for the worked example: each carries
its own `'worklet'` directive precisely because `bottom-sheet.component.tsx`
calls them from inside its `useAnimatedStyle`.

**Why this is a landmine, and why Jest/Debug cannot catch it:**
react-native-worklets' native runtime only throws-and-catches a missing-
directive call `#ifndef NDEBUG` — so a DEBUG build (or a Debug simulator)
shows nothing worse than a LogBox warning, and Jest never runs the real
worklet runtime at all (reanimated is mocked there). A RELEASE build has no
catch: the uncaught throw becomes a Hermes JSError and an instant SIGABRT
the moment the worklet first runs. This shipped in builds 15/16 (every
screen crashed on first `BottomSheet` render) before the missing directive
was added. **Verify any worklet-touching fix on a RELEASE build, never
Debug or Jest** — see memory `worklet-directive-debug-swallows-release-aborts`.

## `useAnimatedKeyboard()` is banned — use RN core `Keyboard` events instead

Reanimated's `useAnimatedKeyboard()` is banned in this codebase: its native
observer reads `[[UIApplication sharedApplication] delegate] window]`, a
legacy AppDelegate-owns-the-window assumption. This app runs the iOS
UIScene lifecycle (`SceneDelegate` owns the `UIWindow`; `AppDelegate` has
none), so that call sends an unrecognized selector and SIGABRTs on cold
launch — it hit every screen once, since the shared `BottomSheet` calls
whatever drives its keyboard height. `bottom-sheet.component.tsx` instead
drives its `keyboardHeight` shared value by hand from RN core's `Keyboard`
events (`keyboardWillChangeFrame` / `keyboardWillHide`); read that file's
`useEffect` for the exact listener wiring rather than restating it here.
Do not reach for `useAnimatedKeyboard()` in any new worklet-driven
animation — see memory `scene-lifecycle-appdelegate-window-crash` for the
full crash chain, and the "Every function called inside a worklet..."
rule above for the RELEASE-vs-Debug verification gap this class of bug
shares.

## `runOnJS(true)` for non-worklet callbacks

`CardContextMenu`'s (`src/design-system/components/card-context-menu/`)
hold gesture calls the `react-native-haptic-feedback` bridge and sets
React state to raise the themed `ConfirmSheet` (a `BottomSheet`, NOT a
native `ActionSheetIOS` — that native sheet was replaced app-wide, see
`kiko-design-system`'s ConfirmSheet entry) — neither is a worklet. Any
`Gesture...` callback that reaches a non-worklet API (haptics, `Alert`,
navigation, a repo write, or a `setState` that must run on the JS
thread) must be created with `.runOnJS(true)` on the gesture, exactly
like `Gesture.LongPress().runOnJS(true)` in `CardContextMenu`. Without
it the callback runs on the UI thread and calling a non-worklet JS API
from there throws or silently no-ops.

## Sortables grid conventions

Both grids — `accounts.screen.tsx` (1 column) and the account-detail
holding grid (2 columns) — share the same tuning, so a value drifting on
one and not the other is a bug, not a deliberate difference. Read the
current values in both files before restating them; do not trust a copy
in this skill. As of this writing both grids use `activeItemScale={1.03}`
(a barely-there lift on touch-and-hold — the library default of `1.1` pops
the card up too far) and `autoScrollActivationOffset={75}`.

- **`scrollableRef` + `autoScrollActivationOffset`**: the grid is nested
  inside the screen's own `ScrollView`, so it needs that `ScrollView`'s
  `useAnimatedRef` passed through as `scrollableRef` to auto-scroll the
  parent list when a drag nears an edge — a grid with no surrounding
  scroll view does not need this prop.
- **Single-item `sortEnabled` guard**: `sortEnabled={items.length > 1}`.
  With exactly one item there is nothing to reorder against, and leaving
  sort enabled invites a spurious drag interaction on the lone card.
- **`onDragEnd` always routes through `onGridDragEnd`** (`src/design-system/`)
  rather than calling the repo's `reorder()` inline, so the
  release-in-place guard lives in exactly one place.
- **A grid whose cards contain a live text input needs a longer
  `dragActivationDelay`, not a `customHandle`.** The categories grid
  (`src/screens/settings/categories/`) is the one grid where every card wraps an
  editable rename `TextInput`; the library's default 200ms activation is
  shorter than iOS's own text-selection hold, so a hold meant to place the
  cursor or open Paste started a card drag instead. It sets
  `dragActivationDelay={CATEGORY_DRAG_ACTIVATION_MS}` (600ms, above that
  threshold) rather than adding a handle, so it does not diverge from the
  accounts/holdings grids' handle-free interaction model. Retune the
  constant on-device if 600ms ever feels sluggish for a reorder — do not
  guess a replacement value.

## "Synced entity renders no gesture" rule

A synced (Monobank) account or holding is not deletable, so
`CardContextMenu` renders it bare — `<>{children}</>`, no
`GestureDetector` at all — rather than a `LongPress` that always fails or
a disabled variant. This is deliberate, not a shortcut: leaving the
touch-and-hold gesture unclaimed for a synced card means the enclosing
sortables drag can still claim it, so a synced card stays reorderable
even though it is not deletable. Do not add a disabled/no-op `LongPress`
here — it would only add a competing gesture with no benefit.

## Pure-gesture-math testability pattern

`bottom-sheet/bottom-sheet.gesture.ts` is the worked example: it
extracts the sheet's drag-to-close decision and settle math —
`clampSheetTranslate` (clamps a raw pan translation to downward-only
travel) and `shouldDismissSheet` (whether a release should dismiss:
past a distance threshold, a fraction of the sheet's own measured
height, OR past a flick-velocity threshold) — as plain functions with
no dependency on `Gesture`/`PanResponder` or any native gesture object.
The component wires these pure functions into a `Gesture.Pan()` as a
thin adapter; the math itself is unit-tested in isolation with plain
numbers, no gesture simulation needed. Follow this split for any new
gesture with resting-state or activation-threshold logic: extract the
decision/threshold math to a pure, synchronously-testable module first,
then wire it into the native gesture object as a thin adapter — see
`kiko-design-system`'s BottomSheet entry for how the component
consumes it. `card-context-menu`'s own hold-vs-drag arbitration
constants (`HOLD_DURATION_MS`, `HOLD_MAX_DISTANCE`, see
"LongPress-vs-Sortables-drag arbitration" above) are the same kind of
extracted, directly-readable threshold values, though they stay
alongside the gesture wiring in that component rather than in a
separate pure-math module — read `card-context-menu.component.tsx`
for its current shape.
