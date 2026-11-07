import {
  registerLightThemeFirst,
  restoreThemeOrder,
} from '@kiko/test-support/light-theme-registered';
import { type ComponentProps, useContext } from 'react';
import { HeaderHeightContext } from '@react-navigation/elements';
import { darkTheme, lightTheme } from '@kiko/design-system/theme';
import { FieldBlurContext } from '@kiko/design-system/field-blur';
import type { RenderedElement } from '@kiko/test-support/rendered-element';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useFloatingFooterEnd, useIsInFloatingFooter } from '@kiko/design-system/floating-footer';
import '@kiko/design-system/unistyles';
import { REGULAR_BUTTON_HEIGHT } from '@kiko/design-system/regular-button-height';
import { LargeTitleHeadingContext } from '@kiko/design-system/components/large-title-heading';

// Imported through the folder's index (the real path a screen consumes,
// `design-system/components/screen`), not `./screen.component` directly, so
// this test also exercises index.ts's re-export.
import Screen from '.';

// The Screen footer lifts itself clear of the floating native tab bar by the
// bar's measured height. The real hook throws outside a native bottom-tab
// scene, so stub it with a deterministic height the clearance test asserts
// against (the global manual mock returns 0, which would make the assertion
// indistinguishable from "no clearance applied").
const MOCK_TAB_BAR_HEIGHT = 80;
// A mutable `jest.fn()` wrapper (not a plain arrow factory) so the dedicated
// "Duo vertical bar" cases at the end of this file can override it per test
// and restore it afterwards — every other test here never touches it, so it
// keeps returning this exact default throughout.
const mockUseBottomTabBarHeight = jest.fn(() => MOCK_TAB_BAR_HEIGHT);
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => mockUseBottomTabBarHeight(),
}));

// The system's own vertical-bar trait, in place of any geometry guess. Every
// test here but the "Duo vertical bar" cases sees `none`, an ordinary bottom bar.
const mockUseVerticalBarEdge = jest.fn((): 'leading' | 'trailing' | 'none' => 'none');
// An unknown native edge keeps today's rule, which every case but the top-bar ones pins.
const mockUseTabBarEdge = jest.fn((): 'top' | 'bottom' | 'leading' | 'trailing' | 'none' => 'none');
const mockHorizontalSizeClass = jest.fn((): 'compact' | 'regular' => 'compact');
jest.mock('@kiko/display-regions', () => ({
  useVerticalBarEdge: () => mockUseVerticalBarEdge(),
  useTabBarEdge: () => mockUseTabBarEdge(),
  // The content cap reads the layout mode and the size class: a compact single window, as on an
  // iPhone, caps nothing.
  useLayoutMode: () => 'single',
  useDisplayRegions: () => ({ horizontalSizeClass: mockHorizontalSizeClass() }),
}));

// A device with a home indicator reports a non-zero bottom safe-area inset.
// The measured tab-bar height (`UITabBar.frame.size.height`) already spans that
// inset — the bar's background extends to the screen's true bottom edge — so
// the footer's OWN clearance must add only the amount by which the tab bar
// EXCEEDS the inset, not the tab bar's full height, or `screen.styles.ts`'s
// `bottomClearance` param double-counts the inset a second time (see
// `screen.component.tsx`). Override the package's zero-inset global mock with a
// concrete bottom inset so this file's clearance assertions prove the inset is
// not double-counted (with a zero inset the two formulas are indistinguishable,
// which is exactly why the earlier over-padding shipped unnoticed).
const MOCK_BOTTOM_INSET = 34;
// Same mutable-wrapper treatment as `mockUseBottomTabBarHeight` above, for
// the same reason.
const mockUseSafeAreaInsets = jest.fn(() => ({
  top: 0,
  right: 0,
  bottom: MOCK_BOTTOM_INSET,
  left: 0,
}));
// A trimmed stand-in for the real `SafeAreaView`: the real native layout
// (`RNCSafeAreaViewShadowNode`'s `'additive'` edge mode) adds `insets.bottom`
// as real padding directly on the `SafeAreaView` itself, for every edge
// marked additive — every edge, by default, when the plain branch omits an
// `edges` prop, or just the edges named in the scroll branch's explicit list
// (see `screen.component.tsx`'s `SCROLL_SAFE_AREA_EDGES`, which names
// `'bottom'`). Reproducing that ONE behavior — not the rest of the native
// component — is what lets this file's "no double count" assertions below
// actually fail if `Screen` ever regresses: a bare `View` (the prior mock)
// silently swallows the `edges` prop and adds no padding, which is exactly
// how that regression shipped unnoticed. Defined inline in the factory
// (rather than as a module-level const the factory closes over) because
// `jest.mock` factories are hoisted above every other top-level statement —
// only identifiers named `mock*` may be referenced from outside one.
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  const mockSafeAreaView = ({
    style,
    ...props
  }: {
    edges?: readonly string[];
    style?: unknown;
    [key: string]: unknown;
  }) => {
    // `edges` is forwarded onto the rendered element (not destructured away) so
    // a test can read which edges `Screen` asked the SafeAreaView to reserve —
    // e.g. that the plain branch DROPS `'top'` under `bleedTop` so a large-title
    // header owns the top inset (see the `bleedTop` tests below).
    const edges = props.edges as readonly string[] | undefined;
    const reservesBottomInset = edges === undefined || edges.includes('bottom');

    return (
      <View
        {...props}
        style={reservesBottomInset ? [style, { paddingBottom: MOCK_BOTTOM_INSET }] : style}
      />
    );
  };

  return {
    SafeAreaView: mockSafeAreaView,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => mockUseSafeAreaInsets(),
  };
});

// @testing-library/react-native v14 dropped the UNSAFE_ByType queries, so the
// only way to tell a ScrollView root from a plain View root is a testID —
// same pattern MoneyText's own test uses to probe an internal render
// decision (see money-text.component.test.tsx).
const SCROLL_VIEW_TEST_ID = 'screen-scroll-view';
const FOOTER_TEST_ID = 'screen-footer';
const CONTENT_TEST_ID = 'screen-content';
// The breathing-room gap a footer (or a content edge that owns the true bottom)
// keeps above the floating tab bar, added on top of `BOTTOM_CLEARANCE` below.
// It now MATCHES the footer button's own top margin (the footer slot's
// `paddingTop: theme.spacing(4)` = 16) so the button sits symmetrically — the
// same gap above it (content → button) and below it (button → tab bar).
const FOOTER_GAP = 16;
// The `bottomClearance` value `screen.component.tsx` computes and passes into
// `footer`/`content`'s style functions: the tab-bar height MINUS the bottom
// safe-area inset the enclosing (mocked) `SafeAreaView` already reserves as
// its OWN padding above — not the tab-bar height alone, or the two would
// double-count the inset (see the mock's own comment above).
const BOTTOM_CLEARANCE = Math.max(MOCK_TAB_BAR_HEIGHT - MOCK_BOTTOM_INSET, 0);
// When a footer or a bleedBottom child owns the true bottom edge instead, the
// plain content keeps only its own internal base padding (spacing(4) = 16),
// with no tab-bar clearance — the sibling/child reserves that.
const CONTENT_BASE_PADDING = 16;

// The footer/content `View`'s bottom padding only accounts for its own share
// of the clearance (`BOTTOM_CLEARANCE`) — the rest lives one level up, as real
// padding the mocked `SafeAreaView` adds on its immediate child (see the mock
// above). Summing both is the only way to assert the TOTAL gap between the
// button and the tab bar's top edge without hard-coding how `Screen` chooses
// to split that responsibility between the two.
// `paddingBottom` is a `DimensionValue`, so it can legitimately be a percentage
// string or absent; only a real number contributes to the summed gap these
// tests assert on.
const bottomPaddingOf = (style: StyleProp<ViewStyle>): number => {
  const flattened = StyleSheet.flatten(style);

  return typeof flattened?.paddingBottom === 'number' ? flattened.paddingBottom : 0;
};

const totalBottomOffset = (edgeElement: RenderedElement): number =>
  bottomPaddingOf(edgeElement.props.style) + bottomPaddingOf(edgeElement.parent?.props.style);

// Every case below renders the same `<Screen>` wrapping a single `content`
// child (plus a `footer content` child when the case passes a `footer` prop),
// varying only the Screen props under test — so the render itself is the ONE
// duplicated block across the suite. Extracted here so each `it` differs only
// in the props it exercises and the assertion it makes, not in boilerplate.
const renderScreen = (props: ComponentProps<typeof Screen> = {}) =>
  render(
    <Screen {...props}>
      <Text>content</Text>
    </Screen>,
  );

// The footer node the footer-slot cases pass — a plain labelled child so the
// assertions can locate it by text inside the footer view. Named `footerNode`
// so it does not collide with the local `footer` element several cases resolve
// from `getByTestId(FOOTER_TEST_ID)`.
const footerNode = <Text>footer content</Text>;

describe('Screen', () => {
  it('renders children in a plain (non-scrolling) View by default', async () => {
    const { getByText, queryByTestId } = await renderScreen();

    expect(getByText('content')).toBeTruthy();
    expect(queryByTestId(SCROLL_VIEW_TEST_ID)).toBeNull();
  });

  it('renders children inside a ScrollView with automatic inset adjustment when scroll is set', async () => {
    const { getByText, getByTestId } = await renderScreen({ scroll: true });

    expect(getByText('content')).toBeTruthy();
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('adjusts the ScrollView content inset for the keyboard so a focused input scrolls clear of it (and the Done accessory)', async () => {
    const { getByTestId } = await renderScreen({ scroll: true });

    // iOS-only UIScrollView prop: when the keyboard changes size, iOS adjusts
    // this scroll view's contentInset/scrollIndicatorInsets and scrolls the
    // first responder above the keyboard. The Done accessory's height is part
    // of the native keyboard frame on iOS, so this clears both at once — the
    // whole shared auto-scroll-to-focus feature. Harmlessly ignored on Android.
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('defaults automaticallyAdjustKeyboardInsets to true so a focused input scrolls clear of the keyboard', async () => {
    const { getByTestId } = await renderScreen({ scroll: true });

    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.automaticallyAdjustKeyboardInsets).toBe(true);
  });

  it('forwards automaticallyAdjustKeyboardInsets={false} so a caller can suspend it while a sheet above it can be focused', async () => {
    const { getByTestId } = await renderScreen({
      scroll: true,
      automaticallyAdjustKeyboardInsets: false,
    });

    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.automaticallyAdjustKeyboardInsets).toBe(false);
  });

  it('enables scrollToOverflow so a programmatic scroll-to-top re-expands the large title', async () => {
    const { getByTestId } = await renderScreen({ scroll: true });

    // Fabric clamps a negative programmatic `scrollTo` y to 0 while
    // `contentInsetAdjustmentBehavior="automatic"` keeps the large-title band
    // in `adjustedContentInset.top` (leaving `contentInset.top` at 0), so a
    // scroll-to-top target never re-expands the collapsed title. This prop
    // bypasses that clamp (see `use-scroll-to-top-on-tab-press.ts`).
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.scrollToOverflowEnabled).toBe(true);
  });

  it('keeps the keyboard up so a tap on a child focuses on the first tap, not the second', async () => {
    const { getByTestId } = await renderScreen({ scroll: true });

    // Default keyboardShouldPersistTaps is "never", which consumes the first
    // tap to dismiss the keyboard so a focused-input-to-another-input tap needs
    // a second tap. "handled" fires the child's onPress/focus on the first tap
    // while still dismissing the keyboard on taps to inert areas.
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.keyboardShouldPersistTaps).toBe('handled');
  });

  describe('onFieldBlur', () => {
    const received: { current: (() => void) | undefined } = { current: undefined };

    const Probe = () => {
      received.current = useContext(FieldBlurContext);

      return null;
    };

    beforeEach(() => {
      received.current = undefined;
    });

    it.each([
      ['scroll', { scroll: true }],
      ['plain', {}],
      ['bleedTop', { bleedTop: true }],
    ])('hands it to the fields inside the %s layout', async (_layout, layoutProps) => {
      const onFieldBlur = jest.fn();

      await render(
        <Screen {...layoutProps} onFieldBlur={onFieldBlur}>
          <Probe />
        </Screen>,
      );

      expect(received.current).toBe(onFieldBlur);
    });

    it('leaves the fields with no listener when it is omitted', async () => {
      await render(
        <Screen scroll>
          <Probe />
        </Screen>,
      );

      expect(received.current).toBeUndefined();
    });
  });

  it('renders a footer outside the ScrollView when scroll and footer are set', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const scrollView = getByTestId(SCROLL_VIEW_TEST_ID);
    const footer = getByTestId(FOOTER_TEST_ID);

    expect(within(scrollView).queryByText('content')).toBeTruthy();
    expect(within(scrollView).queryByText('footer content')).toBeNull();
    expect(within(footer).queryByText('footer content')).toBeTruthy();
  });

  it('pads the footer clear of the floating tab bar by its own share of the clearance', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    // The footer's OWN padding only needs to add `BOTTOM_CLEARANCE` — the
    // remainder of the tab-bar height beyond what the enclosing `SafeAreaView`
    // already reserves as its own padding (see `totalBottomOffset` above and
    // the "does not double-count" test below for the full-stack total).
    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
  });

  it('does not double-count the bottom safe-area inset the enclosing SafeAreaView already reserves', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const footer = getByTestId(FOOTER_TEST_ID);

    // The regression this guards: the `SafeAreaView` wrapping `footer`
    // reserves `insets.bottom` (34) as real padding on ITSELF (see the mock
    // above — a bare `View`, the prior mock, would swallow this and hide the
    // bug entirely). Adding the tab bar's FULL height again in `footer`'s own
    // padding on top of that would double-count the inset and total
    // FOOTER_GAP + MOCK_TAB_BAR_HEIGHT + MOCK_BOTTOM_INSET (16+80+34=130) —
    // a whole extra safe-area inset of unwanted space below the button. The
    // correct total, split across the two views, is FOOTER_GAP +
    // MOCK_TAB_BAR_HEIGHT (16+80=96): exactly enough to clear the tab bar
    // with FOOTER_GAP of breathing room above it, no more.
    expect(totalBottomOffset(footer)).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
    expect(totalBottomOffset(footer)).not.toBe(
      FOOTER_GAP + MOCK_TAB_BAR_HEIGHT + MOCK_BOTTOM_INSET,
    );
  });

  it('pads the plain (non-scrolling) content clear of the floating tab bar too', async () => {
    const { getByTestId } = await renderScreen();

    const content = getByTestId(CONTENT_TEST_ID);
    const contentStyle = StyleSheet.flatten(content.props.style);

    // Same per-view split as the scroll+footer path above: `content`'s own
    // share is `BOTTOM_CLEARANCE`, and the total (this view's padding plus
    // its enclosing `SafeAreaView`'s own reserved inset) still clears the tab
    // bar by exactly `FOOTER_GAP`.
    expect(contentStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
    expect(totalBottomOffset(content)).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
  });

  it('reserves every safe-area edge in the plain branch by default (a headerless screen owns its top inset)', async () => {
    const { getByTestId } = await renderScreen();

    // No explicit `edges` prop: the SafeAreaView reserves every edge, including
    // top — correct for a plain (headerless) screen like Home.
    expect(getByTestId(CONTENT_TEST_ID).parent?.props.edges).toBeUndefined();
  });

  describe('belowHeader (a plain screen under a shown native header)', () => {
    it('drops the top edge, so the header owns the top inset, and keeps the rest', async () => {
      const { getByTestId } = await renderScreen({ belowHeader: true });

      expect(getByTestId(CONTENT_TEST_ID).parent?.props.edges).toEqual(['left', 'right', 'bottom']);
    });

    it('keeps the content, the base top padding and the tab-bar clearance of the plain branch', async () => {
      const { getByTestId } = await renderScreen({ belowHeader: true });
      const content = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

      expect(content.paddingTop).toBe(CONTENT_BASE_PADDING);
      expect(content.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
      expect(content.flex).toBe(1);
    });

    it('still pins a footer below the content', async () => {
      const { getByTestId } = await renderScreen({ belowHeader: true, footer: footerNode });

      expect(getByTestId(FOOTER_TEST_ID)).toBeTruthy();
    });
  });

  it('renders the bleedTop child directly under the SafeAreaView with no content wrapper, so the native large title can track it as its scroll view', async () => {
    const { getByText, queryByTestId } = await renderScreen({ bleedTop: true });

    // The native iOS large-title collapse tracks the FIRST scroll view found
    // walking the screen's first-child chain (react-native-screens'
    // `RNSScrollViewFinder`, and UIKit's own large-header search). An
    // intermediate padded wrapper `View` between the SafeAreaView and the child
    // scrollable stops that collapse — the working `account-detail` scroll
    // branch proves a scrollable rendered as a DIRECT child of the SafeAreaView
    // both collapses AND does not float. So under
    // `bleedTop` Screen renders the child directly, with NO `screen-content`
    // wrapper, exactly like the scroll branch's ScrollView: the child (a
    // FlatList) becomes the tracked scroll view. The render helper's plain
    // `Text` stands in for that scrollable child here.
    expect(queryByTestId(CONTENT_TEST_ID)).toBeNull();
    // The child's IMMEDIATE parent is the SafeAreaView itself — it forwards the
    // `edges` prop (an intermediate wrapper would not) — proving nothing is
    // interposed between the two.
    expect(getByText('content').parent?.props.edges).toBeDefined();
  });

  it('drops the top safe-area edge in the plain branch when bleedTop is set (a large-title header owns the top inset)', async () => {
    const { getByText } = await renderScreen({ bleedTop: true });

    // The child scrollable applies the large-title inset itself (via
    // `contentInsetAdjustmentBehavior="automatic"`), so reserving the top edge
    // here too would double-offset content beneath the header — same rationale
    // the always-scrolling branch already follows. Read from the child's direct
    // parent (the SafeAreaView), since `bleedTop` interposes no wrapper.
    const edges = getByText('content').parent?.props.edges as readonly string[] | undefined;
    expect(edges).toEqual(expect.arrayContaining(['left', 'right', 'bottom']));
    expect(edges).not.toContain('top');
  });

  it('still pins a footer below the bleedTop child, clear of the floating tab bar', async () => {
    const { getByText, getByTestId } = await renderScreen({ bleedTop: true, footer: footerNode });

    // Dropping the content wrapper must not drop the footer slot: it stays a
    // sibling of the child scrollable, pinned to the bottom edge with the same
    // tab-bar clearance every other footer gets.
    const footer = getByTestId(FOOTER_TEST_ID);
    expect(within(footer).queryByText('footer content')).toBeTruthy();
    expect(within(footer).queryByText('content')).toBeNull();
    expect(StyleSheet.flatten(footer.props.style).paddingBottom).toBe(
      FOOTER_GAP + BOTTOM_CLEARANCE,
    );
    // The child is still a direct child of the SafeAreaView, not nested inside
    // the footer.
    expect(getByText('content').parent?.props.edges).toBeDefined();
  });

  it('keeps the base top padding in the plain branch by default (no bleedTop)', async () => {
    const { getByTestId } = await renderScreen();

    // The default plain branch keeps its own top padding (the base spacing
    // step) — only `bleedTop` drops it.
    expect(StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style).paddingTop).toBe(
      CONTENT_BASE_PADDING,
    );
  });

  it('omits the tab-bar clearance from plain content when bleedBottom is set (the child owns it)', async () => {
    const { getByTestId } = await renderScreen({ bleedBottom: true });

    const contentStyle = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

    // The child (e.g. a SectionList) applies the clearance itself, so Screen
    // must not double-count it here: only the base padding remains.
    expect(contentStyle.paddingBottom).toBe(CONTENT_BASE_PADDING);
  });

  it('drops the scroll content bottom padding when a footer owns the gap above it, so the gap does not double', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const scrollContentStyle = StyleSheet.flatten(
      getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
    );

    // The footer slot below already supplies `paddingTop: theme.spacing(4)`
    // (16) as the one gap above the button. If this container also kept its
    // own `theme.spacing(4)` bottom padding, the two adjacent siblings would
    // stack into a 32pt gap on a short (unscrolled) form — the disproportionate
    // deposit-edit regression this fix removes.
    expect(scrollContentStyle.paddingBottom).toBe(0);
  });

  it('keeps the scroll content base bottom padding when there is no footer to supply the gap', async () => {
    const { getByTestId } = await renderScreen({ scroll: true });

    const scrollContentStyle = StyleSheet.flatten(
      getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
    );

    expect(scrollContentStyle.paddingBottom).toBe(CONTENT_BASE_PADDING);
  });

  it('renders no hairline divider above the footer', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    expect(footerStyle.borderTopWidth).toBeUndefined();
  });

  it('pins a footer to the bottom in the plain (non-scrolling) branch too, not just scroll mode', async () => {
    const { getByTestId } = await renderScreen({ footer: footerNode });

    // `content` still renders (this isn't scroll mode) and `footer` sits
    // pinned below it, outside `content`'s own testID — a short page's
    // action button lands at the screen's true bottom edge, not floating
    // directly under a short page's content.
    const content = getByTestId(CONTENT_TEST_ID);
    const footer = getByTestId(FOOTER_TEST_ID);

    expect(within(content).queryByText('footer content')).toBeNull();
    expect(within(footer).queryByText('footer content')).toBeTruthy();
  });

  it('pads a plain-branch footer clear of the floating tab bar exactly like a scroll-branch footer', async () => {
    const { getByTestId } = await renderScreen({ footer: footerNode });

    const footer = getByTestId(FOOTER_TEST_ID);
    const footerStyle = StyleSheet.flatten(footer.props.style);

    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
    expect(totalBottomOffset(footer)).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
  });

  it('drops the plain content clearance to the base padding when a footer owns the bottom edge instead', async () => {
    const { getByTestId } = await renderScreen({ footer: footerNode });

    const contentStyle = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

    // The footer above already reserves the tab-bar clearance for the whole
    // screen; `content` keeps only its own base padding so the two don't
    // double-count the gap below the footer.
    expect(contentStyle.paddingBottom).toBe(CONTENT_BASE_PADDING);
  });

  it('sets the footer gap above the tab bar equal to the footer button top margin', async () => {
    const { getByTestId } = await renderScreen({ scroll: true, footer: footerNode });

    const footer = getByTestId(FOOTER_TEST_ID);
    const footerStyle = StyleSheet.flatten(footer.props.style);

    // The gap below the button (above the tab bar) equals the gap above the
    // button — the footer slot's own `paddingTop: theme.spacing(4)` = 16 — so
    // the button reads as symmetrically inset rather than crowding the tab bar.
    // Measured across the FULL stack (`totalBottomOffset`, not just `footer`'s
    // own style), because part of the real clearance lives one level up as the
    // enclosing `SafeAreaView`'s own reserved padding (see the mock's comment
    // above) — checking `footer`'s own `paddingBottom` alone would silently
    // pass even if that split were wrong, exactly the gap this file's earlier
    // (pre-fix) version had.
    const footerButtonTopMargin = 16;
    expect(footerStyle.paddingTop).toBe(footerButtonTopMargin);
    expect(totalBottomOffset(footer) - MOCK_TAB_BAR_HEIGHT).toBe(footerButtonTopMargin);
    expect(totalBottomOffset(footer) - MOCK_TAB_BAR_HEIGHT).toBe(FOOTER_GAP);
  });

  describe('Duo vertical bar (the system places the tab bar on a vertical edge)', () => {
    const DUO_INSETS = { top: 0, right: 84, bottom: MOCK_BOTTOM_INSET, left: 0 };

    afterEach(() => {
      mockUseBottomTabBarHeight.mockReturnValue(MOCK_TAB_BAR_HEIGHT);
      mockUseVerticalBarEdge.mockReturnValue('none');
      mockUseSafeAreaInsets.mockReturnValue({
        top: 0,
        right: 0,
        bottom: MOCK_BOTTOM_INSET,
        left: 0,
      });
    });

    it.each(['leading', 'trailing'] as const)(
      'ignores the poisoned tab-bar height on the %s edge and keeps the horizontal padding at the single-stack content margin — the exact measured Duo outer geometry',
      async (edge) => {
        mockUseBottomTabBarHeight.mockReturnValue(678);
        mockUseVerticalBarEdge.mockReturnValue(edge);
        mockUseSafeAreaInsets.mockReturnValue(DUO_INSETS);

        const { getByTestId } = await renderScreen({ footer: footerNode });

        const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

        // A vertical bar distrusts the tab-bar height entirely: the footer's own
        // padding is the gap (16) plus the home-indicator inset, because the content runs
        // to the window's bottom there, not 16 + 644 — a ~676pt footer would cover the
        // whole screen.
        expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + DUO_INSETS.bottom);
        // The enclosing SafeAreaView already reserves the 84pt right inset
        // itself (`edges` includes 'right' in every branch — see
        // `screen.component.tsx`), so the footer's OWN horizontal padding is
        // the single-stack content margin, spacing(4) = 16 (a pane under a side bar widens it
        // to 20), never 16 + 84. Adding the inset again here would double-count it — the
        // dead gap the real-device screenshots caught.
        expect(footerStyle.paddingHorizontal).toBe(darkTheme.spacing(4));
      },
    );

    it("keeps today's horizontal padding unchanged when the tab bar is NOT a vertical bar", async () => {
      const { getByTestId } = await renderScreen({ footer: footerNode });

      const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

      expect(footerStyle.paddingHorizontal).toBe(16);
    });
  });

  describe('under a side bar', () => {
    type RenderedScreen = Awaited<ReturnType<typeof renderScreen>>;

    const SIDE_BAR_MARGIN = darkTheme.spacing(5);
    const BASE_MARGIN = darkTheme.spacing(4);

    const footerHorizontal = (view: RenderedScreen) =>
      StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style).paddingHorizontal;

    const scrollContentStyle = (view: RenderedScreen) =>
      StyleSheet.flatten(view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle);

    const HORIZONTAL_ROWS = [
      [
        'the plain content',
        {},
        (view: RenderedScreen) =>
          StyleSheet.flatten(view.getByTestId(CONTENT_TEST_ID).props.style).paddingHorizontal,
      ],
      ['the plain footer', { footer: footerNode }, footerHorizontal],
      [
        'the scroll content',
        { scroll: true },
        (view: RenderedScreen) => {
          const style = scrollContentStyle(view);

          return style.paddingHorizontal ?? style.padding;
        },
      ],
      ['the scroll footer', { scroll: true, footer: footerNode }, footerHorizontal],
      ['the bleedTop footer', { bleedTop: true, footer: footerNode }, footerHorizontal],
    ] as const;

    afterEach(() => {
      mockUseTabBarEdge.mockReturnValue('none');
    });

    const renderInSplitPane = (props: ComponentProps<typeof Screen>) =>
      render(
        <PaneContext.Provider value={paneContextOf('columns', 'primary')}>
          <Screen {...props}>
            <Text>content</Text>
          </Screen>
        </PaneContext.Provider>,
      );

    describe.each([
      ['a single stack', 'leading', BASE_MARGIN, renderScreen],
      ['a single stack', 'trailing', BASE_MARGIN, renderScreen],
      ['a single stack', 'bottom', BASE_MARGIN, renderScreen],
      ['a split pane', 'leading', SIDE_BAR_MARGIN, renderInSplitPane],
      ['a split pane', 'trailing', SIDE_BAR_MARGIN, renderInSplitPane],
      ['a split pane', 'bottom', BASE_MARGIN, renderInSplitPane],
    ] as const)('in %s with the tab bar edge %s', (_scope, edge, margin, renderIn) => {
      it.each(HORIZONTAL_ROWS)(
        'pads %s horizontally by the content margin',
        async (_name, props, horizontalPaddingOf) => {
          mockUseTabBarEdge.mockReturnValue(edge);

          expect(horizontalPaddingOf(await renderIn(props))).toBe(margin);
        },
      );

      it('keeps the top padding of the scroll content at 16', async () => {
        mockUseTabBarEdge.mockReturnValue(edge);

        const style = scrollContentStyle(await renderIn({ scroll: true }));

        expect(style.paddingTop ?? style.padding).toBe(darkTheme.spacing(4));
      });
    });
  });

  // A floating footer beside a side bar ends level with the bottom of the bar's platter, 24 pt
  // above the window's bottom, instead of a gap plus the home-indicator inset (16 + 34 = 50).
  describe('a floating footer beside a side bar', () => {
    const SIDE_BAR_PLATTER_INSET = 24;
    const footerPaddingBottom = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style).paddingBottom;
    const scrollEndOf = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      StyleSheet.flatten(view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle)
        .paddingBottom;
    const FOOTER_BOX_BEFORE_MEASURE = 16 + REGULAR_BUTTON_HEIGHT + SIDE_BAR_PLATTER_INSET;

    afterEach(() => {
      mockUseTabBarEdge.mockReturnValue('none');
    });

    it.each([
      ['plain', { floatingFooter: true, footer: footerNode }],
      ['scroll', { scroll: true, floatingFooter: true, footer: footerNode }],
      ['bleedTop', { bleedTop: true, floatingFooter: true, footer: footerNode }],
    ] as const)(
      'ends the %s branch footer at the platter inset on each side bar edge',
      async (_name, props) => {
        for (const edge of ['leading', 'trailing'] as const) {
          mockUseTabBarEdge.mockReturnValue(edge);

          expect(footerPaddingBottom(await renderScreen(props))).toBe(SIDE_BAR_PLATTER_INSET);
        }
      },
    );

    it('keeps the pinned footer at the gap plus the home-indicator inset', async () => {
      mockUseTabBarEdge.mockReturnValue('leading');

      expect(footerPaddingBottom(await renderScreen({ footer: footerNode }))).toBe(
        FOOTER_GAP + MOCK_BOTTOM_INSET,
      );
    });

    it('keeps the gap plus the bar clearance beside a bottom bar', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');

      expect(
        footerPaddingBottom(await renderScreen({ floatingFooter: true, footer: footerNode })),
      ).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
    });

    it('keeps the gap and no clearance in a pane that is not at the window bottom', async () => {
      mockUseTabBarEdge.mockReturnValue('leading');

      const view = await render(
        <PaneContext.Provider value={paneContextOf('rows', 'companion')}>
          <Screen floatingFooter footer={footerNode}>
            <Text>content</Text>
          </Screen>
        </PaneContext.Provider>,
      );

      expect(footerPaddingBottom(view)).toBe(FOOTER_GAP);
    });

    it('ends the scroll content where the footer begins, less the inset UIKit adds itself', async () => {
      mockUseTabBarEdge.mockReturnValue('leading');

      const view = await renderScreen({ scroll: true, floatingFooter: true, footer: footerNode });

      expect(scrollEndOf(view)).toBe(FOOTER_BOX_BEFORE_MEASURE - MOCK_BOTTOM_INSET);

      await act(() =>
        fireEvent(view.getByTestId(FOOTER_TEST_ID), 'layout', {
          nativeEvent: { layout: { height: 100 } },
        }),
      );

      expect(scrollEndOf(view)).toBe(100 - MOCK_BOTTOM_INSET);
    });

    it('ends the plain content where the footer begins', async () => {
      mockUseTabBarEdge.mockReturnValue('leading');

      const view = await renderScreen({ floatingFooter: true, footer: footerNode });

      expect(StyleSheet.flatten(view.getByTestId(CONTENT_TEST_ID).props.style).paddingBottom).toBe(
        FOOTER_BOX_BEFORE_MEASURE,
      );
    });
  });

  // The user ruling: the buttons of a floating footer are at most 340 pt wide, and only in a
  // regular-width window (the Duo inner screen, an iPad); a compact window keeps full-width
  // buttons.
  describe('the width of a floating footer', () => {
    const FLOATING_FOOTER_MAX_WIDTH = 340;
    const footerStyleOf = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style);

    afterEach(() => {
      mockHorizontalSizeClass.mockReturnValue('compact');
    });

    it.each([
      ['plain', { floatingFooter: true, footer: footerNode }],
      ['scroll', { scroll: true, floatingFooter: true, footer: footerNode }],
      ['bleedTop', { bleedTop: true, floatingFooter: true, footer: footerNode }],
    ] as const)(
      'caps the %s branch buttons at 340 pt and centres them in a regular window',
      async (_name, props) => {
        mockHorizontalSizeClass.mockReturnValue('regular');
        const flat = footerStyleOf(await renderScreen(props));

        expect(Number(flat.maxWidth) - 2 * Number(flat.paddingHorizontal)).toBe(
          FLOATING_FOOTER_MAX_WIDTH,
        );
        expect(flat.alignSelf).toBe('center');
        expect(flat.width).toBe('100%');
      },
    );

    it('keeps full-width buttons in a compact window', async () => {
      const flat = footerStyleOf(await renderScreen({ floatingFooter: true, footer: footerNode }));

      expect(flat.maxWidth).toBeUndefined();
      expect(flat.alignSelf).toBeUndefined();
    });

    it('does not cap a pinned footer in a regular window', async () => {
      mockHorizontalSizeClass.mockReturnValue('regular');
      const flat = footerStyleOf(await renderScreen({ footer: footerNode }));

      expect(flat.maxWidth).not.toBe(
        FLOATING_FOOTER_MAX_WIDTH + 2 * Number(flat.paddingHorizontal),
      );
    });
  });

  // What the footer tells the rest of the tree: its buttons float (a Button reads that), and a
  // scroll view under it, which a `bleedTop` child such as the Holding detail ledger owns, pads
  // its end by the footer's height.
  describe('what a floating footer tells the tree', () => {
    const FooterProbe = () => (
      <Text testID="in-floating-footer">{String(useIsInFloatingFooter())}</Text>
    );
    const EndProbe = () => <Text testID="floating-end">{String(useFloatingFooterEnd())}</Text>;
    const renderProbed = (props: ComponentProps<typeof Screen>) =>
      render(
        <Screen {...props} footer={<FooterProbe />}>
          <EndProbe />
        </Screen>,
      );

    it('marks the footer as floating, and a pinned one as not', async () => {
      const floating = await renderProbed({ floatingFooter: true });
      expect(floating.getByTestId('in-floating-footer').props.children).toBe('true');

      const pinned = await renderProbed({});
      expect(pinned.getByTestId('in-floating-footer').props.children).toBe('false');
    });

    it('hands the content the footer height as its end, and nothing without a floating footer', async () => {
      const floating = await renderProbed({ scroll: true, floatingFooter: true });
      const scrollEnd = StyleSheet.flatten(
        floating.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
      ).paddingBottom;

      expect(floating.getByTestId('floating-end').props.children).toBe(String(scrollEnd));

      await act(() =>
        fireEvent(floating.getByTestId(FOOTER_TEST_ID), 'layout', {
          nativeEvent: { layout: { height: 123 } },
        }),
      );

      expect(floating.getByTestId('floating-end').props.children).toBe('123');

      const pinned = await renderProbed({ scroll: true });
      expect(pinned.getByTestId('floating-end').props.children).toBe('undefined');

      const noFooter = await render(
        <Screen scroll floatingFooter>
          <EndProbe />
        </Screen>,
      );
      expect(noFooter.getByTestId('floating-end').props.children).toBe('undefined');
    });
  });

  describe('under a floating top tab bar', () => {
    const TOP_BAR_PILL = 44;

    const renderInPane = (props: ComponentProps<typeof Screen>, mode: 'columns' | 'rows') =>
      render(
        <PaneContext.Provider value={paneContextOf(mode, 'primary')}>
          <Screen {...props}>
            <Text>content</Text>
          </Screen>
        </PaneContext.Provider>,
      );

    const contentTop = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      StyleSheet.flatten(view.getByTestId(CONTENT_TEST_ID).props.style).paddingTop;

    beforeEach(() => {
      mockUseTabBarEdge.mockReturnValue('top');
    });

    afterEach(() => {
      mockUseTabBarEdge.mockReturnValue('none');
      mockUseBottomTabBarHeight.mockReturnValue(MOCK_TAB_BAR_HEIGHT);
    });

    it('pads the plain content by the 44 pt pill under a top bar', async () => {
      const view = await renderScreen();

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING + TOP_BAR_PILL);
    });

    it('pads the plain content 44 pt more under a top bar when bleedBottom is set (Home)', async () => {
      const view = await renderScreen({ bleedBottom: true });

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING + TOP_BAR_PILL);
    });

    it.each([72, 83])('adds nothing under a %i pt bottom bar', async (barHeight) => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      mockUseBottomTabBarHeight.mockReturnValue(barHeight);

      const view = await renderScreen();

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING);
    });

    it('adds nothing in the rows primary, which has no bar over it', async () => {
      const view = await renderInPane({}, 'rows');

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING);
    });

    it('adds the pill in the columns primary, which reaches the top of the window', async () => {
      const view = await renderInPane({}, 'columns');

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING + TOP_BAR_PILL);
    });

    it('never puts the clearance on the SafeAreaView', async () => {
      const { getByTestId } = await renderScreen();

      expect(
        StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).parent?.props.style).paddingTop,
      ).toBeUndefined();
    });

    it('adds no pill under a top bar when the screen sits below a shown header', async () => {
      const view = await renderScreen({ belowHeader: true });

      expect(contentTop(view)).toBe(CONTENT_BASE_PADDING);
    });

    it('carries no top clearance in the scroll branch', async () => {
      const { getByTestId } = await renderScreen({ scroll: true });
      const scrollContentStyle = StyleSheet.flatten(
        getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
      );

      expect(scrollContentStyle.paddingTop).toBeUndefined();
      expect(scrollContentStyle.padding).toBe(CONTENT_BASE_PADDING);
    });

    it('carries no top clearance in the bleedTop branch', async () => {
      const { getByText, queryByTestId } = await renderScreen({ bleedTop: true });

      expect(queryByTestId(CONTENT_TEST_ID)).toBeNull();
      expect(
        StyleSheet.flatten(getByText('content').parent?.props.style).paddingTop,
      ).toBeUndefined();
    });
  });

  // One of two panes shares the window: its content is capped and centred, it keeps a safe-area
  // inset only on an edge it shares with the window, and it clears the tab bar only when it sits
  // at the window's bottom. Outside a pane (every test above) none of this applies.
  describe('in a pane', () => {
    type PaneOf = Parameters<typeof paneContextOf>;

    const renderInPane = (props: ComponentProps<typeof Screen>, mode: PaneOf[0], pane: PaneOf[1]) =>
      render(
        <PaneContext.Provider value={paneContextOf(mode, pane)}>
          <Screen {...props}>
            <Text>content</Text>
          </Screen>
        </PaneContext.Provider>,
      );

    // The SafeAreaView is the root of every branch; its direct child is how a test reaches it.
    const rootOf = (
      view: Awaited<ReturnType<typeof renderInPane>>,
      props: { scroll?: boolean; bleedTop?: boolean },
    ) => {
      if (props.scroll) {
        return view.getByTestId(SCROLL_VIEW_TEST_ID).parent;
      }

      return props.bleedTop
        ? view.getByText('content').parent
        : view.getByTestId(CONTENT_TEST_ID).parent;
    };

    const BRANCHES = [
      ['plain', {}],
      ['scroll', { scroll: true }],
      ['bleedTop', { bleedTop: true }],
    ] as const;

    afterEach(() => {
      mockUseTabBarEdge.mockReturnValue('none');
    });

    it('caps and centres the plain branch at the pane max width', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      const view = await renderInPane({}, 'columns', 'primary');
      const root = StyleSheet.flatten(rootOf(view, {})?.props.style);

      expect(root.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
      expect(root.width).toBe('100%');
      expect(root.alignSelf).toBe('center');
    });

    it('caps and centres the content of the scroll branch, and leaves the scroll view the whole pane', async () => {
      mockUseTabBarEdge.mockReturnValue('bottom');
      const view = await renderInPane({ scroll: true }, 'rows', 'primary');
      const root = StyleSheet.flatten(rootOf(view, { scroll: true })?.props.style);
      const content = StyleSheet.flatten(
        view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
      );

      expect(root.maxWidth).toBeUndefined();
      expect(root.alignSelf).toBeUndefined();
      expect(content.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
      expect(content.width).toBe('100%');
      expect(content.alignSelf).toBe('center');
      expect(content.padding).toBe(16);
    });

    it.each(BRANCHES)(
      'leaves the %s branch uncapped and uncentred in a pane under a top tab bar',
      async (_name, props) => {
        mockUseTabBarEdge.mockReturnValue('top');
        const view = await renderInPane(props, 'columns', 'primary');
        const root = StyleSheet.flatten(rootOf(view, props)?.props.style);

        expect(root.maxWidth).toBeUndefined();
        expect(root.alignSelf).toBeUndefined();

        if ('scroll' in props) {
          const content = StyleSheet.flatten(
            view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
          );

          expect(content.maxWidth).toBeUndefined();
          expect(content.alignSelf).toBeUndefined();
          expect(content.padding).toBe(darkTheme.spacing(4));
        }
      },
    );

    it('leaves the footer of the bleedTop branch uncapped and uncentred in a pane under a top tab bar', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await renderInPane({ bleedTop: true, footer: footerNode }, 'columns', 'primary');
      const footer = StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style);

      expect(footer.maxWidth).toBeUndefined();
      expect(footer.alignSelf).toBeUndefined();
    });

    it('keeps the horizontal padding of the plain branch in a pane under a top tab bar', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await renderInPane({}, 'columns', 'primary');
      const content = StyleSheet.flatten(view.getByTestId(CONTENT_TEST_ID).props.style);

      expect(content.paddingHorizontal).toBe(darkTheme.spacing(4));
    });

    // A small Stage Manager row split (683 x 909) is not a large window, yet its title sits at the
    // content's margin like a large window's, so its content has to start there too.
    it('starts the scroll content of a row split pane at the title margin under a top tab bar', async () => {
      mockUseTabBarEdge.mockReturnValue('top');
      const view = await renderInPane({ scroll: true }, 'rows', 'primary');
      const content = StyleSheet.flatten(
        view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
      );

      expect(content.maxWidth).toBeUndefined();
      expect(content.alignSelf).toBeUndefined();
      expect(content.padding).toBe(darkTheme.spacing(4));
    });

    it.each(['rows', 'columns'] as const)(
      'caps and centres every branch in a Duo inner pane of the %s window',
      async (mode) => {
        mockUseTabBarEdge.mockReturnValue('bottom');

        const plain = await renderInPane({}, mode, 'primary');
        const scroll = await renderInPane({ scroll: true }, mode, 'primary');
        const plainRoot = StyleSheet.flatten(rootOf(plain, {})?.props.style);
        const scrollContent = StyleSheet.flatten(
          scroll.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
        );
        const bleedTop = await renderInPane(
          { bleedTop: true, footer: footerNode },
          mode,
          'primary',
        );
        const footer = StyleSheet.flatten(bleedTop.getByTestId(FOOTER_TEST_ID).props.style);

        expect(plainRoot.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
        expect(plainRoot.alignSelf).toBe('center');
        expect(scrollContent.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
        expect(scrollContent.alignSelf).toBe('center');
        expect(footer.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
        expect(footer.alignSelf).toBe('center');
      },
    );

    it('leaves a bleedTop child the whole pane, to cap its own content', async () => {
      const view = await renderInPane({ bleedTop: true }, 'rows', 'primary');
      const root = StyleSheet.flatten(rootOf(view, { bleedTop: true })?.props.style);

      expect(root.maxWidth).toBeUndefined();
      expect(root.alignSelf).toBeUndefined();
    });

    it.each([
      ['scroll', { scroll: true }],
      ['bleedTop', { bleedTop: true }],
    ] as const)(
      'caps and centres the footer of the %s branch like its content',
      async (_name, props) => {
        const view = await renderInPane({ ...props, footer: footerNode }, 'rows', 'primary');
        const footer = StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style);

        expect(footer.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
        expect(footer.width).toBe('100%');
        expect(footer.alignSelf).toBe('center');
      },
    );

    it('leaves a bleedBottom child the whole pane, to cap its own content', async () => {
      const view = await renderInPane({ bleedBottom: true }, 'rows', 'primary');
      const root = StyleSheet.flatten(rootOf(view, {})?.props.style);

      expect(root.maxWidth).toBeUndefined();
      expect(root.alignSelf).toBeUndefined();
    });

    it('caps the footer of a bleedBottom plain branch on its own, as its root is not capped', async () => {
      const view = await renderInPane({ bleedBottom: true, footer: footerNode }, 'rows', 'primary');
      const footer = StyleSheet.flatten(view.getByTestId(FOOTER_TEST_ID).props.style);

      expect(footer.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
      expect(footer.width).toBe('100%');
      expect(footer.alignSelf).toBe('center');
    });

    it('caps the footer of the plain branch through its root', async () => {
      const view = await renderInPane({ footer: footerNode }, 'rows', 'primary');
      const root = StyleSheet.flatten(rootOf(view, {})?.props.style);

      expect(view.getByTestId(FOOTER_TEST_ID).parent).toBe(rootOf(view, {}));
      expect(root.maxWidth).toBe(darkTheme.layout.paneMaxWidth);
    });

    it.each(BRANCHES)('does not cap the %s branch outside a pane', async (_name, props) => {
      const view = await renderScreen(props);
      const root = StyleSheet.flatten(rootOf(view, props)?.props.style);

      expect(root.maxWidth).toBeUndefined();
      expect(root.alignSelf).toBeUndefined();

      if ('scroll' in props) {
        const content = StyleSheet.flatten(
          view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle,
        );

        expect(content.maxWidth).toBeUndefined();
        expect(content.alignSelf).toBeUndefined();
      }
    });

    it.each([
      ['columns', 'companion', ['top', 'bottom', 'left']],
      ['columns', 'primary', ['top', 'right', 'bottom']],
      ['rows', 'companion', ['top', 'right', 'left']],
      ['rows', 'primary', ['right', 'bottom', 'left']],
    ] as const)(
      'reserves a plain screen’s safe area only on the window edges the %s %s pane touches',
      async (mode, pane, touched) => {
        const view = await renderInPane({}, mode, pane);

        expect(view.getByTestId(CONTENT_TEST_ID).parent?.props.edges).toEqual(touched);
      },
    );

    it.each([
      ['columns', 'companion', ['left', 'bottom']],
      ['columns', 'primary', ['right', 'bottom']],
      ['rows', 'companion', ['left', 'right']],
      ['rows', 'primary', ['left', 'right', 'bottom']],
    ] as const)(
      'drops the top edge of a plain screen below a header and keeps only the edges the %s %s pane touches',
      async (mode, pane, touched) => {
        const view = await renderInPane({ belowHeader: true }, mode, pane);

        expect(view.getByTestId(CONTENT_TEST_ID).parent?.props.edges).toEqual(touched);
      },
    );

    it.each([
      ['columns', 'companion', ['left', 'bottom']],
      ['columns', 'primary', ['right', 'bottom']],
      ['rows', 'companion', ['left', 'right']],
      ['rows', 'primary', ['left', 'right', 'bottom']],
    ] as const)(
      'drops the top edge of a large-title screen and keeps only the edges the %s %s pane touches',
      async (mode, pane, touched) => {
        const scroll = await renderInPane({ scroll: true }, mode, pane);
        const bleedTop = await renderInPane({ bleedTop: true }, mode, pane);

        expect(scroll.getByTestId(SCROLL_VIEW_TEST_ID).parent?.props.edges).toEqual(touched);
        expect(bleedTop.getByText('content').parent?.props.edges).toEqual(touched);
      },
    );

    // UIKit insets the indicator by the window's right safe-area inset (the vertical tab bar), even
    // for a pane that does not reach that edge, which drew it inside the pane's content.
    it.each([
      ['columns', 'companion', false],
      ['columns', 'primary', undefined],
      ['rows', 'companion', undefined],
      ['rows', 'primary', undefined],
    ] as const)(
      'stops UIKit insetting the scroll indicator of the %s %s pane (%s)',
      async (mode, pane, expected) => {
        const view = await renderInPane({ scroll: true }, mode, pane);

        expect(
          view.getByTestId(SCROLL_VIEW_TEST_ID).props.automaticallyAdjustsScrollIndicatorInsets,
        ).toBe(expected);
      },
    );

    it('leaves the scroll indicator insets to UIKit outside a pane', async () => {
      const view = await renderScreen({ scroll: true });

      expect(
        view.getByTestId(SCROLL_VIEW_TEST_ID).props.automaticallyAdjustsScrollIndicatorInsets,
      ).toBeUndefined();
    });

    it('clears the tab bar in a pane that touches the window bottom', async () => {
      const { getByTestId } = await renderInPane({ footer: footerNode }, 'columns', 'companion');

      expect(StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style).paddingBottom).toBe(
        FOOTER_GAP + BOTTOM_CLEARANCE,
      );
    });

    it('keeps the tab-bar clearance out of the footer of a top pane in rows mode', async () => {
      const { getByTestId } = await renderInPane({ footer: footerNode }, 'rows', 'companion');

      expect(StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style).paddingBottom).toBe(
        FOOTER_GAP,
      );
    });

    it('keeps the tab-bar clearance out of the content edge of a top pane in rows mode', async () => {
      const { getByTestId } = await renderInPane({}, 'rows', 'companion');

      expect(StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style).paddingBottom).toBe(
        FOOTER_GAP,
      );
    });

    it('clears the tab bar in the bottom pane in rows mode', async () => {
      const { getByTestId } = await renderInPane({}, 'rows', 'primary');

      expect(StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style).paddingBottom).toBe(
        FOOTER_GAP + BOTTOM_CLEARANCE,
      );
    });
  });

  // A table is wider than the pane cap, which exists to keep a form from stretching across a wide
  // window. A screen that asks for `uncapped` takes the whole window or pane it is in.
  describe('uncapped', () => {
    afterEach(() => {
      mockHorizontalSizeClass.mockReturnValue('compact');
    });

    // The bleedTop child caps its own content, so only its footer is Screen's to cap.
    const BRANCHES = [
      ['plain', {}],
      ['scroll', { scroll: true }],
    ] as const;

    const capsOf = (
      view: Awaited<ReturnType<typeof renderScreen>>,
      props: { scroll?: boolean },
    ) => {
      const root = view.getByTestId(props.scroll ? SCROLL_VIEW_TEST_ID : CONTENT_TEST_ID).parent;
      const content = props.scroll
        ? view.getByTestId(SCROLL_VIEW_TEST_ID).props.contentContainerStyle
        : undefined;

      return [
        StyleSheet.flatten(root?.props.style)?.maxWidth,
        StyleSheet.flatten(content)?.maxWidth,
      ];
    };

    it('caps a regular window at the pane max width, so the next case is a change', async () => {
      mockHorizontalSizeClass.mockReturnValue('regular');

      expect(capsOf(await renderScreen({}), {})).toEqual([
        darkTheme.layout.paneMaxWidth,
        undefined,
      ]);
      expect(capsOf(await renderScreen({ scroll: true }), { scroll: true })).toEqual([
        undefined,
        darkTheme.layout.paneMaxWidth,
      ]);
    });

    it.each(BRANCHES)('leaves the %s branch of a regular window uncapped', async (_name, props) => {
      mockHorizontalSizeClass.mockReturnValue('regular');
      const view = await renderScreen({ ...props, uncapped: true });

      expect(capsOf(view, props)).toEqual([undefined, undefined]);
    });

    // The footer of the plain branch sits inside the capped root, which the cases above cover.
    it.each([
      ['scroll', { scroll: true, footer: footerNode }],
      ['bleedBottom', { bleedBottom: true, footer: footerNode }],
      ['bleedTop', { bleedTop: true, footer: footerNode }],
    ] as const)(
      'caps the footer of the %s branch in a regular window, unless uncapped',
      async (_name, props) => {
        mockHorizontalSizeClass.mockReturnValue('regular');
        const capped = await renderScreen(props);
        const uncapped = await renderScreen({ ...props, uncapped: true });

        expect(StyleSheet.flatten(capped.getByTestId(FOOTER_TEST_ID).props.style).maxWidth).toBe(
          darkTheme.layout.paneMaxWidth,
        );
        expect(StyleSheet.flatten(uncapped.getByTestId(FOOTER_TEST_ID).props.style).maxWidth).toBe(
          undefined,
        );
      },
    );

    it.each([
      ['columns', 'primary'],
      ['rows', 'companion'],
    ] as const)('leaves the plain branch of a %s %s pane uncapped', async (mode, pane) => {
      const inPane = (props: ComponentProps<typeof Screen>) =>
        render(
          <PaneContext.Provider value={paneContextOf(mode, pane)}>
            <Screen {...props}>
              <Text>content</Text>
            </Screen>
          </PaneContext.Provider>,
        );
      const capped = await inPane({});
      const uncapped = await inPane({ uncapped: true });

      expect(
        StyleSheet.flatten(capped.getByTestId(CONTENT_TEST_ID).parent?.props.style).maxWidth,
      ).toBe(darkTheme.layout.paneMaxWidth);
      expect(
        StyleSheet.flatten(uncapped.getByTestId(CONTENT_TEST_ID).parent?.props.style).maxWidth,
      ).toBe(undefined);
    });

    it('keeps the edges, the margin and the clearance of the plain branch', async () => {
      mockHorizontalSizeClass.mockReturnValue('regular');
      const capped = await renderScreen({ belowHeader: true });
      const uncapped = await renderScreen({ belowHeader: true, uncapped: true });

      expect(uncapped.getByTestId(CONTENT_TEST_ID).parent?.props.edges).toEqual(
        capped.getByTestId(CONTENT_TEST_ID).parent?.props.edges,
      );
      expect(uncapped.getByTestId(CONTENT_TEST_ID).props.style).toEqual(
        capped.getByTestId(CONTENT_TEST_ID).props.style,
      );
    });
  });
});

describe('Screen with a title heading', () => {
  const HEADER_HEIGHT = 100;
  const HEADING_TITLE = 'A title that is much too long for one line';

  // The context a navigator layout sets while the screen's title does not fit one line of the
  // native large title.
  const renderWithHeading = (
    onScrolledChange: jest.Mock,
    props: ComponentProps<typeof Screen> = { scroll: true },
    headingBottom = 150,
  ) =>
    render(
      <HeaderHeightContext.Provider value={HEADER_HEIGHT}>
        <LargeTitleHeadingContext.Provider
          value={{
            title: HEADING_TITLE,
            scrolled: false,
            headingBottom: { current: headingBottom },
            onScrolledChange,
            onHostedChange: jest.fn(),
          }}
        >
          <Screen {...props}>
            <Text>body text</Text>
          </Screen>
        </LargeTitleHeadingContext.Provider>
      </HeaderHeightContext.Provider>,
    );

  it('renders the heading as the first scroll content, ahead of the screen content', async () => {
    const { toJSON } = await renderWithHeading(jest.fn());
    const rendered = JSON.stringify(toJSON());

    expect(rendered).toContain(HEADING_TITLE);
    expect(rendered.indexOf(HEADING_TITLE)).toBeLessThan(rendered.indexOf('body text'));
  });

  it('reports the heading scrolled under the bar from the scroll view', async () => {
    const onScrolledChange = jest.fn();
    const { getByTestId } = await renderWithHeading(onScrolledChange);
    const scrollView = getByTestId(SCROLL_VIEW_TEST_ID);

    scrollView.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 50 } } });
    scrollView.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: -HEADER_HEIGHT } } });

    expect(scrollView.props.scrollEventThrottle).toBe(16);
    expect(onScrolledChange.mock.calls).toEqual([[true], [false]]);
  });

  // The heading bar is translucent: the content rests one header height above offset zero.
  it('does not report the heading scrolled at the rest offset under the translucent bar', async () => {
    const onScrolledChange = jest.fn();
    const { getByTestId } = await renderWithHeading(onScrolledChange, { scroll: true }, 90);

    getByTestId(SCROLL_VIEW_TEST_ID).props.onScroll({
      nativeEvent: { contentOffset: { x: 0, y: -HEADER_HEIGHT } },
    });

    expect(onScrolledChange.mock.calls).toEqual([[false]]);
  });

  it('renders no heading and adds no scroll handler while the native large title shows the title', async () => {
    const { getByTestId, queryByTestId } = await renderScreen({ scroll: true });

    expect(queryByTestId('large-title-heading')).toBeNull();
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.onScroll).toBeUndefined();
  });

  it.each([
    ['plain', {}],
    ['bleedTop', { bleedTop: true }],
  ])('leaves the heading to the screen in the %s branch', async (_name, props) => {
    const { queryByTestId } = await renderWithHeading(jest.fn(), props);

    expect(queryByTestId('large-title-heading')).toBeNull();
  });

  // The safe-area view is a third-party native view: a Unistyles stylesheet color on it would not
  // repaint on a scheme change, so its background comes from the re-rendered theme.
  describe('page background on the safe-area view', () => {
    type RenderedScreen = Awaited<ReturnType<typeof renderScreen>>;

    const BRANCHES: [
      string,
      ComponentProps<typeof Screen>,
      (view: RenderedScreen) => RenderedElement,
    ][] = [
      ['plain', {}, (view) => view.getByTestId(CONTENT_TEST_ID)],
      ['scroll', { scroll: true }, (view) => view.getByTestId(SCROLL_VIEW_TEST_ID)],
      ['bleedTop', { bleedTop: true }, (view) => view.getByText('content')],
    ];

    const pageColorOf = (child: RenderedElement): unknown =>
      StyleSheet.flatten(child.parent?.props.style).backgroundColor;

    afterEach(() => {
      restoreThemeOrder();
    });

    it.each(BRANCHES)('paints the dark page in the %s branch', async (_name, props, childOf) => {
      const view = await renderScreen(props);

      expect(pageColorOf(childOf(view))).toBe(darkTheme.colors.background);
    });

    it.each(BRANCHES)(
      'paints the light page in the %s branch once light is the active theme',
      async (_name, props, childOf) => {
        registerLightThemeFirst();
        const view = await renderScreen(props);

        expect(pageColorOf(childOf(view))).toBe(lightTheme.colors.background);
      },
    );
  });
});
