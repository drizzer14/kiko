import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import { i18n } from '../../../i18n';

import MappingResult from './mapping-result.component';

describe('MappingResult', () => {
  it('shows the incomplete hint when stats is undefined', async () => {
    const { getByText, queryByTestId } = await render(
      <MappingResult stats={undefined} rowErrors={[]} />,
    );

    expect(getByText(i18n.t('columnMapping.incomplete'))).toBeTruthy();
    expect(queryByTestId('column-mapping-transaction-count')).toBeNull();
  });

  it('shows the transaction count and date span once stats resolve', async () => {
    const { getByTestId, queryByText } = await render(
      <MappingResult
        stats={{
          displayName: 'x',
          transactionCount: 4,
          currency: 'UAH',
          dateSpan: '01.01.2024 – 02.01.2024',
          maskedCardHints: [],
          unresolvedRowCount: 0,
          detectedCurrencies: ['UAH'],
        }}
        rowErrors={[]}
      />,
    );

    expect(getByTestId('column-mapping-transaction-count')).toHaveTextContent('4');
    expect(queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
  });

  it('renders the first 20 row errors, then a count of the rest', async () => {
    const rowErrors = Array.from({ length: 25 }, (_, index) => ({
      rowNumber: index + 2,
      reason: 'date' as const,
      value: 'x',
    }));

    const { queryAllByTestId, getByText } = await render(
      <MappingResult
        stats={{
          displayName: 'x',
          transactionCount: 0,
          currency: 'UAH',
          dateSpan: '',
          maskedCardHints: [],
          unresolvedRowCount: 0,
          detectedCurrencies: [],
        }}
        rowErrors={rowErrors}
      />,
    );

    expect(queryAllByTestId(/^column-mapping-row-error-/)).toHaveLength(20);
    expect(getByText(i18n.t('columnMapping.rowsSkipped', { count: 5 }))).toBeTruthy();
  });

  it('renders no overflow count when there are 20 or fewer row errors', async () => {
    const rowErrors = [{ rowNumber: 2, reason: 'amount' as const, value: 'x' }];

    const { queryAllByTestId, queryByText } = await render(
      <MappingResult
        stats={{
          displayName: 'x',
          transactionCount: 0,
          currency: 'UAH',
          dateSpan: '',
          maskedCardHints: [],
          unresolvedRowCount: 0,
          detectedCurrencies: [],
        }}
        rowErrors={rowErrors}
      />,
    );

    expect(queryAllByTestId(/^column-mapping-row-error-/)).toHaveLength(1);
    expect(queryByText(i18n.t('columnMapping.rowsSkipped', { count: 5 }))).toBeNull();
  });
});
