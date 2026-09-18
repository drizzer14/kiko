import type { ComponentRef, RefObject } from 'react';
import { Keyboard } from 'react-native';
import type { ScrollViewInstance, View } from 'react-native';

// iOS's standard compact nav-bar height, regardless of whether the screen
// carries a large title — a large title only ADDS a taller band on top of
// this while fully expanded; once the user has scrolled at all (which is
// exactly when this module's caller runs), it collapses back to this fixed
// height. Read `HeaderHeightContext`'s own live value instead and it would
// still report the (taller) EXPANDED height for a screen that has not
// scrolled away from the top yet — the wrong number for "the header height
// once we land the scroll below it". A fixed compact-height assumption is a
// deliberate simplification (see `resolveHeaderInset` below), the same kind
// of well-reasoned constant `use-scroll-to-top-on-tab-press.ts` documents
// for its own header-height arithmetic.
export const COMPACT_HEADER_HEIGHT = 44;

// The band at the very top of the scroll viewport a scrolled-to field must
// never land under: the collapsed nav bar plus the safe-area top inset. A
// screen's own `useSafeAreaInsets().top` is the only per-device input this
// needs.
export const resolveHeaderInset = (safeAreaTop: number): number =>
  safeAreaTop + COMPACT_HEADER_HEIGHT;

type ScrollableRef = RefObject<ScrollViewInstance | null> | { current: ScrollViewInstance | null };

// The field's own host INSTANCE (what a `View` ref actually resolves to,
// carrying `measure`/`measureLayout`) — not the `View` component type
// itself. Exported so every form field ref (holding-form, transaction-form,
// ...) can share this exact shape rather than each re-deriving it. A ref
// that actually points at a `TextInput` (or any other host component)
// satisfies this too — every host component's ref carries the same
// `NativeMethods` (`measure`, `measureLayout`, `focus`, ...), so the same
// type covers a plain measurement-only wrapper `View` and a real focusable
// input alike.
export type FieldInstance = ComponentRef<typeof View>;

type FieldRef = RefObject<FieldInstance | null> | { current: FieldInstance | null };

// The two live signals a caller reads once, at Save-press time, from its own
// screen: the ScrollView's current content offset (reanimated's
// `useScrollOffset` on the same `useAnimatedRef` the caller already holds —
// see accounts.screen.tsx / statistics.screen.tsx for the established
// pattern) and the collapsed-header inset (`resolveHeaderInset` above).
type ScrollGeometry = {
  currentOffset: number;
  headerInset: number;
};

// The raw geometry `scrollToField` resolves a landing decision from, pulled
// out as its own pure function so the visibility/landing arithmetic is
// unit-testable without mocking `measure`/`measureLayout`/`Keyboard`.
type FieldScrollGeometry = {
  fieldTop: number;
  fieldHeight: number;
  currentOffset: number;
  viewportHeight: number;
  keyboardHeight: number;
  headerInset: number;
};

// Whether a scrolled-to field is already fully on-screen — between the
// collapsed header band at the top and the (keyboard-shrunk) visible bottom
// — and, when it is not, the exact content offset that lands its own top
// edge just below the header. A field ABOVE the visible area and one BELOW
// it (or under the keyboard) both resolve to the SAME landing rule: land the
// field's top just below the header, never at content top — the round-3
// device-feedback brief's explicit rule, rather than a "scroll the minimum
// distance" rule that would leave a field's top flush against the header on
// a downward scroll.
export const resolveFieldScrollTarget = (
  geometry: FieldScrollGeometry,
): { shouldScroll: boolean; targetOffset: number } => {
  const { fieldTop, fieldHeight, currentOffset, viewportHeight, keyboardHeight, headerInset } =
    geometry;

  const visibleTop = currentOffset + headerInset;
  const visibleBottom = currentOffset + viewportHeight - keyboardHeight;
  const fieldBottom = fieldTop + fieldHeight;
  const isFullyVisible = fieldTop >= visibleTop && fieldBottom <= visibleBottom;

  if (isFullyVisible) {
    return { shouldScroll: false, targetOffset: currentOffset };
  }

  // THE POSITION-SCALING BUG (round-4 device feedback, item 2): the landing
  // target used to floor at 0 — correct only for a plain, non-inset
  // ScrollView where "content top visible right below the header" sits at
  // offset 0. This app's scroll screens set
  // `contentInsetAdjustmentBehavior="automatic"` (screen.component.tsx), so
  // iOS itself treats `-headerInset` as that resting offset (content position
  // 0 shows right below the header at `contentOffset === -headerInset`), and
  // `fieldTop` — content-absolute, unaffected by scroll, the same contract
  // `visibleTop`/`visibleBottom` above already assume — can legitimately need
  // a target anywhere down to `-headerInset` (exactly at `fieldTop === 0`).
  // Flooring at 0 instead forced MORE scroll than a near-top field needed,
  // landing its top back inside the header band whenever the user was
  // already scrolled down when Save ran (the common case — Save is a pinned
  // footer button reachable from any scroll position, so an early field can
  // fail validation while `currentOffset` is deep into a long form). This is
  // a reference-frame floor bug, not a currentOffset-double-count bug: given
  // `fieldTop >= 0` always, `fieldTop - headerInset` can never fall below
  // `-headerInset` on its own, so this floor is a documented safety bound,
  // not an active clamp.
  return { shouldScroll: true, targetOffset: Math.max(fieldTop - headerInset, -headerInset) };
};

// Scrolls `scrollableRef`'s content so `fieldRef` lands just below the
// collapsed header — ONLY when it is actually off-screen or occluded (by the
// header band or the keyboard); an already-visible field is left exactly
// where it is. Every multi-field form's Save-press validation calls this
// with the FIRST invalid field's ref (see holding-form and transaction-form).
// `measureLayout` resolves the field's own top/height relative to the
// ScrollView's own native node (its own ancestor argument), so this is
// correct regardless of how many plain Box wrappers sit between the field
// and the ScrollView's content root — unlike summing each wrapper's own
// onLayout offset, which only works when every ancestor's own origin matches
// the scroll content's. `scrollView.measure` reports the ScrollView's own
// FRAME height — its visible viewport, unaffected by how far it has
// scrolled — and `Keyboard.metrics()` reports the keyboard's current height
// (`undefined` while it is hidden). `onSettled`, when given, fires once
// positioning has resolved — whether or not an actual scroll happened — so
// the caller can then FOCUS the field (a real TextInput ref) or flag a
// visible highlight (a picker/date field with no keyboard of its own); it is
// never called if the field could not be measured (e.g. it unmounted between
// the Save press and this callback firing).
export const scrollToField = (
  scrollableRef: ScrollableRef,
  fieldRef: FieldRef,
  geometry: ScrollGeometry,
  onSettled?: () => void,
): void => {
  const scrollView = scrollableRef.current;
  const field = fieldRef.current;

  if (scrollView === null || field === null) {
    return;
  }

  field.measureLayout(
    scrollView,
    (_x: number, fieldTop: number, _width: number, fieldHeight: number) => {
      scrollView.measure((_x2: number, _y2: number, _width2: number, viewportHeight: number) => {
        const keyboardHeight = Keyboard.metrics()?.height ?? 0;
        const decision = resolveFieldScrollTarget({
          fieldTop,
          fieldHeight,
          currentOffset: geometry.currentOffset,
          viewportHeight,
          keyboardHeight,
          headerInset: geometry.headerInset,
        });

        if (decision.shouldScroll) {
          scrollView.scrollTo({ y: decision.targetOffset, animated: true });
        }

        onSettled?.();
      });
    },
    () => {
      // measureLayout can fail transiently (e.g. the field unmounted between
      // the Save press and this callback firing) — no-op rather than throw.
      // The user still sees the field's own inline error, just without the
      // scroll (or the focus/highlight onSettled would have triggered).
    },
  );
};
