import { Keyboard } from 'react-native';
import { createElement, type ReactNode } from 'react';
import type { ScrollViewInstance } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { HeaderHeightContext } from '@react-navigation/elements';

import {
  useHeaderInset,
  resolveFieldScrollTarget,
  scrollToField,
  type FieldInstance,
} from './scroll-to-field';

// Plain `createElement` (not JSX) — this module stays a `.ts` file, so JSX
// syntax is not parsed here.
const headerHeightWrapper =
  (value: number) =>
  ({ children }: { children: ReactNode }) =>
    createElement(HeaderHeightContext.Provider, { value }, children);

describe('useHeaderInset', () => {
  it('reads the live header height straight from HeaderHeightContext', async () => {
    const { result } = await renderHook(() => useHeaderInset(), {
      wrapper: headerHeightWrapper(140),
    });

    expect(result.current).toBe(140);
  });

  it('degrades to 0 outside a header context, rather than throwing like useHeaderHeight() would', async () => {
    const { result } = await renderHook(() => useHeaderInset());

    expect(result.current).toBe(0);
  });
});

describe('resolveFieldScrollTarget', () => {
  const base = {
    currentOffset: 0,
    viewportHeight: 800,
    keyboardHeight: 0,
    headerInset: 100,
    // Generously larger than every fixture below's fieldTop/fieldHeight, so
    // the overshoot clamp (see its own dedicated tests further down) never
    // engages here — these fixtures are about the lower-bound/visibility
    // arithmetic only.
    contentHeight: 2000,
  };

  it('does not scroll when the field is already fully visible below the header and above the keyboard', () => {
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 200, fieldHeight: 50 });

    expect(decision).toEqual({ shouldScroll: false, targetOffset: 0 });
  });

  it('scrolls when the field sits under the header band, landing it exactly at the header boundary', () => {
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 50, fieldHeight: 50 });

    // fieldTop(50) - headerInset(100) = -50: a legitimate NEGATIVE content
    // offset under `contentInsetAdjustmentBehavior="automatic"` (see the
    // clamp-floor doc below) — not floored to 0, which would strand the
    // field's top still inside the header band.
    expect(decision).toEqual({ shouldScroll: true, targetOffset: -50 });
  });

  it('scrolls when the field is occluded by the keyboard at the bottom', () => {
    const decision = resolveFieldScrollTarget({
      ...base,
      fieldTop: 750,
      fieldHeight: 50,
      keyboardHeight: 300,
    });

    expect(decision).toEqual({ shouldScroll: true, targetOffset: 650 });
  });

  it('lands the field just below the collapsed header, not at content top', () => {
    const decision = resolveFieldScrollTarget({
      ...base,
      currentOffset: 400,
      fieldTop: 1200,
      fieldHeight: 50,
    });

    expect(decision).toEqual({ shouldScroll: true, targetOffset: 1100 });
  });

  it('floors the landing target at -headerInset — the natural rest offset under automatic content-inset adjustment — never at 0', () => {
    // fieldTop(10) - headerInset(100) = -90, which is ABOVE the -100 floor,
    // so it passes through unclamped: -90, not 0.
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 10, fieldHeight: 20 });

    expect(decision.targetOffset).toBe(-90);
  });

  it('floors the landing target at exactly -headerInset for a field at the very top of the content', () => {
    // fieldTop(0) - headerInset(100) = -100, exactly the floor — the field's
    // content-position 0 lands exactly at the visible boundary, right below
    // the header, at rest.
    const decision = resolveFieldScrollTarget({ ...base, fieldTop: 0, fieldHeight: 20 });

    expect(decision.targetOffset).toBe(-100);
  });

  // THE POSITION-SCALING BUG: a clamp that floors a negative target at 0 is
  // only correct when `currentOffset` starts at 0.
  // `contentInsetAdjustmentBehavior="automatic"` (screen.component.tsx)
  // means the ScrollView's native resting offset for
  // "content top visible right below the header" is `-headerInset`, NOT 0 —
  // so flooring at 0 forces MORE scroll than a near-top field needs, landing
  // it back UNDER the header whenever the user was already scrolled down
  // (the common case: Save is a pinned footer button reachable from any
  // scroll position — see holding-form's `footer` — so a field near the TOP
  // of a long form is very often invalid while `currentOffset` is deep into
  // the form). This is a pure reference-frame/floor bug, not a
  // currentOffset-double-count bug.
  it('lands a near-top field below the header regardless of how far down the current scroll position is (position-scaling repro)', () => {
    const geometry = {
      fieldTop: 24,
      fieldHeight: 50,
      viewportHeight: 700,
      keyboardHeight: 0,
      headerInset: 103,
      contentHeight: 5000,
    };

    // The user is scrolled deep into a long form (e.g. filling later fields)
    // when Save rejects an early, near-top field.
    const decision = resolveFieldScrollTarget({ ...geometry, currentOffset: 900 });

    expect(decision.shouldScroll).toBe(true);
    // The field's own top must land AT OR BELOW the header boundary once
    // scrolled to `targetOffset` — i.e. `fieldTop >= targetOffset + headerInset`.
    // The buggy `Math.max(target, 0)` clamp produced `targetOffset = 0`, which
    // fails this: 24 >= 0 + 103 is false — the field stays hidden under the
    // header no matter how far down the scroll started.
    expect(decision.targetOffset + geometry.headerInset).toBeLessThanOrEqual(geometry.fieldTop);
  });

  it('lands the SAME near-top field correctly no matter the starting scroll position (top vs. bottom starting point)', () => {
    const geometry = {
      fieldTop: 24,
      fieldHeight: 50,
      viewportHeight: 700,
      keyboardHeight: 0,
      headerInset: 103,
      contentHeight: 5000,
    };

    const fromNearTop = resolveFieldScrollTarget({ ...geometry, currentOffset: 0 });
    const fromDeepScroll = resolveFieldScrollTarget({ ...geometry, currentOffset: 900 });

    // The target is a function of the field's own content position, never of
    // where the scroll started — so both starting points resolve to the
    // exact same landing offset.
    expect(fromNearTop.targetOffset).toBe(fromDeepScroll.targetOffset);
  });

  // THE UNDERSHOOT BUG: a fixed `COMPACT_HEADER_HEIGHT` (44) assumption is
  // only correct once a large-title header has fully collapsed. While the
  // large title is still expanded or mid-collapse, `HeaderHeightContext`
  // reports a genuinely TALLER live height (see accounts.stack.tsx /
  // home.stack.tsx's `headerLargeTitle: true`), and a scrolled-to field must
  // clear THAT taller band, not the fixed compact one.
  it('does not report a near-top field fully visible against the true (taller) live header height while the large title is mid-collapse', () => {
    // Mid-collapse: `currentOffset` sits inside the collapse range (between
    // the fully-expanded rest offset and the fully-collapsed 0).
    const currentOffset = -30;
    const liveHeaderInset = 100;

    const decision = resolveFieldScrollTarget({
      fieldTop: 60,
      fieldHeight: 40,
      currentOffset,
      viewportHeight: 800,
      keyboardHeight: 0,
      headerInset: liveHeaderInset,
      contentHeight: 2000,
    });

    // visibleTop = currentOffset(-30) + headerInset(100) = 70; the field's own
    // top (60) sits ABOVE that boundary, so it still needs to scroll — even
    // though a fixed 44pt assumption (`-30 + 44 = 14`, comfortably below
    // fieldTop) would have wrongly reported it already clear of the header.
    expect(decision.shouldScroll).toBe(true);
  });

  // THE OVERSHOOT BUG: `Screen`'s ScrollView sets `scrollToOverflowEnabled`,
  // which lets a programmatic scroll reach an arbitrary target with no native
  // clamp — including one past the content's own real bottom, which used to
  // park the view in an empty void with nothing (not even the field) on
  // screen.
  it('clamps an over-large target to the content’s own true bottom rest, never past the real content extent', () => {
    const geometry = {
      fieldTop: 5000,
      fieldHeight: 50,
      currentOffset: 0,
      viewportHeight: 800,
      keyboardHeight: 0,
      headerInset: 100,
      // The REAL total content height — far shorter than the raw target
      // (fieldTop - headerInset = 4900) would otherwise scroll to.
      contentHeight: 1200,
    };

    const decision = resolveFieldScrollTarget(geometry);

    expect(decision.shouldScroll).toBe(true);
    expect(decision.targetOffset).toBe(geometry.contentHeight - geometry.viewportHeight);
  });

  it('never lets the overshoot clamp re-open the lower bound for a form shorter than its own viewport', () => {
    // contentHeight(500) - viewportHeight(800) = -300, MORE negative than the
    // lower bound (-headerInset = -100) — the clamp must not let this widen
    // the allowed range past the lower bound already established above.
    const geometry = {
      fieldTop: 0,
      fieldHeight: 20,
      currentOffset: 0,
      viewportHeight: 800,
      keyboardHeight: 0,
      headerInset: 100,
      contentHeight: 500,
    };

    const decision = resolveFieldScrollTarget(geometry);

    expect(decision.targetOffset).toBe(-100);
  });
});

describe('scrollToField', () => {
  const geometry = { currentOffset: 0, headerInset: 60, contentHeight: 5000 };

  const mockScrollView = (viewportHeight: number, scrollTo = jest.fn()) => ({
    scrollTo,
    measure: jest.fn(
      (
        callback: (
          x: number,
          y: number,
          width: number,
          height: number,
          pageX: number,
          pageY: number,
        ) => void,
      ) => callback(0, 0, 375, viewportHeight, 0, 0),
    ),
  });

  const mockField = (fieldTop: number, fieldHeight: number) => ({
    measureLayout: jest.fn(
      (
        _relativeTo: unknown,
        onSuccess: (x: number, y: number, width: number, height: number) => void,
      ) => onSuccess(0, fieldTop, 300, fieldHeight),
    ),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('scrolls to just below the header when the field is off-screen', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const fieldRef = { current: mockField(1000, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).toHaveBeenCalledWith({ y: 940, animated: true });
  });

  it('does not scroll when the field is already fully visible', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('subtracts the live keyboard height from the visible area', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    // Fully visible against the bare viewport, but occluded once a 300pt
    // keyboard is up.
    const fieldRef = { current: mockField(700, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue({
      screenX: 0,
      screenY: 500,
      width: 375,
      height: 300,
    });

    scrollToField(scrollableRef, fieldRef, geometry);

    expect(scrollTo).toHaveBeenCalledWith({ y: 640, animated: true });
  });

  it('calls onSettled once positioning resolves, whether or not it scrolled', () => {
    const scrollableRef = { current: mockScrollView(800) as unknown as ScrollViewInstance };
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined);
    const onSettled = jest.fn();

    scrollToField(scrollableRef, fieldRef, geometry, onSettled);

    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the scroll view ref is not yet attached', () => {
    const fieldRef = { current: mockField(200, 50) as unknown as FieldInstance };
    const onSettled = jest.fn();

    expect(() => scrollToField({ current: null }, fieldRef, geometry, onSettled)).not.toThrow();
    expect(fieldRef.current?.measureLayout).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('no-ops when the field ref is not yet attached', () => {
    const scrollTo = jest.fn();
    const scrollableRef = {
      current: mockScrollView(800, scrollTo) as unknown as ScrollViewInstance,
    };
    const onSettled = jest.fn();

    expect(() =>
      scrollToField(scrollableRef, { current: null }, geometry, onSettled),
    ).not.toThrow();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('does not throw, and does not settle, when measureLayout reports failure', () => {
    const measureLayout = jest.fn((_relativeTo, _onSuccess, onFail: () => void) => onFail());
    const scrollableRef = { current: mockScrollView(800) as unknown as ScrollViewInstance };
    const fieldRef = { current: { measureLayout } as unknown as FieldInstance };
    const onSettled = jest.fn();

    expect(() => scrollToField(scrollableRef, fieldRef, geometry, onSettled)).not.toThrow();
    expect(onSettled).not.toHaveBeenCalled();
  });
});
