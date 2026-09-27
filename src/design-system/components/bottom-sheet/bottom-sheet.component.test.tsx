import type { ReactElement } from 'react';
import { State } from 'react-native-gesture-handler';
import { Dimensions, Keyboard, StyleSheet, Text } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import type { RenderedElement } from '@kiko/test-support/rendered-element';

import { KEYBOARD_ACCESSORY_HEIGHT } from '../keyboard-done-accessory';

import BottomSheet from '.';
import { KEYBOARD_CORNER_OVERLAP, SHEET_DRAG_GESTURE_TEST_ID } from './bottom-sheet.component';

// The global jest/setup.js mock renders LiquidGlassView as a plain View and
// pins `isLiquidGlassSupported` to false (the non-glass fallback path). This
// file-level mock keeps the same default so every existing fallback-branch
// test is unchanged, but exposes the flag as a MUTABLE property (the same
// pattern `glass-surface.component.test.tsx` uses) so the glass-capable
// describe block below can flip it on for its own scope.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');

  return { LiquidGlassView: View, isLiquidGlassSupported: false };
});

const liquidGlass = jest.requireMock('@callstack/liquid-glass') as {
  isLiquidGlassSupported: boolean;
};

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

    await fireEvent.press(getByTestId('sheet-backdrop'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  // A real completion signal for "the sheet has actually finished closing" —
  // RN `Modal`'s own `onDismiss` (iOS only; fires once the dismiss ANIMATION
  // has finished, unlike `onDismiss`/`onRequestClose` above, which mean "a
  // dismiss was requested"). Passed through as its own optional prop so a
  // caller that needs to run something ONLY after the close animation
  // completes (e.g. navigating away) doesn't have to guess a delay.
  it('calls onClosed when the underlying Modal reports its own dismiss (the close animation finished)', async () => {
    const onClosed = jest.fn();
    const { getByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} onClosed={onClosed} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    await fireEvent(getByTestId(`${SHEET_TEST_ID}-modal`), 'dismiss');

    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('does not require onClosed — every other caller stays unaffected', async () => {
    const { getByText } = await render(
      <BottomSheet visible onDismiss={jest.fn()}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByText('sheet body')).toBeTruthy();
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
    expect(sheetStyle.paddingHorizontal).toBe(SHEET_BASE_PADDING);

    // The sheet card's own top inset no longer lives here: it moved INTO the
    // draggable grabber region below (see the "extends the drag region up to
    // the card's top edge" test), so the card itself carries none.
    expect(sheetStyle.paddingTop).toBeUndefined();

    // The base step that used to sit on the card now sits on the grabber
    // region instead, so the whole band from the card's rounded top edge down
    // through the pill is inside the one draggable hit area.
    const grabberStyle = StyleSheet.flatten(getByTestId(`${SHEET_TEST_ID}-grabber`).props.style);
    expect(grabberStyle.paddingTop).toBe(SHEET_BASE_PADDING);
  });

  // The sheet card's own background is a real translucent blur MATERIAL,
  // reusing `GlassSurface`'s `material` variant rather than a flat
  // `backgroundColor` on the card itself — see `bottom-sheet.component.tsx`'s
  // doc comment and `styles.glassFill`. This describe block always exercises
  // the non-liquid-glass FALLBACK branch (`@callstack/liquid-glass` defaults
  // to `isLiquidGlassSupported: false` above), so `GlassSurface`'s own
  // `-base` sublayer is the flat `View` that paints the `material` variant's
  // translucent fallback fill; the glass-capable describe block below covers
  // the real live-blur branch instead.
  it('renders the sheet card background through GlassSurface, translucent on the non-glass fallback', async () => {
    const { getByTestId, queryByTestId } = await render(
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    const glass = getByTestId(`${SHEET_TEST_ID}-glass`);
    // `padding={0}` is the ONE inset for this layer — the card's own existing
    // padding (`styles.sheet`) stays the single source, never stacked with a
    // second one from `GlassSurface` itself. `GlassSurface` only writes a
    // `padding` style member when its own `padding` prop is defined, so
    // finding it present (and zero) on the rendered node confirms `0`, not
    // `undefined`, was actually passed through.
    const glassStyle = StyleSheet.flatten(glass.props.style);
    expect(glassStyle.padding).toBe(0);

    // No backdrop layer exists on the fallback path at all (see
    // `glass-surface.component.tsx`'s comment: "The fallback (non-glass)
    // branch needs no backdrop: its own base IS the flat themed fill") —
    // this is what a translucent, never-muted fallback looks like.
    expect(queryByTestId(`${SHEET_TEST_ID}-glass-backdrop`)).toBeNull();

    const glassBaseStyle = StyleSheet.flatten(
      getByTestId(`${SHEET_TEST_ID}-glass-base`).props.style,
    );
    expect(glassBaseStyle.backgroundColor).toBe(darkTheme.colors.surfaceTranslucent);
    expect(glassBaseStyle.backgroundColor).not.toBe(darkTheme.colors.surfaceHigh);

    // A tinted entity-card background never applies to a sheet, and the
    // panel carries no color wash — it stays a neutral frosted panel.
    expect(queryByTestId(`${SHEET_TEST_ID}-glass-wash`)).toBeNull();
  });

  // The real Liquid Glass branch (isLiquidGlassSupported === true), which the
  // fallback-only tests above never reach. This is the item-2 fix itself: on
  // iOS 26+ the sheet's glass must sample the LIVE content behind it (no
  // color-pinning backdrop layer under it), so it reads as a real translucent
  // blur instead of the near-opaque dark panel the old `transparent` variant
  // produced there.
  describe('on liquid-glass-capable iOS', () => {
    beforeEach(() => {
      liquidGlass.isLiquidGlassSupported = true;
    });
    afterEach(() => {
      liquidGlass.isLiquidGlassSupported = false;
    });

    it('renders the live glass material with no muting backdrop underneath it', async () => {
      const { getByTestId, queryByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      // `material`'s whole point: unlike `transparent` (which paints a
      // translucent `surfaceTranslucent` backdrop UNDER the glass to
      // partially pin the sample), this variant adds NO backdrop layer at
      // all on the glass path, so the glass material samples the actual
      // live content behind the sheet.
      expect(queryByTestId(`${SHEET_TEST_ID}-glass-backdrop`)).toBeNull();

      // The glass base itself carries no fixed color either (no `tintColor`
      // pinning it, the same as a plain, tint-less GlassSurface) — it is the
      // live-sampling material, not a color-pinned fill.
      const glassBase = getByTestId(`${SHEET_TEST_ID}-glass-base`);
      expect(glassBase.props.tintColor).toBeUndefined();

      expect(queryByTestId(`${SHEET_TEST_ID}-glass-wash`)).toBeNull();
    });

    // The sheet's glass also takes `bloom` (the app-wide rollout). Since
    // `material` already renders no backdrop, the only change here is the
    // native effect switching from `'regular'` to `'clear'` — Apple's more
    // transparent, less legibility-biased material.
    it('switches the native glass to the clear style with bloom applied', async () => {
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      expect(getByTestId(`${SHEET_TEST_ID}-glass-base`).props.effect).toBe('clear');
    });
  });

  // The scrim, grabber, and children all still render once the card routes
  // its background through `GlassSurface` — the glass layer is an added
  // background sibling, not a replacement for any of the sheet's existing
  // structure.
  it('still renders the scrim, the grabber, and the children alongside the glass background', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, getByText } = await render(
      <BottomSheet
        visible
        onDismiss={onDismiss}
        testID={SHEET_TEST_ID}
        backdropTestID="sheet-backdrop"
      >
        <Text>sheet body</Text>
      </BottomSheet>,
    );

    expect(getByTestId('sheet-backdrop')).toBeTruthy();
    expect(getByTestId(`${SHEET_TEST_ID}-grabber`)).toBeTruthy();
    expect(getByText('sheet body')).toBeTruthy();

    // The glass background paints BEHIND the grabber and body — it is the
    // first child of the sheet card, in render order.
    const glass = getByTestId(`${SHEET_TEST_ID}-glass`);
    const grabber = getByTestId(`${SHEET_TEST_ID}-grabber`);
    const scrollView = getByTestId(`${SHEET_TEST_ID}-scroll`);
    expect(getByTestId(SHEET_TEST_ID).children).toEqual([glass, grabber, scrollView]);
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

  // The 66% cap above was forced on every sheet, but the
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
      // The sheet card lays out exactly three children in order: the glass
      // background, the top grabber handle, then the ScrollView body. The
      // sheet itself still never lays the call site's children out directly —
      // they live inside that ScrollView.
      const glass = getByTestId(`${SHEET_TEST_ID}-glass`);
      const grabber = getByTestId(`${SHEET_TEST_ID}-grabber`);
      expect(getByTestId(SHEET_TEST_ID).children).toEqual([glass, grabber, scrollView]);
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

  // DEVICE BUG fix: a `KeyboardAvoidingView` wrapping the sheet's OWN body
  // (attempt B) had ZERO effect on device — a KAV repositions its subtree
  // within its PARENT's layout, but this sheet's parent is the Modal's own
  // transparent root, which never resizes for the keyboard. The real fix
  // lifts the CARD itself, driven by RN core `Keyboard` events (not
  // reanimated's own `useAnimatedKeyboard`, whose native observer crashes
  // under this app's iOS UIScene lifecycle — see `bottom-sheet.component.tsx`'s
  // CRASH fix comment): the live height feeds both the card's own
  // `translateY` (so it rises clear of the keyboard) and a shrunk ratio cap
  // (`resolveKeyboardAwareMaxHeight`, unit-tested on its own in
  // `bottom-sheet.keyboard.test.ts`), so a shrinking search-result list still
  // fits entirely above the keyboard rather than merely sliding upward while
  // capped against the full, keyboard-occluded window height.
  describe('keyboard-aware lift', () => {
    // Captures the handler each `Keyboard.addListener` call registers, keyed
    // by event name, so a test can simulate a native keyboard notification by
    // invoking it directly — the same "spy on the real RN module" approach as
    // driving the gesture handler above, since RN ships no keyboard-event
    // test utility of its own.
    let addListenerSpy: jest.SpyInstance;
    const listeners = new Map<string, (event: unknown) => void>();

    beforeEach(() => {
      listeners.clear();
      addListenerSpy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((
        eventType: string,
        handler: (event: unknown) => void,
      ) => {
        listeners.set(eventType, handler);

        return { remove: jest.fn() };
      }) as typeof Keyboard.addListener);
    });

    afterEach(() => {
      addListenerSpy.mockRestore();
    });

    it('is a no-op with no keyboard shown — no translateY offset, and the plain 66% ratio cap', async () => {
      const { getByTestId } = await render(
        <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

      expect(sheetStyle.transform).toEqual([{ translateY: 0 }]);
      expect(sheetStyle.maxHeight).toBe(WINDOW_HEIGHT * MAX_HEIGHT_RATIO);
    });

    // A fresh element per call (never the SAME element object reused across
    // `render`/`rerender`) — reusing one referentially-identical element lets
    // the renderer bail out of re-invoking the function component entirely,
    // which would never pick up the mutation the listener just wrote to the
    // shared value.
    const renderSheet = (): ReactElement => (
      <BottomSheet visible onDismiss={jest.fn()} testID={SHEET_TEST_ID}>
        <Text>sheet body</Text>
      </BottomSheet>
    );

    // `KEYBOARD_CORNER_OVERLAP` folds into the same "accessory height" as an
    // extra amount subtracted from the lift (and added to the padding, in the
    // next test): the sheet's glass extends this far PAST the top of the keys
    // to cover the keyboard's own rounded top corners (device bug — small
    // black notches where the sheet's flat corner met the keyboard's curve).
    const EFFECTIVE_ACCESSORY_HEIGHT = KEYBOARD_ACCESSORY_HEIGHT + KEYBOARD_CORNER_OVERLAP;

    it('lifts the card by the keyboard height MINUS the effective accessory height, and shrinks the ratio cap to match', async () => {
      const { getByTestId, rerender } = await render(renderSheet());

      const keyboardHeight = 250;
      const expectedLift = keyboardHeight - EFFECTIVE_ACCESSORY_HEIGHT;
      const willChangeFrame = listeners.get('keyboardWillChangeFrame');
      expect(willChangeFrame).toBeDefined();
      willChangeFrame?.({
        endCoordinates: { screenY: WINDOW_HEIGHT - keyboardHeight },
        duration: 250,
      });
      // The mock `useAnimatedStyle` (unlike the real, worklet-driven one) only
      // re-evaluates its factory on a React render pass, not on a bare shared
      // value mutation — see `jest/reanimated-mock.js` — so force one here to
      // pick up the height the listener just wrote.
      await rerender(renderSheet());

      const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

      // `endCoordinates` includes the keyboard's own `InputAccessoryView` (the
      // floating "Done" pill strip) sitting above the real keys — lifting by
      // the FULL keyboard height would land the sheet's bottom edge at the
      // TOP of that strip instead of the top of the keys, leaving the strip's
      // transparent container over the dark modal scrim (the black-band bug,
      // builds 17/18). See `resolveKeyboardLift`.
      expect(sheetStyle.transform).toEqual([{ translateY: -expectedLift }]);
      expect(sheetStyle.maxHeight).toBe((WINDOW_HEIGHT - expectedLift) * MAX_HEIGHT_RATIO);
    });

    // VISUAL fix (build 19): build 18 dropped the bottom safe-area inset,
    // leaving only the base padding step — the wrong direction. The sheet's
    // bottom edge now lands at the BOTTOM of the accessory strip
    // (`resolveKeyboardLift`), so the strip's own height sits BEHIND the
    // sheet's last content row. Padding set to the FULL accessory height
    // (first pass) still read wrong on device: every sheet's content ALSO
    // carries its own fixed `CONTENT_BOTTOM_PADDING_STEP` buffer (the SAME
    // `SHEET_PADDING_STEP` token as `SHEET_BASE_PADDING` here) beneath its
    // last row, which stacks UNDER this outer padding — subtracting it here
    // cancels that stack so the two together total exactly the (effective)
    // accessory height, landing the content flush with the strip's own top
    // edge (see `resolveKeyboardAwareBottomPadding`'s own doc for the full
    // gap-symmetry reasoning). `KEYBOARD_CORNER_OVERLAP` on top of the base
    // accessory height keeps the corner-notch fix (previous test) from
    // shifting the content's own position at all.
    it('grows the sheet padding to the effective accessory height minus the base step while the keyboard is shown', async () => {
      const { getByTestId, rerender } = await render(renderSheet());

      listeners.get('keyboardWillChangeFrame')?.({
        endCoordinates: { screenY: WINDOW_HEIGHT - 250 },
        duration: 250,
      });
      await rerender(renderSheet());

      const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

      expect(sheetStyle.paddingBottom).toBe(EFFECTIVE_ACCESSORY_HEIGHT - SHEET_BASE_PADDING);
    });

    it('resets the lift back to zero when the keyboard hides', async () => {
      const { getByTestId, rerender } = await render(renderSheet());

      listeners.get('keyboardWillChangeFrame')?.({
        endCoordinates: { screenY: WINDOW_HEIGHT - 250 },
        duration: 250,
      });
      listeners.get('keyboardWillHide')?.({});
      await rerender(renderSheet());

      const sheetStyle = StyleSheet.flatten(getByTestId(SHEET_TEST_ID).props.style);

      expect(sheetStyle.transform).toEqual([{ translateY: 0 }]);
      expect(sheetStyle.maxHeight).toBe(WINDOW_HEIGHT * MAX_HEIGHT_RATIO);
      expect(sheetStyle.paddingBottom).toBe(SHEET_BASE_PADDING + MOCK_BOTTOM_INSET);
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

  // The optional `header` slot: a header node renders INSIDE the same draggable
  // grabber region as the pill, so a drag anywhere across the header — not just
  // the small handle — drives the dismiss, while the body's own ScrollView stays
  // a separate sibling and keeps scrolling freely. A sheet that passes no
  // `header` (every case above) keeps its exact grabber-only region unchanged.
  describe('header slot', () => {
    const HEADER_SHEET_ID = 'header-sheet';
    // 25% of this height is the distance threshold the drag must pass (= 100).
    const SHEET_HEIGHT = 400;

    it('renders the header inside the draggable grabber region, above the body', async () => {
      const { getByTestId } = await render(
        <BottomSheet
          visible
          onDismiss={jest.fn()}
          testID={HEADER_SHEET_ID}
          header={<Text>sheet header</Text>}
        >
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      // The header sits under the SAME `-grabber` region the Pan is attached to
      // (the grabber pill on top, then the header), so a drag across it dismisses.
      const grabberRegion = getByTestId(`${HEADER_SHEET_ID}-grabber`);
      expect(within(grabberRegion).getByText('sheet header')).toBeTruthy();

      // The body's ScrollView is a SEPARATE sibling of that region, not nested
      // inside it — so the Pan never competes with the body's own scroll.
      const scrollView = getByTestId(`${HEADER_SHEET_ID}-scroll`);
      expect(within(grabberRegion).queryByTestId(`${HEADER_SHEET_ID}-scroll`)).toBeNull();
      expect(within(scrollView).getByText('sheet body')).toBeTruthy();
    });

    // The gap below a header band is a single named token (`TITLE_TO_BODY_GAP_STEP`
    // in bottom-sheet.styles.ts), not a bare per-sheet magic number — every
    // migrated sheet's title now reads its title-to-body breathing room from
    // here. The region's OWN top padding is the sheet card's former base step,
    // moved here so the draggable band reaches the card's rounded top edge
    // instead of stopping short of it (see the "owns the bottom safe-area
    // inset" test above, which pins the same paddingTop value on a headerless
    // sheet).
    it('gives the header band the single title-to-body gap token, and extends the drag region to the card top edge', async () => {
      const { getByTestId } = await render(
        <BottomSheet
          visible
          onDismiss={jest.fn()}
          testID={HEADER_SHEET_ID}
          header={<Text>sheet header</Text>}
        >
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      const grabberStyle = StyleSheet.flatten(
        getByTestId(`${HEADER_SHEET_ID}-grabber`).props.style,
      );

      // theme.spacing(4) === 4 * 4 = 16.
      expect(grabberStyle.paddingBottom).toBe(16);
      expect(grabberStyle.paddingTop).toBe(SHEET_BASE_PADDING);
    });

    it('still dismisses on a drag past the threshold when a header is present', async () => {
      const onDismiss = jest.fn();
      const { getByTestId } = await render(
        <BottomSheet
          visible
          onDismiss={onDismiss}
          testID={HEADER_SHEET_ID}
          header={<Text>sheet header</Text>}
        >
          <Text>sheet body</Text>
        </BottomSheet>,
      );

      fireEvent(getByTestId(HEADER_SHEET_ID), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: SHEET_HEIGHT } },
      });
      fireGestureHandler(getByGestureTestId(SHEET_DRAG_GESTURE_TEST_ID), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 150, velocityY: 0 },
        { state: State.END, translationY: 150, velocityY: 0 },
      ]);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
