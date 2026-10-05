import { HeaderHeightContext } from '@react-navigation/elements';
import { type ComponentRef, type RefObject, useContext } from 'react';
import { Keyboard, type ScrollViewInstance, type View } from 'react-native';

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

type ScrollableRef = RefObject<ScrollViewInstance | null> | { current: ScrollViewInstance | null };

type FieldRef = RefObject<FieldInstance | null> | { current: FieldInstance | null };

// The live inset a scrolled-to field must clear at the top of the scroll
// viewport: React Navigation's own current header height, which ALREADY
// includes the safe-area top inset — do not add a screen's own
// `useSafeAreaInsets().top` on top of it, that would double-count it. Unlike
// a fixed compact-header assumption, this tracks a COLLAPSING large-title
// header's true current height (see accounts.stack.tsx / home.stack.tsx's
// `headerLargeTitle: true`), so a near-top field never lands under a header
// band whose height was assumed smaller than the large title's real (still
// expanded, or partially so) height.
//
// Reads `HeaderHeightContext` directly rather than
// `@react-navigation/elements`'s own `useHeaderHeight()` wrapper, which
// THROWS when no header context is present. Every real caller
// (account-form, holding-form, transaction-form, contribution-form) renders
// under a real native-stack header, so the context is always there in the
// app — but each of those screens' own unit tests renders the bare screen
// component directly, with no navigator (and so no header) around it at all,
// and a throwing read would crash every one of those tests, not just a
// scroll-specific one. Degrading to `0` outside a header context mirrors the
// same choice `use-scroll-to-top-on-tab-press.ts` already makes for the same
// reason.
export const useHeaderInset = (): number => useContext(HeaderHeightContext) ?? 0;

// The three live signals a caller reads once, at Save-press time, from its
// own screen: the ScrollView's current content offset (reanimated's
// `useScrollOffset` on the same `useAnimatedRef` the caller already holds —
// see accounts.screen.tsx / statistics.screen.tsx for the established
// pattern), the live header inset (`useHeaderInset` above), and the
// ScrollView's own total content height — captured off its
// `onContentSizeChange` into a ref (see `Screen`'s own `onContentSizeChange`
// prop), so `resolveFieldScrollTarget` can bound an over-large target
// against the real content extent instead of letting it park past the end
// of the content.
type ScrollGeometry = {
  currentOffset: number;
  headerInset: number;
  contentHeight: number;
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
  contentHeight: number;
};

// Whether a scrolled-to field is already fully on-screen — between the
// collapsed header band at the top and the (keyboard-shrunk) visible bottom
// — and, when it is not, the exact content offset that lands its own top
// edge just below the header. A field ABOVE the visible area and one BELOW
// it (or under the keyboard) both resolve to the SAME landing rule: land the
// field's top just below the header, never at content top — never a
// "scroll the minimum distance" rule that would leave a field's top flush
// against the header on a downward scroll.
export const resolveFieldScrollTarget = (
  geometry: FieldScrollGeometry,
): { shouldScroll: boolean; targetOffset: number } => {
  const {
    fieldTop,
    fieldHeight,
    currentOffset,
    viewportHeight,
    keyboardHeight,
    headerInset,
    contentHeight,
  } = geometry;

  const visibleTop = currentOffset + headerInset;
  const visibleBottom = currentOffset + viewportHeight - keyboardHeight;
  const fieldBottom = fieldTop + fieldHeight;
  const isFullyVisible = fieldTop >= visibleTop && fieldBottom <= visibleBottom;

  if (isFullyVisible) {
    return { shouldScroll: false, targetOffset: currentOffset };
  }

  // THE LOWER BOUND — the POSITION-SCALING BUG: the landing target must
  // never floor at 0 — that is correct only for a plain,
  // non-inset ScrollView where "content top visible right below the header"
  // sits at offset 0. This app's scroll screens set
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
  // fail validation while `currentOffset` is deep into a long form).
  const lowerBound = -headerInset;

  // THE UPPER BOUND — the OVERSHOOT BUG: `Screen`'s ScrollView also sets
  // `scrollToOverflowEnabled`, which disables RN's own clamp on a
  // programmatic `scrollTo` — exactly what the lower (negative) bound above
  // needs to reach iOS verbatim, but the same disabled clamp means an
  // over-large target is never pulled back either. A raw
  // `fieldTop - headerInset` target that sits past the content's own true
  // bottom rest (`contentHeight - viewportHeight`) would scroll straight
  // past the last field into a void of empty background, with nothing (not
  // even the field) actually landing in view. `Math.max(..., lowerBound)`
  // keeps a form shorter than its own viewport (`contentHeight <
  // viewportHeight`, which would otherwise make this bound MORE negative
  // than the lower bound) from re-opening a floor already set above.
  const upperBound = Math.max(contentHeight - viewportHeight, lowerBound);

  const rawTarget = fieldTop - headerInset;

  return {
    shouldScroll: true,
    targetOffset: Math.min(Math.max(rawTarget, lowerBound), upperBound),
  };
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
          contentHeight: geometry.contentHeight,
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
