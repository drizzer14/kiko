import { fireEvent, render } from '@testing-library/react-native';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import type { RenderedElement } from '../../../test-support/rendered-element';
import '../../unistyles';
import { darkTheme } from '../../theme';

import BottomSheet from '.';
import { SHEET_DRAG_GESTURE_TEST_ID } from './bottom-sheet.component';

// The 66% cap is computed from the LIVE window height (`useWindowDimensions`),
// not a hardcoded pixel value, so it tracks rotation on device. Reading the
// same `Dimensions.get('window').height` RN reports under Jest keeps this
// assertion in lockstep with whatever the test environment's window height
// actually is, rather than baking in a number that could silently drift from
// the component's own source of truth.
const WINDOW_HEIGHT = Dimensions.get('window').height;
const MAX_HEIGHT_RATIO = 0.66;

// A device with a home indicator reports a non-zero bottom safe-area inset. The
// sheet renders inside a Modal (outside any SafeAreaView), so it must add that
// inset to its own bottom padding — this is the drift/A2 regression the shared
// primitive exists to prevent. Override the package's zero-inset global mock
// with a concrete inset so the padding assertion actually proves the inset is
// added (a zero inset would make "added" and "dropped" indistinguishable).
const MOCK_BOTTOM_INSET = 34;
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
  };
});

// The single base padding step the sheet keeps around its content (spacing(4)).
const SHEET_BASE_PADDING = 16;
const SHEET_TEST_ID = 'sheet-card';

describe('BottomSheet', () => {
  it('renders its children while visible', async () => {
    const { getByText } = await render(
      <BottomSheet visible onDismiss={jest.fn()}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByText('sheet body')).toBeTruthy();
  });

  it('renders nothing while not visible', async () => {
    const { queryByText } = await render(
      <BottomSheet visible={false} onDismiss={jest.fn()}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(queryByText('sheet body')).toBeNull();
  });

  it('dismisses when the scrim behind the sheet is tapped', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={onDismiss} backdropTestID="sheet-backdrop">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    fireEvent.press(getByTestId('sheet-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('owns the bottom safe-area inset on top of its single base padding step', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    // The sheet's bottom padding is the base step PLUS the home-indicator inset,
    // never one without the other (dropping the inset is bug A2; the base step
    // is what the four sheets previously drifted on, 4 vs 6 vs missing).
    expect(sheetStyle.paddingBottom).toBe(SHEET_BASE_PADDING + MOCK_BOTTOM_INSET);
    expect(sheetStyle.paddingTop).toBe(SHEET_BASE_PADDING);
    expect(sheetStyle.paddingHorizontal).toBe(SHEET_BASE_PADDING);
  });

  // The sheet is a grouped surface: its base is `sheetBackground` (one level
  // below the `surfaceHigh` cards/controls on it), never `surfaceHigh` itself —
  // that shared-tone blend is the on-device review the darker base fixes.
  it('paints the sheet in the grouped sheetBackground, not the surfaceHigh card tone', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    expect(sheetStyle.backgroundColor).toBe(darkTheme.colors.sheetBackground);
    expect(sheetStyle.backgroundColor).not.toBe(darkTheme.colors.surfaceHigh);
  });

  it('labels the scrim as a dismiss button when a backdrop label is given', async () => {
    const { getByLabelText } = await render(
      <BottomSheet visible onDismiss={jest.fn()} backdropAccessibilityLabel="Dismiss picker">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByLabelText('Dismiss picker').props.accessibilityRole).toBe('button');
  });

  // Every sheet caps at 66% of the window height BY DEFAULT — no per-call-site
  // prop needed — so a tall sheet always scrolls its own content instead of
  // growing past that point. This is the ONE shared owner for the cap; no
  // call site can loosen or drop it.
  it('caps every sheet at 66% of the window height by default', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    expect(sheetStyle.maxHeight).toBe(WINDOW_HEIGHT * MAX_HEIGHT_RATIO);
  });

  // A call site's own `maxHeight` can only TIGHTEN the cap further — it can
  // never loosen it past the shared 66% ceiling.
  it('honors a call-site maxHeight tighter than the 66% cap', async () => {
    const tighterCap = WINDOW_HEIGHT * 0.3;
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID} maxHeight={tighterCap}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    expect(sheetStyle.maxHeight).toBe(tighterCap);
  });

  // A call site's own `maxHeight` can never loosen the cap past 66%, even if
  // it explicitly requests more — this is the "reconcile to the 66% ceiling"
  // requirement: the icon picker and category-field sheets used to request
  // 80%/70% before this cap existed, both looser than 66%.
  it('clamps a call-site maxHeight looser than the 66% cap down to 66%', async () => {
    const looserCap = WINDOW_HEIGHT * 0.9;
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID} maxHeight={looserCap}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

    expect(sheetStyle.maxHeight).toBe(WINDOW_HEIGHT * MAX_HEIGHT_RATIO);
  });

  // The scrim is a frosted dim, not opaque black: `theme.colors.scrim` (a
  // translucent black), never the opaque `background` token. Jest always
  // exercises the non-liquid-glass fallback branch (`@callstack/liquid-glass`
  // is globally mocked with `isLiquidGlassSupported: false` — see
  // `jest/setup.js`), so this asserts the fallback `View`'s own dim; the real
  // `LiquidGlassView` blur branch only renders on an iOS 26+ device.
  it('dims the scrim with the translucent scrim token, never opaque black', async () => {
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} backdropTestID="sheet-backdrop">
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const backdropChildren = getByTestId('sheet-backdrop').props.children;
    const backdropChild = Array.isArray(backdropChildren) ? backdropChildren[0] : backdropChildren;
    const childStyle = StyleSheet.flatten(backdropChild.props.style);

    expect(childStyle.backgroundColor).toBe(darkTheme.colors.scrim);
    expect(childStyle.backgroundColor).not.toBe(darkTheme.colors.background);
  });

  // F5 device bug: the 66% cap above was forced on every sheet, but the
  // primitive rendered no scroll container of its own, so a plain-Box sheet
  // (filter-menu, date-field, the transaction-form category-override
  // confirm) whose content ran taller than the cap simply got CLIPPED, with
  // no way to reach its own lower rows. By default `children` now render
  // inside a `ScrollView` that actually shrinks to fit the capped sheet
  // (`flexShrink: 1`), so overflow scrolls instead of clipping.
  // @testing-library/react-native v14 dropped the UNSAFE_ByType queries, so
  // the ScrollView is identified by a derived testID (`${testID}-scroll`),
  // the same pattern GlassSurface's own sub-layer testIDs use.
  describe('scrollable (default true)', () => {
    it('wraps children in a ScrollView styled to shrink within the 66% cap', async () => {
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      const scrollView = getByTestId(`${SHEET_TEST_ID}-scroll`);
      const flat = StyleSheet.flatten(scrollView.props.style);

      expect(flat.flexShrink).toBe(1);
      // The sheet card lays out exactly two children in order: the top grabber
      // handle, then the ScrollView body. The sheet itself still never lays the
      // call site's children out directly — they live inside that ScrollView.
      const grabber = getByTestId(`${SHEET_TEST_ID}-grabber`);
      expect(getByTestId(SHEET_TEST_ID).children).toEqual([grabber, scrollView]);
    });

    it('applies the call-site gap to the ScrollView content container, not the sheet card', async () => {
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} gap={5} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      const scrollView = getByTestId(`${SHEET_TEST_ID}-scroll`);
      const contentFlat = StyleSheet.flatten(scrollView.props.contentContainerStyle);

      // theme.spacing(5) === 5 * 4.
      expect(contentFlat.gap).toBe(20);
    });
  });

  // The `scrollable={false}` opt-out: a sheet with a pinned header/footer/
  // ref-controlled scroll region (date-range-field's Apply/Clear row,
  // category-field's scroll-to-selected ref, icon-picker-modal's
  // Remove/Cancel header) owns its OWN inner ScrollView around just the part
  // that should scroll, so the primitive must render no ScrollView of its
  // own here — otherwise the two would nest on the same axis.
  describe('scrollable={false}', () => {
    it('renders no ScrollView of its own, so a call site can own one without nesting', async () => {
      const { queryByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} scrollable={false} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      expect(queryByTestId(`${SHEET_TEST_ID}-scroll`)).toBeNull();
    });

    it('still renders children directly, gapped, inside the capped sheet card', async () => {
      const { getByText } = await render(
        <BottomSheet visible onDismiss={jest.fn()} scrollable={false}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      expect(getByText('sheet body')).toBeTruthy();
    });
  });

  // The grabber handle + drag-down-to-close. The vertical Pan lives on the
  // grabber region only (never the scrollable body), and dismisses on a release
  // past ~25% of the sheet's measured height (or a fast downward flick). The
  // sheet's height reaches the gesture via onLayout, driven here directly.
  describe('grabber + drag-to-dismiss', () => {
    const DRAG_SHEET_ID = 'drag-sheet';
    // 25% of this height is the distance threshold the drag must pass (= 100).
    const SHEET_HEIGHT = 400;

    const layoutSheet = (node: RenderedElement): void => {
      fireEvent(node, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: SHEET_HEIGHT } },
      });
    };

    it('renders the grabber handle at the top of the sheet', async () => {
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} testID={DRAG_SHEET_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      expect(getByTestId(`${DRAG_SHEET_ID}-grabber`)).toBeTruthy();
    });

    it('dismisses when the grabber is dragged down past the threshold', async () => {
      const onDismiss = jest.fn();
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={onDismiss} testID={DRAG_SHEET_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      layoutSheet(getByTestId(DRAG_SHEET_ID));
      fireGestureHandler(getByGestureTestId(SHEET_DRAG_GESTURE_TEST_ID), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 150, velocityY: 0 },
        { state: State.END, translationY: 150, velocityY: 0 },
      ]);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not dismiss a small drag below the threshold — it springs back', async () => {
      const onDismiss = jest.fn();
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={onDismiss} testID={DRAG_SHEET_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      layoutSheet(getByTestId(DRAG_SHEET_ID));
      fireGestureHandler(getByGestureTestId(SHEET_DRAG_GESTURE_TEST_ID), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 20, velocityY: 0 },
        { state: State.END, translationY: 20, velocityY: 0 },
      ]);

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });
});
