import { render, within } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import type { RenderedElement } from '../../../test-support/rendered-element';
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

  it('renders the bleedTop child directly under the SafeAreaView with no content wrapper, so the native large title can track it as its scroll view', async () => {
    const { getByText, queryByTestId } = await renderScreen({ bleedTop: true });

    // The native iOS large-title collapse tracks the FIRST scroll view found
    // walking the screen's first-child chain (react-native-screens'
    // `RNSScrollViewFinder`, and UIKit's own large-header search). An
    // intermediate padded wrapper `View` between the SafeAreaView and the child
    // scrollable stops that collapse — the working `account-detail` scroll
    // branch proves a scrollable rendered as a DIRECT child of the SafeAreaView
    // both collapses AND does not float (feedback round-3, item 1). So under
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
});
