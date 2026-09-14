import { render } from '@testing-library/react-native';
import { StyleSheet, Text as RNText } from 'react-native';

import '../../unistyles';
import Text from '../text';
import { darkTheme } from '../../theme';

import SheetFooter from '.';

const TEST_ID = 'sheet-footer';

describe('SheetFooter', () => {
  it('renders its children', async () => {
    const { getByText } = await render(
      <SheetFooter testID={TEST_ID}>
        <Text variant="body">Clear</Text>
        <Text variant="body">Save</Text>
      </SheetFooter>,
    );

    expect(getByText('Clear')).toBeTruthy();
    expect(getByText('Save')).toBeTruthy();
  });

  it('renders its children in DOM order, trailing-edge aligned', async () => {
    const { getByTestId } = await render(
      <SheetFooter testID={TEST_ID}>
        <RNText testID="footer-clear">Clear</RNText>
        <RNText testID="footer-save">Save</RNText>
      </SheetFooter>,
    );

    const order = getByTestId(TEST_ID).children.map((child) =>
      typeof child === 'string' ? child : child.props.testID,
    );

    expect(order).toEqual(['footer-clear', 'footer-save']);
  });

  it('applies the shared row layout: a horizontal, trailing-aligned row with the standard gap', async () => {
    const { getByTestId } = await render(
      <SheetFooter testID={TEST_ID}>
        <Text variant="body">Save</Text>
      </SheetFooter>,
    );

    const style = StyleSheet.flatten(getByTestId(TEST_ID).props.style) as Record<string, unknown>;

    expect(style.flexDirection).toBe('row');
    expect(style.justifyContent).toBe('flex-end');
    expect(style.alignItems).toBe('center');
    expect(style.gap).toBe(darkTheme.spacing(3));
  });
});
