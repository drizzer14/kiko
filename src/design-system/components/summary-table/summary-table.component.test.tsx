import { Text as RNText } from 'react-native';
import { render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';

import SummaryTable from './summary-table.component';

describe('SummaryTable', () => {
  it('renders no heading when title is omitted', async () => {
    const { queryByText } = await render(
      <SummaryTable rows={[{ key: 'a', label: 'Transactions', value: <RNText>4</RNText> }]} />,
    );

    expect(queryByText('Transactions')).toBeTruthy();
  });

  it('renders the title as a heading above the rows', async () => {
    const { getByText } = await render(
      <SummaryTable
        title="Monobank (CSV)"
        rows={[{ key: 'a', label: 'Transactions', value: <RNText>4</RNText> }]}
      />,
    );

    expect(getByText('Monobank (CSV)')).toBeTruthy();
    expect(getByText('Transactions')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
  });

  it('renders every row label and value, in order', async () => {
    const { getByText } = await render(
      <SummaryTable
        rows={[
          { key: 'a', label: 'Principal', value: <RNText>100 UAH</RNText> },
          { key: 'b', label: 'Interest earned', value: <RNText>5 UAH</RNText> },
        ]}
      />,
    );

    expect(getByText('Principal')).toBeTruthy();
    expect(getByText('100 UAH')).toBeTruthy();
    expect(getByText('Interest earned')).toBeTruthy();
    expect(getByText('5 UAH')).toBeTruthy();
  });

  it('applies a row testID when given, for a caller migrating an existing testID', async () => {
    const { getByTestId } = await render(
      <SummaryTable
        rows={[{ key: 'a', label: 'Transactions', value: <RNText>4</RNText>, testID: 'my-row' }]}
      />,
    );

    expect(getByTestId('my-row')).toHaveTextContent('4');
  });
});
