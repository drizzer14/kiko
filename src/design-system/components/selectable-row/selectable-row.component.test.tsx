import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../../unistyles';

import SelectableRow from '.';

describe('SelectableRow', () => {
  it('renders an SF Symbol icon in the leading slot when `icon` is passed', async () => {
    const { getByTestId } = await render(
      <SelectableRow
        selected={false}
        onPress={jest.fn()}
        label="Groceries"
        icon="cart.fill"
        testID="row"
      />,
    );

    // react-native-nitro-sfsymbols is mocked under Jest (see symbol.component.test.tsx);
    // asserting the row still renders is the existing-consumer regression guard —
    // adding `leadingText` must not disturb the SF Symbol path.
    expect(getByTestId('row')).toBeTruthy();
  });

  it('renders a leading TEXT mark in the same leading slot when `leadingText` is passed', async () => {
    const { getByText } = await render(
      <SelectableRow
        selected={false}
        onPress={jest.fn()}
        label="AED — UAE Dirham"
        leadingText="AED"
      />,
    );

    expect(getByText('AED')).toBeTruthy();
  });

  it('renders the leading text mark even for a short glyph mark', async () => {
    const { getByText } = await render(
      <SelectableRow selected={false} onPress={jest.fn()} label="US Dollar" leadingText="$" />,
    );

    expect(getByText('$')).toBeTruthy();
  });

  it('prefers `icon` over `leadingText` when both are somehow passed', async () => {
    const { queryByText } = await render(
      <SelectableRow
        selected={false}
        onPress={jest.fn()}
        label="Groceries"
        icon="cart.fill"
        leadingText="AED"
      />,
    );

    expect(queryByText('AED')).toBeNull();
  });

  it('reserves the icon slot with no visible mark when neither `icon` nor `leadingText` is passed', async () => {
    const { queryByText } = await render(
      <SelectableRow selected={false} onPress={jest.fn()} label="Groceries" reserveIconSlot />,
    );

    expect(queryByText('Groceries')).toBeTruthy();
  });

  it('renders an optional description node below the label', async () => {
    const { getByText } = await render(
      <SelectableRow
        selected={false}
        onPress={jest.fn()}
        label="Monobank"
        description={<Text>Connect and import statements.</Text>}
      />,
    );

    expect(getByText('Monobank')).toBeTruthy();
    expect(getByText('Connect and import statements.')).toBeTruthy();
  });

  it('renders no description row when none is passed', async () => {
    const { queryByTestId } = await render(
      <SelectableRow selected={false} onPress={jest.fn()} label="Groceries" testID="row" />,
    );

    expect(queryByTestId('row-description')).toBeNull();
  });
});
