import { render, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import '../../unistyles';
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
jest.mock('react-native-bottom-tabs', () => ({
  useBottomTabBarHeight: () => MOCK_TAB_BAR_HEIGHT,
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
    edges,
    style,
    ...props
  }: {
    edges?: readonly string[];
    style?: unknown;
    [key: string]: unknown;
  }) => {
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
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: MOCK_BOTTOM_INSET, left: 0 }),
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
type StyledElement = { props: { style?: unknown }; parent: { props: { style?: unknown } } | null };
const totalBottomOffset = (edgeElement: StyledElement) => {
  const ownStyle = StyleSheet.flatten(edgeElement.props.style);
  const parentStyle = StyleSheet.flatten(edgeElement.parent?.props.style);
  return (ownStyle.paddingBottom ?? 0) + (parentStyle.paddingBottom ?? 0);
};

describe('Screen', () => {
  it('renders children in a plain (non-scrolling) View by default', async () => {
    const { getByText, queryByTestId } = await render(
      <Screen>
        <Text>content</Text>
      </Screen>,
    );

    expect(getByText('content')).toBeTruthy();
    expect(queryByTestId(SCROLL_VIEW_TEST_ID)).toBeNull();
  });

  it('renders children inside a ScrollView with automatic inset adjustment when scroll is set', async () => {
    const { getByText, getByTestId } = await render(
      <Screen scroll>
        <Text>content</Text>
      </Screen>,
    );

    expect(getByText('content')).toBeTruthy();
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('enables scrollToOverflow so a programmatic scroll-to-top re-expands the large title', async () => {
    const { getByTestId } = await render(
      <Screen scroll>
        <Text>content</Text>
      </Screen>,
    );

    // Fabric clamps a negative programmatic `scrollTo` y to 0 while
    // `contentInsetAdjustmentBehavior="automatic"` keeps the large-title band
    // in `adjustedContentInset.top` (leaving `contentInset.top` at 0), so a
    // scroll-to-top target never re-expands the collapsed title. This prop
    // bypasses that clamp (see `use-scroll-to-top-on-tab-press.ts`).
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.scrollToOverflowEnabled).toBe(true);
  });

  it('keeps the keyboard up so a tap on a child focuses on the first tap, not the second', async () => {
    const { getByTestId } = await render(
      <Screen scroll>
        <Text>content</Text>
      </Screen>,
    );

    // Default keyboardShouldPersistTaps is "never", which consumes the first
    // tap to dismiss the keyboard so a focused-input-to-another-input tap needs
    // a second tap. "handled" fires the child's onPress/focus on the first tap
    // while still dismissing the keyboard on taps to inert areas.
    expect(getByTestId(SCROLL_VIEW_TEST_ID).props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('renders a footer outside the ScrollView when scroll and footer are set', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const scrollView = getByTestId(SCROLL_VIEW_TEST_ID);
    const footer = getByTestId(FOOTER_TEST_ID);

    expect(within(scrollView).queryByText('content')).toBeTruthy();
    expect(within(scrollView).queryByText('footer content')).toBeNull();
    expect(within(footer).queryByText('footer content')).toBeTruthy();
  });

  it('pads the footer clear of the floating tab bar by its own share of the clearance', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    // The footer's OWN padding only needs to add `BOTTOM_CLEARANCE` — the
    // remainder of the tab-bar height beyond what the enclosing `SafeAreaView`
    // already reserves as its own padding (see `totalBottomOffset` above and
    // the "does not double-count" test below for the full-stack total).
    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
  });

  it('does not double-count the bottom safe-area inset the enclosing SafeAreaView already reserves', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

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
    const { getByTestId } = await render(
      <Screen>
        <Text>content</Text>
      </Screen>,
    );

    const content = getByTestId(CONTENT_TEST_ID);
    const contentStyle = StyleSheet.flatten(content.props.style);

    // Same per-view split as the scroll+footer path above: `content`'s own
    // share is `BOTTOM_CLEARANCE`, and the total (this view's padding plus
    // its enclosing `SafeAreaView`'s own reserved inset) still clears the tab
    // bar by exactly `FOOTER_GAP`.
    expect(contentStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
    expect(totalBottomOffset(content)).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
  });

  it('omits the tab-bar clearance from plain content when bleedBottom is set (the child owns it)', async () => {
    const { getByTestId } = await render(
      <Screen bleedBottom>
        <Text>content</Text>
      </Screen>,
    );

    const contentStyle = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

    // The child (e.g. a SectionList) applies the clearance itself, so Screen
    // must not double-count it here: only the base padding remains.
    expect(contentStyle.paddingBottom).toBe(CONTENT_BASE_PADDING);
  });

  it('renders no hairline divider above the footer', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    expect(footerStyle.borderTopWidth).toBeUndefined();
  });

  it('pins a footer to the bottom in the plain (non-scrolling) branch too, not just scroll mode', async () => {
    const { getByTestId } = await render(
      <Screen footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

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
    const { getByTestId } = await render(
      <Screen footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const footer = getByTestId(FOOTER_TEST_ID);
    const footerStyle = StyleSheet.flatten(footer.props.style);

    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + BOTTOM_CLEARANCE);
    expect(totalBottomOffset(footer)).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
  });

  it('drops the plain content clearance to the base padding when a footer owns the bottom edge instead', async () => {
    const { getByTestId } = await render(
      <Screen footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const contentStyle = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

    // The footer above already reserves the tab-bar clearance for the whole
    // screen; `content` keeps only its own base padding so the two don't
    // double-count the gap below the footer.
    expect(contentStyle.paddingBottom).toBe(CONTENT_BASE_PADDING);
  });

  it('sets the footer gap above the tab bar equal to the footer button top margin', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

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
});
