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

  // F4 audit 6: a currency column with no ISO codes throws inside
  // `applyColumnMapping` even though every required field IS mapped — the
  // generic "still missing a column" hint used to show anyway, misleading
  // the user. `currencyUnresolved` swaps in the specific reason instead.
  it('shows the currency-unresolved hint, not the generic incomplete one, when currencyUnresolved is set', async () => {
    const { getByText, queryByText } = await render(
      <MappingResult stats={undefined} rowErrors={[]} currencyUnresolved />,
    );

    expect(getByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeTruthy();
    expect(queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
  });

  // F3 fix round 1, I2: the heading shows in BOTH the incomplete and
  // complete states — it no longer jumps position/spacing when the last
  // required column gets mapped (SummaryTable gets no `title` of its own).
  it('shows exactly one "Result" heading, whether the mapping is complete or not', async () => {
    const incomplete = await render(<MappingResult stats={undefined} rowErrors={[]} />);
    expect(incomplete.getAllByText(i18n.t('columnMapping.result'))).toHaveLength(1);

    const complete = await render(
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
    expect(complete.getAllByText(i18n.t('columnMapping.result'))).toHaveLength(1);
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
