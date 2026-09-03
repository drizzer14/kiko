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

// @testing-library/react-native v14 dropped the UNSAFE_ByType queries, so the
// only way to tell a ScrollView root from a plain View root is a testID —
// same pattern MoneyText's own test uses to probe an internal render
// decision (see money-text.component.test.tsx).
const SCROLL_VIEW_TEST_ID = 'screen-scroll-view';
const FOOTER_TEST_ID = 'screen-footer';
const CONTENT_TEST_ID = 'screen-content';
// The breathing-room gap a footer (or a content edge that owns the true bottom)
// keeps above the floating tab bar, added on top of the tab-bar clearance.
// Design feedback trimmed the old spacing(4) = 16 gap by 1.5 footer-button
// heights (75); that over-reduces, so it clamps to the minimal safe spacing(2)
// = 8 — the clearance still keeps the button clear of the nav.
const FOOTER_GAP = 8;
// When a footer or a bleedBottom child owns the true bottom edge instead, the
// plain content keeps only its own internal base padding (spacing(4) = 16),
// with no tab-bar clearance — the sibling/child reserves that.
const CONTENT_BASE_PADDING = 16;

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

  it('pads the footer clear of the floating tab bar (tab-bar height + bottom safe-area inset)', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    // The safe-area mock reports a 0 bottom inset, so the clearance collapses to
    // the mocked tab-bar height, added on top of the footer's clamped gap.
    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
  });

  it('pads the plain (non-scrolling) content clear of the floating tab bar too', async () => {
    const { getByTestId } = await render(
      <Screen>
        <Text>content</Text>
      </Screen>,
    );

    const contentStyle = StyleSheet.flatten(getByTestId(CONTENT_TEST_ID).props.style);

    // Same clearance as the scroll+footer path: the mocked tab-bar height on
    // top of the content's clamped gap (the safe-area mock reports a 0
    // bottom inset).
    expect(contentStyle.paddingBottom).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
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

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    expect(footerStyle.paddingBottom).toBe(FOOTER_GAP + MOCK_TAB_BAR_HEIGHT);
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

  it('clamps the footer gap to the minimal safe gap rather than the full base gap', async () => {
    const { getByTestId } = await render(
      <Screen scroll footer={<Text>footer content</Text>}>
        <Text>content</Text>
      </Screen>,
    );

    const footerStyle = StyleSheet.flatten(getByTestId(FOOTER_TEST_ID).props.style);

    // A 1.5-button-height (75) reduction over-shoots the old spacing(4) = 16
    // gap, so the breathing room clamps to the minimal safe spacing(2) = 8 —
    // strictly less than the original base gap, and still clearing the tab bar.
    const originalBaseGap = 16;
    expect(footerStyle.paddingBottom - MOCK_TAB_BAR_HEIGHT).toBe(FOOTER_GAP);
    expect(footerStyle.paddingBottom - MOCK_TAB_BAR_HEIGHT).toBeLessThan(originalBaseGap);
  });
});
