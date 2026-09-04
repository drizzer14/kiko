import { render } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import '../design-system/unistyles';
import { Money } from '../currency/money';
import EntityAmountHeader from './entity-amount-header.component';

describe('EntityAmountHeader', () => {
  it('renders the label and the formatted amount', async () => {
    const { getByText } = await render(
      <EntityAmountHeader label="Balance" money={Money.of('UAH', 150_00)} />,
    );

    expect(getByText('Balance')).toBeTruthy();
    expect(getByText(/150/)).toBeTruthy();
  });

  // The whole point of extracting the shared header (round-2 design review):
  // the holding-detail "Value" label must render through the exact same
  // component tree as account-detail's "Balance" label, not a parallel
  // hand-rolled block that can quietly drift from it.
  it('renders whatever label string a caller passes, unchanged', async () => {
    const { getByText } = await render(
      <EntityAmountHeader label="Value" money={Money.of('UAH', 1_00)} />,
    );

    expect(getByText('Value')).toBeTruthy();
  });

  it('renders no icon slot when no icon is given', async () => {
    const { queryByText } = await render(
      <EntityAmountHeader label="Balance" money={Money.of('UAH', 1_00)} />,
    );

    expect(queryByText('icon-slot-content')).toBeNull();
  });

  // The icon slot takes an already-built node — a caller resolves the
  // entity's own icon/color and hands the result in; this component never
  // reaches into entity data itself.
  it('renders a given icon node in the optional trailing slot', async () => {
    const { getByText } = await render(
      <EntityAmountHeader
        label="Balance"
        money={Money.of('UAH', 1_00)}
        icon={<RNText>icon-slot-content</RNText>}
      />,
    );

    expect(getByText('icon-slot-content')).toBeTruthy();
  });
});
