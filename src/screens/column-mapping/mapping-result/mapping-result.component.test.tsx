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

  // A currency-column-unresolved throw shows ONLY on the currency field
  // itself (validate-on-press, gated by the caller) — this block never
  // carries its own currency-specific variant, so it can never leak the red
  // message before a press or duplicate the field's own.
  it('shows no currency-specific hint when stats is undefined', async () => {
    const { queryByText } = await render(<MappingResult stats={undefined} rowErrors={[]} />);

    expect(queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
  });

  // Every OTHER required column IS mapped when a `currency: { mode: 'column' }`
  // mapping throws — the generic "choose the date, amount, description
  // columns" hint would misname the real problem, so this block shows
  // neither that hint nor a currency-specific copy of its own; the currency
  // field's own error is the sole message.
  it('shows no hint at all when stats is undefined because only the currency column is unresolved', async () => {
    const { queryByText } = await render(
      <MappingResult stats={undefined} rowErrors={[]} currencyColumnUnresolved />,
    );

    expect(queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
    expect(queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
  });

  // The heading shows in BOTH the incomplete and complete states — it never
  // jumps position/spacing when the last required column gets mapped
  // (SummaryTable gets no `title` of its own).
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

  // Every required field is mapped and the mapping applied without
  // throwing, but zero rows survived their own per-row checks — no
  // SummaryTable/example (nothing meaningful to show at count 0), and the
  // caller's own validate-on-press message renders instead.
  it('shows the noRowsResolvedError message and skips the SummaryTable when transactionCount is 0', async () => {
    const rowErrors = [{ rowNumber: 2, reason: 'date' as const, value: 'not-a-date' }];

    const { getByText, queryByTestId } = await render(
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
        noRowsResolvedError={i18n.t('columnMapping.noRowsResolvedError')}
      />,
    );

    expect(getByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeTruthy();
    expect(queryByTestId('column-mapping-transaction-count')).toBeNull();
    expect(
      getByText(i18n.t('columnMapping.rowError.date', { row: 2, value: 'not-a-date' })),
    ).toBeTruthy();
  });

  // The caller gates `noRowsResolvedError` on the first Import press the
  // same way it gates every other field's error, so an `undefined` value
  // (the pre-press state) must render nothing extra, even at
  // transactionCount 0.
  it('renders no noRowsResolvedError message when the caller has not gated one in yet', async () => {
    const { queryByText } = await render(
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
        rowErrors={[]}
      />,
    );

    expect(queryByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeNull();
  });
});
