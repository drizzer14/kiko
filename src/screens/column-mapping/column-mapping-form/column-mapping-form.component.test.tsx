import { createRef } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { PreviewStats } from '@kiko/statement-import/preview-stats';

import ColumnMappingForm from './column-mapping-form.component';
import type { ColumnMappingFormProps } from './column-mapping-form.props';

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));

const columnOptions = [
  { value: 0, label: 'Column A' },
  { value: 1, label: 'Column B' },
];

const holdingOptions = [
  {
    id: 'h-first',
    name: 'First card',
    accountId: 'a-1',
    accountName: 'Bank',
    icon: 'creditcard',
    color: '#000000',
  },
  {
    id: 'h-second',
    name: 'Second card',
    accountId: 'a-1',
    accountName: 'Bank',
    icon: 'creditcard',
    color: '#000000',
  },
];

const stats: PreviewStats = {
  displayName: 'Monobank (CSV)',
  transactionCount: 1,
  currency: 'UAH',
  dateSpan: '01.01.2024 – 01.01.2024',
  maskedCardHints: [],
  unresolvedRowCount: 0,
  detectedCurrencies: ['UAH'],
  firstTransaction: {
    currency: 'UAH',
    amountMinorUnits: -12_345,
    timeSeconds: 1_751_364_900,
    description: '',
  },
};

const propsWith = (overrides: Partial<ColumnMappingFormProps> = {}): ColumnMappingFormProps => ({
  isXlsx: false,
  savedApplied: false,
  rows: [],
  headerRowIndex: undefined,
  onSelectHeaderRow: jest.fn(),
  encoding: 'utf-8',
  onEncodingChange: jest.fn(),
  effectiveDelimiter: ';',
  onDelimiterChange: jest.fn(),
  decimalSeparator: ',',
  onDecimalSeparatorChange: jest.fn(),
  columnOptions,
  dateColumn: undefined,
  onDateColumnChange: jest.fn(),
  dateFormatOptions: [{ value: 'DD.MM.YYYY', label: 'DD.MM.YYYY' }],
  dateFormat: undefined,
  onDateFormatChange: jest.fn(),
  timeZone: 'kyiv',
  onTimeZoneChange: jest.fn(),
  amountMode: 'single',
  onAmountModeChange: jest.fn(),
  amountColumn: undefined,
  onAmountColumnChange: jest.fn(),
  debitColumn: undefined,
  onDebitColumnChange: jest.fn(),
  creditColumn: undefined,
  onCreditColumnChange: jest.fn(),
  currencyMode: 'fixed',
  onCurrencyModeChange: jest.fn(),
  currencyColumn: undefined,
  onCurrencyColumnChange: jest.fn(),
  fixedCurrency: 'UAH',
  onFixedCurrencyChange: jest.fn(),
  descriptionColumn: undefined,
  onDescriptionColumnChange: jest.fn(),
  counterpartyColumn: undefined,
  onCounterpartyColumnChange: jest.fn(),
  balanceColumn: undefined,
  onBalanceColumnChange: jest.fn(),
  stats: undefined,
  rowErrors: [],
  mappingIncomplete: true,
  balancePreview: undefined,
  holdingOptions,
  holdingOptionsLoading: false,
  accountId: 'a-1',
  selectedHoldingId: undefined,
  onSelectHolding: jest.fn(),
  onCreateNewHolding: jest.fn(),
  validation: {},
  fieldRefs: {
    dateColumnFieldRef: createRef(),
    dateFormatFieldRef: createRef(),
    amountGroupFieldRef: createRef(),
    currencyGroupFieldRef: createRef(),
    descriptionColumnFieldRef: createRef(),
    resultFieldRef: createRef(),
    targetHoldingFieldRef: createRef(),
  },
  ...overrides,
});

const selectFields = [
  {
    testID: 'column-mapping-date-column',
    label: 'columnMapping.dateColumn',
    sheetTitle: 'columnMapping.dateColumnSheetTitle',
    placeholder: 'columnMapping.dateColumnPlaceholder',
  },
  {
    testID: 'column-mapping-date-format',
    label: 'columnMapping.dateFormat',
    sheetTitle: 'columnMapping.dateFormatSheetTitle',
    placeholder: 'columnMapping.dateFormatPlaceholder',
  },
  {
    testID: 'column-mapping-description-column',
    label: 'columnMapping.descriptionColumn',
    sheetTitle: 'columnMapping.descriptionColumnSheetTitle',
    placeholder: 'columnMapping.descriptionColumnPlaceholder',
  },
  {
    testID: 'column-mapping-counterparty-column',
    label: 'columnMapping.counterpartyColumn',
    sheetTitle: 'columnMapping.counterpartyColumnSheetTitle',
    placeholder: 'columnMapping.counterpartyColumnPlaceholder',
  },
  {
    testID: 'column-mapping-balance-column',
    label: 'columnMapping.balanceColumn',
    sheetTitle: 'columnMapping.balanceColumnSheetTitle',
    placeholder: 'columnMapping.balanceColumnPlaceholder',
  },
] as const;

describe('ColumnMappingForm', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  describe.each(selectFields)('the field $testID', ({ testID, label, sheetTitle, placeholder }) => {
    it('is named, and shows its own placeholder before a pick', async () => {
      const { getByTestId } = await render(<ColumnMappingForm {...propsWith()} />);

      expect(getByTestId(testID).props.accessibilityLabel).toBe(i18n.t(label));
      expect(within(getByTestId(testID)).getByText(i18n.t(placeholder))).toBeTruthy();
    });

    it('titles its picker sheet', async () => {
      const { getByTestId } = await render(<ColumnMappingForm {...propsWith()} />);

      await fireEvent.press(getByTestId(testID));

      expect(within(getByTestId(`${testID}-sheet`)).getByText(i18n.t(sheetTitle))).toBeTruthy();
    });
  });

  describe('the encoding chips', () => {
    it('are labelled, show the technical names and report the picked encoding', async () => {
      const onEncodingChange = jest.fn();
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ onEncodingChange })} />,
      );
      const chips = within(getByTestId('column-mapping-encoding'));

      expect(chips.getByText(i18n.t('columnMapping.encoding'))).toBeTruthy();

      await fireEvent.press(chips.getByText('Windows-1251'));
      await fireEvent.press(chips.getByText('UTF-8'));

      expect(onEncodingChange.mock.calls).toEqual([['windows-1251'], ['utf-8']]);
    });
  });

  describe('the delimiter chips', () => {
    it('are labelled, show a translated Tab chip and report the picked delimiter', async () => {
      const onDelimiterChange = jest.fn();
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ onDelimiterChange })} />,
      );
      const chips = within(getByTestId('column-mapping-delimiter'));

      expect(chips.getByText(i18n.t('columnMapping.delimiter'))).toBeTruthy();

      await fireEvent.press(chips.getByText(','));
      await fireEvent.press(chips.getByText(';'));
      await fireEvent.press(chips.getByText(i18n.t('columnMapping.delimiterTab')));

      expect(onDelimiterChange.mock.calls).toEqual([[','], [';'], ['\t']]);
    });

    it('selects the comma while the delimiter is still unresolved', async () => {
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ effectiveDelimiter: undefined })} />,
      );
      const chips = within(getByTestId('column-mapping-delimiter'));

      expect(chips.getByText(',').parent?.props.accessibilityState.selected).toBe(true);
      expect(chips.getByText(';').parent?.props.accessibilityState.selected).toBe(false);
    });

    it('selects the Tab chip for a tab-separated file', async () => {
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ effectiveDelimiter: '\t' })} />,
      );
      const chips = within(getByTestId('column-mapping-delimiter'));

      expect(
        chips.getByText(i18n.t('columnMapping.delimiterTab')).parent?.props.accessibilityState
          .selected,
      ).toBe(true);
    });
  });

  describe('the decimal separator chips', () => {
    it('are labelled and report the picked separator', async () => {
      const onDecimalSeparatorChange = jest.fn();
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ onDecimalSeparatorChange })} />,
      );
      const chips = within(getByTestId('column-mapping-decimal-separator'));

      expect(chips.getByText(i18n.t('columnMapping.decimalSeparator'))).toBeTruthy();

      await fireEvent.press(chips.getByText('.'));
      await fireEvent.press(chips.getByText(','));

      expect(onDecimalSeparatorChange.mock.calls).toEqual([['.'], [',']]);
    });
  });

  it('hides the encoding and delimiter chips for a spreadsheet', async () => {
    const { queryByTestId } = await render(<ColumnMappingForm {...propsWith({ isXlsx: true })} />);

    expect(queryByTestId('column-mapping-encoding')).toBeNull();
    expect(queryByTestId('column-mapping-delimiter')).toBeNull();
  });

  describe('the time zone field', () => {
    const zoneKeys = [
      ['kyiv', 'columnMapping.timeZoneKyiv'],
      ['western-europe', 'columnMapping.timeZoneWesternEurope'],
      ['central-europe', 'columnMapping.timeZoneCentralEurope'],
      ['eastern-europe', 'columnMapping.timeZoneEasternEurope'],
    ] as const;

    it('is named and titles its sheet', async () => {
      const { getByTestId } = await render(<ColumnMappingForm {...propsWith()} />);

      expect(getByTestId('column-mapping-time-zone').props.accessibilityLabel).toBe(
        i18n.t('columnMapping.timeZone'),
      );

      await fireEvent.press(getByTestId('column-mapping-time-zone'));

      expect(
        within(getByTestId('column-mapping-time-zone-sheet')).getByText(
          i18n.t('columnMapping.timeZoneSheetTitle'),
        ),
      ).toBeTruthy();
    });

    it.each(zoneKeys)('shows the translated name of %s as the picked value', async (zone, key) => {
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ timeZone: zone })} />,
      );

      expect(within(getByTestId('column-mapping-time-zone')).getByText(i18n.t(key))).toBeTruthy();
    });

    it('lists every named zone and a fixed offset in its sheet, and reports the pick', async () => {
      const onTimeZoneChange = jest.fn();
      const { getByTestId } = await render(
        <ColumnMappingForm {...propsWith({ onTimeZoneChange })} />,
      );

      await fireEvent.press(getByTestId('column-mapping-time-zone'));
      const sheet = within(getByTestId('column-mapping-time-zone-sheet'));

      for (const [, key] of zoneKeys) {
        expect(sheet.getByText(i18n.t(key))).toBeTruthy();
      }
      expect(sheet.getByText('UTC+05:45')).toBeTruthy();

      await fireEvent.press(sheet.getByText(i18n.t('columnMapping.timeZoneEasternEurope')));

      expect(onTimeZoneChange).toHaveBeenCalledWith('eastern-europe');
    });

    it('re-translates its names when the language changes', async () => {
      const { getByTestId } = await render(<ColumnMappingForm {...propsWith()} />);

      await act(async () => {
        await i18n.changeLanguage('uk');
      });
      await fireEvent.press(getByTestId('column-mapping-time-zone'));

      expect(
        within(getByTestId('column-mapping-time-zone-sheet')).getByText(
          i18n.t('columnMapping.timeZoneWesternEurope'),
        ),
      ).toBeTruthy();
      expect(i18n.t('columnMapping.timeZoneWesternEurope')).not.toBe('Western Europe (UTC+0/+1)');
    });
  });

  describe('the holding field', () => {
    it('is named and shows its placeholder before a pick', async () => {
      const { getByTestId } = await render(<ColumnMappingForm {...propsWith()} />);

      expect(getByTestId('target-holding-field').props.accessibilityLabel).toBe(
        i18n.t('statementImport.chooseHolding'),
      );
      expect(
        within(getByTestId('target-holding-field')).getByText(
          i18n.t('statementImport.chooseHoldingPlaceholder'),
        ),
      ).toBeTruthy();
    });
  });

  describe('the holding name in the result block example', () => {
    it('uses the picked holding, not another option', async () => {
      const { getByText, queryByText } = await render(
        <ColumnMappingForm
          {...propsWith({ stats, mappingIncomplete: false, selectedHoldingId: 'h-second' })}
        />,
      );

      expect(
        getByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'Second card' })),
      ).toBeTruthy();
      expect(
        queryByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'First card' })),
      ).toBeNull();
    });
  });
});
