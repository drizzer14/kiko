---
name: kiko-gestures
description: Invoke when touching a Gesture/GestureDetector, react-native-sortables grid, react-native-reanimated worklet, ActionSheetIOS/haptics call, or PanResponder gesture math. Read before wiring drag-and-drop, a long-press menu, a swipe action, or any touch-and-hold interaction, and before debugging two gestures fighting over the same touch.
---

# Kiko gesture and animation conventions

Source files: `src/design-system/` (grid-interaction, use-grid-lift-guard),
`src/design-system/components/card-context-menu/`,
`src/design-system/components/holding-card/`,
`src/design-system/components/close-holding-sheet/`,
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
opens the context menu (the action list, or the delete confirm on a
delete-only card; `maxDistance` not exceeded); a hold that **moves**
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

### A hold lifts the card, and a lifted card never opens its page

`Sortable.Grid` lifts a card (`activeItemScale`) once a hold passes its
`dragActivationDelay` — the library default, 200 ms, which is BEFORE the
`CardContextMenu` long-press (450 ms) — so every hold on a sortable card
lifts it first. Two rules follow, shared by all three card grids
(Accounts' main grid and its Property/Debts holding grids, and the
account-detail holding grid):

- **A lone card lifts too.** `sortEnabled` is the query's `isFresh` only,
  never `&& data.length > 1`. react-native-sortables' touch handler gates
  only on `sortEnabled`, the absolute layout being ready, and no other
  active item (`DragProvider.ts` `handleTouchStart`) — it never counts
  items — so a single card lifts and drops back (`onDragEnd` reports
  `fromIndex === toIndex`, which `onGridDragEnd` persists nothing for).
- **A hold that lifted the card never fires the card's tap.** The finger
  lifting off after a lift (moved or not, and the release after the
  context menu opened) still reaches the card's `Pressable`/`onOpen`.
  `useGridLiftGuard` (`src/design-system/use-grid-lift-guard/`) is the one
  shared mechanism: pass its `onDragStart` and `onActiveItemDropped` to
  the `Sortable.Grid` (both are JS callbacks the library hops to the JS
  thread itself) and wrap each card's open handler:
  `onOpen={openUnlessLifted(item.id, () => navigation.navigate(...))}`.
  The lifted key is cleared by the press it suppressed, and again by
  `onActiveItemDropped` (fires after the release, a drop animation
  later) since a lift can end without any press. A quick tap never
  activates the drag, so it opens as before. One hook call per screen
  serves every grid on it (the guard is keyed by the card's id). A new
  card grid must do the same; Jest cannot hit-test, so a screen test
  drives `onDragStart` / `onActiveItemDropped` off the mocked grid's
  props (`@kiko/test-support/lift-grid-card`) and the real feel is an
  on-device check.

## Every function called inside a worklet needs its own `'worklet'` directive

Any function — imported from another module or defined locally — that is
called SYNCHRONOUSLY inside a reanimated worklet hook (`useAnimatedStyle`,
`useDerivedValue`, `useAnimatedReaction`, `useAnimatedScrollHandler`, or a
`Gesture.*` worklet callback) MUST carry its own `'worklet'` directive at
its definition, or be defined inline in the worklet — otherwise the
worklets runtime captures it as a "remote function." The pre-write guard
(`kiko-worklet-directive-required`) catches only a SAME-FILE helper; an
imported helper is still a review item. See
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
whatever drives its keyboard height. Mechanized as the
`kiko-no-use-animated-keyboard` Semgrep rule (ERROR,
`rules/semgrep-prewrite.yml`, see `kiko-linter`) — any new call is a hard-fail,
not just a review comment. `bottom-sheet.component.tsx` instead
drives its `keyboardHeight` shared value by hand from RN core's `Keyboard`
events (`keyboardWillChangeFrame` / `keyboardWillHide`); read that file's
`useEffect` for the exact listener wiring rather than restating it here.
Do not reach for `useAnimatedKeyboard()` in any new worklet-driven
animation — see memory `scene-lifecycle-appdelegate-window-crash` for the
full crash chain, and the "Every function called inside a worklet..."
rule above for the RELEASE-vs-Debug verification gap this class of bug
shares.

## No swipe actions — row edit/delete is the long-press CardContextMenu

Swipe actions were removed on purpose. A row's edit/delete is the
long-press `CardContextMenu` (Edit/Duplicate/Close/Delete, in that
order, each only where the consumer passes it), never a swipe
gesture. Do not propose or add one: no gesture-handler `Swipeable` /
`ReanimatedSwipeable`, no swipe-list package (by default, named, or
namespace import), no fling recognizer
(`Gesture.Fling()`, `useFlingGesture`, `FlingGestureHandler`), no
swipe-named row component, and no `PanResponder.create` (the app's own
former swipe row was a PanResponder row). The bottom sheet's drag-to-dismiss
(`Gesture.Pan()`) stays allowed. Mechanized as `kiko-no-swipe-action`
(ERROR, `rules/semgrep-prewrite.yml`).

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

Four grids — `accounts.screen.tsx`'s main grid (1 column, account
cards), its "Property" and "Debts" section grids below it (also 1
column, but HOLDING grids: one `HoldingCard` per open holding of the
implicit property / debt account, with `holdingsRepo.reorder`; see
"Section-scoped grids must persist the FULL order" below), and the
account-detail holding grid — share the same tuning, so a value
drifting on one and not the others is a bug, not a deliberate
difference. Read the current values in all of them before restating
them; do not trust a copy in this skill. As of this writing all use
`activeItemScale={1.03}` (a barely-there lift on touch-and-hold — the
library default of `1.1` pops the card up too far),
`overDrag="vertical"`, and `autoScrollActivationOffset={75}`. The
accounts main grid gates `sortEnabled` on the ACCOUNTS query's
`isFresh`; the two section grids gate it on the HOLDINGS query's
`isFresh` (a drag persists the rows on screen, so it never starts from
a cached read), with no item-count condition — see "A hold lifts the
card" above. (The categories grid,
`src/screens/settings/categories/`, is a FIFTH grid with a
deliberately different `dragActivationDelay` — see its own entry below
— it is not part of this shared-tuning claim.)

### Section-scoped grids must persist the FULL order

`accountsRepo.reorder(orderedIds)` rewrites `sortOrder = index` for
ONLY the ids it is given — its contract is "the full new front-to-back
order", not "this grid's own ids". When a screen splits one list into
several grids by a filter, persisting only the dragged grid's own
reordered ids restarts THAT SECTION's `sortOrder` back at 0 on every
drag, colliding with the other section's own 0-based run — every
OTHER `listQuery` consumer that reads the full, unfiltered list
(Statistics' account filter, the transaction-form account rank, Home,
statement import) then sees the sections interleaved instead of kept
apart. Fix: a grid's `onDragEnd` persists the WHOLE order, splicing
its own new order back into the other sections' (unchanged) ids.

Today `accounts.screen.tsx` has ONE account-order grid, the main one
(every non-implicit kind): its `onDragEnd` persists
`accountsRepo.reorder([...mainIds, ...implicitAccountIds])`, the
property account's id first, then the debt account's. The Property and
Debts sections are no longer account grids: each lists the OPEN
holdings of its implicit account (at most one live account per kind,
`src/holdings/implicit-account/`), and its `onDragEnd` persists that
account's open holdings only through
`onGridDragEnd(…, holdingsRepo.reorder)` — the same contract as the
account-detail grid (`holdingsRepo.reorder` rewrites only the ids it is
given, so no other account's holdings move). Closed holdings keep
their old `sortOrder`. A screen introducing a NEW filtered account
section must extend the account-order rule the same way, not revert to
passing a single grid's own ids straight through.

Each section keeps its own long-press `CardContextMenu` (Close / Delete)
and its own `useCloseHoldingAction` instance (one per implicit
account); render EACH instance's `closeSheet`, or "Close" in that
section opens nothing.

- **`scrollableRef` + `autoScrollActivationOffset`**: the grid is nested
  inside the screen's own `ScrollView`, so it needs that `ScrollView`'s
  `useAnimatedRef` passed through as `scrollableRef` to auto-scroll the
  parent list when a drag nears an edge — a grid with no surrounding
  scroll view does not need this prop.
- **No single-item `sortEnabled` guard on a card grid.** A lone card must
  lift on a hold like any other (see "A hold lifts the card" above), so
  `sortEnabled` is the freshness gate alone. The spurious-drag worry that
  once motivated `items.length > 1` is covered by `onGridDragEnd`
  persisting nothing for a release in place and by `useGridLiftGuard`
  suppressing the tap.
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
