import { render } from '@testing-library/react-native';
import { StyleSheet, Text as RNText } from 'react-native';
import '@kiko/design-system/unistyles';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

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

  it('leaves a row without the wrap flag as it always was, its value box not shrinking', async () => {
    const { getByText } = await render(
      <SummaryTable rows={[{ key: 'a', label: 'Transactions', value: <RNText>4</RNText> }]} />,
    );

    expect(() => ancestorWithStyle(getByText('4'), 'flexShrink')).toThrow();
    expect(() => ancestorWithStyle(getByText('Transactions'), 'flexShrink')).toThrow();
  });

  it('lets a wrapping row shrink its value box while its label keeps its width', async () => {
    const { getByText } = await render(
      <SummaryTable
        rows={[{ key: 'a', label: 'Name starts with', value: <RNText>Silpo</RNText>, wraps: true }]}
      />,
    );
    const labelStyle = StyleSheet.flatten(
      ancestorWithStyle(getByText('Name starts with'), 'flexShrink').props.style,
    );
    const valueStyle = StyleSheet.flatten(
      ancestorWithStyle(getByText('Silpo'), 'flexShrink').props.style,
    );

    expect(valueStyle.flexShrink).toBe(1);
    expect(labelStyle.flexShrink).toBe(0);
    expect(labelStyle.marginRight).toBeGreaterThan(0);
  });
});
