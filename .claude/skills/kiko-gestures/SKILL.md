---
name: kiko-gestures
description: Invoke when touching a Gesture/GestureDetector, react-native-sortables grid, react-native-reanimated worklet, ActionSheetIOS/haptics call, or PanResponder gesture math. Read before wiring drag-and-drop, a long-press menu, a swipe action, or any touch-and-hold interaction, and before debugging two gestures fighting over the same touch.
---

# Kiko gesture and animation conventions

Source files: `src/screens/grid-interaction.ts`,
`src/screens/card-context-menu.component.tsx`,
`src/screens/accounts/accounts.screen.tsx`,
`src/screens/account-detail/account-detail.screen.tsx`,
`src/screens/settings/categories.screen.tsx`,
`src/design-system/components/swipeable-row/gesture.ts`,
`src/design-system/components/bottom-sheet/bottom-sheet.gesture.ts`.

## LongPress-vs-Sortables-drag arbitration

A grid card carries two gestures that both begin from a touch-and-hold, and
they must never both fire on one hold:

- `CardContextMenu` (`card-context-menu.component.tsx`) wraps a deletable
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
`grid-interaction.ts`'s `onGridDragEnd` doc comment for the drag side of
this: `react-native-sortables` fires `onDragEnd` on every release
(`fromIndex === toIndex` means "held in place, not a reorder" — persist
nothing) — only `fromIndex !== toIndex` persists a new order.

If a hold on-device sometimes opens the wrong thing, this is the first
place to look: read both files' current constants, not what this skill
used to say.

## `runOnJS(true)` for non-worklet callbacks

`openDeleteMenu` (`grid-interaction.ts`) calls `ActionSheetIOS` and the
`react-native-haptic-feedback` bridge — neither is a worklet. Any
`Gesture...` callback that reaches a non-worklet API (`ActionSheetIOS`,
haptics, `Alert`, navigation, a repo write) must be created with
`.runOnJS(true)` on the gesture, exactly like
`Gesture.LongPress().runOnJS(true)` in `card-context-menu.component.tsx`.
Without it the callback runs on the UI thread and calling a non-worklet
JS API from there throws or silently no-ops.

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
- **`onDragEnd` always routes through `onGridDragEnd`** (`grid-interaction.ts`)
  rather than calling the repo's `reorder()` inline, so the
  release-in-place guard lives in exactly one place.
- **A grid whose cards contain a live text input needs a longer
  `dragActivationDelay`, not a `customHandle`.** The categories grid
  (`categories.screen.tsx`) is the one grid where every card wraps an
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

`swipeable-row/gesture.ts` extracts every piece of gesture arbitration
and settle math — `shouldClaimSwipe`, `clampTranslate`, `resolveSnap`,
`shouldMergeEdge` — as plain functions with no dependency on
`PanResponder` or any native gesture object. The component
(`swipeable-row/swipeable-row.component.tsx`, with `index.ts` as its
barrel — not `index.tsx`) wires these pure functions into a
`PanResponder`; the math itself is unit-tested in isolation with plain
numbers, no gesture simulation needed. Follow this split for any new
gesture with resting-state or activation-threshold logic: extract the
decision/threshold math to a pure, synchronously-testable module first,
then wire it into the native gesture object as a thin adapter.

`bottom-sheet/bottom-sheet.gesture.ts` is a second example of the same
split: `clampSheetTranslate` and `shouldDismissSheet` (the sheet's
drag-to-close distance/velocity decision) are plain functions with no
`Gesture` dependency, wired into a `Gesture.Pan()` by the component as
a thin adapter — see `kiko-design-system`'s BottomSheet entry.
