import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { glyphTintsWithin } from '@kiko/test-support/glyphs-within';
import type { RenderedElement } from '@kiko/test-support/rendered-element';
import { toSFSymbolTintColor } from '@kiko/design-system/components/symbol';

import FilterPill from './filter-pill.component';

// Text's tone -> color mapping is a unistyles variant the Jest mock strips, so the label's tone
// is read from the shared mock's testID instead.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-tone').default,
}));

const TEST_ID = 'filter-pill';

const renderPill = (overrides: Partial<Parameters<typeof FilterPill>[0]> = {}) =>
  render(
    <FilterPill
      label="Accounts · 2"
      icon="tray"
      accessibilityLabel="Accounts"
      onPress={jest.fn()}
      testID={TEST_ID}
      {...overrides}
    />,
  );

const chevronsWithin = (root: RenderedElement) =>
  root.queryAll((node) => node.props.fallbackName === 'chevron.down');

describe('FilterPill', () => {
  it('paints the surface fill, hairline border and small radius of a filter', async () => {
    const { getByTestId } = await renderPill();
    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
    expect(style.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(style.borderColor).toBe(darkTheme.colors.border);
    expect(style.borderRadius).toBe(darkTheme.radii.sm);
  });

  it('pads the content by spacing 2 vertically and spacing 3 horizontally', async () => {
    const { getByTestId } = await renderPill();
    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style);

    expect(style.paddingVertical).toBe(darkTheme.spacing(2));
    expect(style.paddingHorizontal).toBe(darkTheme.spacing(3));
  });

  it('stands 36pt tall with a minimum height, never a fixed height', async () => {
    const { getByTestId } = await renderPill();
    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style);

    expect(style.minHeight).toBe(darkTheme.layout.filterPillHeight);
    expect(style.minHeight).toBe(36);
    expect(style.height).toBeUndefined();
  });

  it('restores the 44pt tap target with a 4pt hitSlop above and below', async () => {
    const { getByTestId } = await renderPill();

    expect(getByTestId(TEST_ID).props.hitSlop).toEqual({
      top: darkTheme.layout.filterPillHitSlop,
      bottom: darkTheme.layout.filterPillHitSlop,
    });
  });

  it('renders the glyph at the body icon size before the label', async () => {
    const { getByTestId } = await renderPill();
    const inOrder = getByTestId(TEST_ID).queryAll(
      (node) => node.props.fallbackName === 'tray' || node.props.children === 'Accounts · 2',
    );

    expect(inOrder.at(0)?.props.fallbackName).toBe('tray');
    expect(inOrder.at(0)?.props.size).toBe(darkTheme.iconSizes.body);
  });

  it('ends with a chevron.down at the caption icon size, hidden from accessibility', async () => {
    const { getByTestId } = await renderPill();
    const inOrder = getByTestId(TEST_ID).queryAll(
      (node) =>
        node.props.children === 'Accounts · 2' || node.props.fallbackName === 'chevron.down',
    );
    const [chevron] = chevronsWithin(getByTestId(TEST_ID));

    expect(inOrder.at(-1)?.props.fallbackName).toBe('chevron.down');
    expect(chevron.props.size).toBe(darkTheme.iconSizes.caption);
    expect(chevron.props.tintColor).toBe(toSFSymbolTintColor(darkTheme.colors.textSecondary));
    expect(chevron.parent?.props.accessibilityElementsHidden).toBe(true);
    expect(chevron.parent?.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('keeps the surface fill and textPrimary glyph while inactive', async () => {
    const { getByTestId } = await renderPill();
    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
    expect(style.borderColor).toBe(darkTheme.colors.border);
    expect(glyphTintsWithin(getByTestId(TEST_ID)).at(0)).toBe(
      toSFSymbolTintColor(darkTheme.colors.textPrimary),
    );
  });

  it('paints an active pill with the accentSubtle fill, an accent hairline border and an accent glyph', async () => {
    const { getByTestId } = await renderPill({ active: true });
    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors.accentSubtle);
    expect(style.borderColor).toBe(darkTheme.colors.accent);
    expect(style.borderWidth).toBe(UnistylesStyleSheet.hairlineWidth);
    expect(glyphTintsWithin(getByTestId(TEST_ID)).at(0)).toBe(
      toSFSymbolTintColor(darkTheme.colors.accent),
    );
  });

  it('keeps the label of an active pill in the primary tone', async () => {
    const { getByText } = await renderPill({ active: true });

    expect(getByText('Accounts · 2').props.testID).toBe('text-tone-textPrimary');
  });

  it('renders no leading glyph when no icon is given', async () => {
    const { getByTestId, getByText } = await renderPill({ icon: undefined });

    expect(getByText('Accounts · 2')).toBeTruthy();
    expect(
      getByTestId(TEST_ID)
        .queryAll((node) => node.props.fallbackName !== undefined)
        .map((node) => node.props.fallbackName),
    ).toEqual(['chevron.down']);
  });

  it('lets the label wrap at large text: the label box shrinks, the Text sets no numberOfLines', async () => {
    const { getByText } = await renderPill({
      label: 'A very long account name that wraps at accessibility text sizes',
    });
    const text = getByText('A very long account name that wraps at accessibility text sizes');

    expect(text.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(text.parent?.props.style).flexShrink).toBe(1);
  });

  it('reports a press', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await renderPill({ onPress });

    await fireEvent.press(getByTestId(TEST_ID));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('labels the button with accessibilityLabel, not the visible text', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await renderPill();

    expect(getByLabelText('Accounts').props.accessibilityRole).toBe('button');
    expect(queryByLabelText('Accounts · 2')).toBeNull();
    expect(getByText('Accounts · 2')).toBeTruthy();
  });

  it('reports accessibilityValue', async () => {
    const { getByLabelText } = await renderPill({ accessibilityValue: { text: '2 selected' } });

    expect(getByLabelText('Accounts').props.accessibilityValue).toEqual({ text: '2 selected' });
  });

  it('sets no alignSelf, so the row it sits in aligns it', async () => {
    const { getByTestId } = await renderPill();

    expect(StyleSheet.flatten(getByTestId(TEST_ID).props.style).alignSelf).toBeUndefined();
  });
});
