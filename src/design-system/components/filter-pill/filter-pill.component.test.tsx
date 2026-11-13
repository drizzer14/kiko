import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet as UnistylesStyleSheet } from 'react-native-unistyles';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import FilterPill from './filter-pill.component';

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

  it('renders the glyph at the body icon size before the label', async () => {
    const { getByTestId } = await renderPill();
    const inOrder = getByTestId(TEST_ID).queryAll(
      (node) => node.props.fallbackName === 'tray' || node.props.children === 'Accounts · 2',
    );

    expect(inOrder.at(0)?.props.fallbackName).toBe('tray');
    expect(inOrder.at(0)?.props.size).toBe(darkTheme.iconSizes.body);
  });

  it('renders no glyph when no icon is given', async () => {
    const { getByTestId, getByText } = await renderPill({ icon: undefined });

    expect(getByText('Accounts · 2')).toBeTruthy();
    expect(getByTestId(TEST_ID).queryAll((node) => node.props.fallbackName !== undefined)).toEqual(
      [],
    );
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

  it('sets no alignSelf, so the row it sits in aligns it', async () => {
    const { getByTestId } = await renderPill();

    expect(StyleSheet.flatten(getByTestId(TEST_ID).props.style).alignSelf).toBeUndefined();
  });
});
