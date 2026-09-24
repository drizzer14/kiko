import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import { i18n } from '../../../i18n';

import MappingResult from './mapping-result.component';

describe('MappingResult', () => {
  it('shows the incomplete hint when a required field is still unmapped', async () => {
    const { getByText, queryByTestId } = await render(
      <MappingResult stats={undefined} rowErrors={[]} mappingIncomplete />,
    );

    expect(getByText(i18n.t('columnMapping.incomplete'))).toBeTruthy();
    expect(queryByTestId('column-mapping-transaction-count')).toBeNull();
  });

  // Every required field IS mapped here — `applyColumnMapping` merely failed
  // to apply (a currency-column-unresolved throw, say) — so the generic
  // "choose the date, amount, description columns" hint would misname the
  // real problem. That reason's own message shows elsewhere (the currency
  // field's error, gated on the first Import press), never a copy here.
  it('shows no hint at all when stats is undefined but every required field is mapped', async () => {
    const { queryByText } = await render(
      <MappingResult stats={undefined} rowErrors={[]} mappingIncomplete={false} />,
    );

    expect(queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
    expect(queryByText(i18n.t('columnMapping.currencyColumnUnresolvedError'))).toBeNull();
  });

  // A `currency: { mode: 'column' }` mapping can throw because its own
  // column has no data to read at all (a header-only file) — `stats` is
  // `undefined` there too, but the caller's `noRowsResolvedError` (gated on
  // the first Import press) still surfaces, the same as the "applied but 0
  // rows resolved" case below.
  it('shows the noRowsResolvedError message even when stats is undefined', async () => {
    const { getByText, queryByText } = await render(
      <MappingResult
        stats={undefined}
        rowErrors={[]}
        mappingIncomplete={false}
        noRowsResolvedError={i18n.t('columnMapping.noRowsResolvedError')}
      />,
    );

    expect(getByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeTruthy();
    expect(queryByText(i18n.t('columnMapping.incomplete'))).toBeNull();
  });

  // The heading shows in BOTH the incomplete and complete states — it never
  // jumps position/spacing when the last required column gets mapped
  // (SummaryTable gets no `title` of its own).
  it('shows exactly one "Result" heading, whether the mapping is complete or not', async () => {
    const incomplete = await render(
      <MappingResult stats={undefined} rowErrors={[]} mappingIncomplete />,
    );
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
        mappingIncomplete={false}
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
        mappingIncomplete={false}
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
        mappingIncomplete={false}
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
        mappingIncomplete={false}
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
        mappingIncomplete={false}
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
        mappingIncomplete={false}
      />,
    );

    expect(queryByText(i18n.t('columnMapping.noRowsResolvedError'))).toBeNull();
  });
});
