import { createRef } from 'react';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { PreviewStats } from '@kiko/statement-import/preview-stats';

import StatementPreviewBlock from './statement-preview-block.component';
import type { StatementPreviewBlockProps } from './statement-preview-block.props';

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));

const stats: PreviewStats = {
  displayName: 'Monobank (CSV)',
  transactionCount: 7,
  currency: 'UAH',
  dateSpan: '01.01.2024 – 02.01.2024',
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

const propsWith = (
  overrides: Partial<StatementPreviewBlockProps> = {},
): StatementPreviewBlockProps => ({
  stats,
  balancePreview: undefined,
  holdingOptions,
  holdingOptionsLoading: false,
  accountId: 'a-1',
  selectedHoldingId: undefined,
  onSelectHolding: jest.fn(),
  onCreateNewHolding: jest.fn(),
  targetHoldingError: undefined,
  targetHoldingFieldRef: createRef(),
  ...overrides,
});

describe('StatementPreviewBlock', () => {
  it('labels the summary rows with their translated captions next to the values', async () => {
    const { getByText, getByTestId } = await render(<StatementPreviewBlock {...propsWith()} />);

    expect(getByText(i18n.t('statementImport.transactionCountLabel'))).toBeTruthy();
    expect(getByText(i18n.t('statementImport.currencyLabel'))).toBeTruthy();
    expect(getByText(i18n.t('statementImport.dateSpanLabel'))).toBeTruthy();
    expect(getByTestId('statement-import-transaction-count')).toHaveTextContent('7');
    expect(getByTestId('statement-import-currency')).toHaveTextContent('UAH');
    expect(getByTestId('statement-import-date-span')).toHaveTextContent('01.01.2024 – 02.01.2024');
  });

  it('names the holding field and shows its placeholder before a pick', async () => {
    const { getByTestId, getByText } = await render(<StatementPreviewBlock {...propsWith()} />);

    expect(getByTestId('target-holding-field').props.accessibilityLabel).toBe(
      i18n.t('statementImport.chooseHolding'),
    );
    expect(getByText(i18n.t('statementImport.chooseHoldingPlaceholder'))).toBeTruthy();
  });

  describe('the holding name in the example transaction', () => {
    it('uses the picked holding, not another option', async () => {
      const { getByText, queryByText } = await render(
        <StatementPreviewBlock {...propsWith({ selectedHoldingId: 'h-second' })} />,
      );

      expect(
        getByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'Second card' })),
      ).toBeTruthy();
      expect(
        queryByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'First card' })),
      ).toBeNull();
    });

    it('falls back to the nameless title when no holding is picked', async () => {
      const { queryByText } = await render(<StatementPreviewBlock {...propsWith()} />);

      expect(
        queryByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'First card' })),
      ).toBeNull();
      expect(
        queryByText(i18n.t('transactions.defaultDescriptionExpense', { name: 'Second card' })),
      ).toBeNull();
    });
  });

  describe('the example transaction', () => {
    it('shows when the file has a first transaction', async () => {
      const { getByText } = await render(<StatementPreviewBlock {...propsWith()} />);

      expect(getByText(i18n.t('statementImport.exampleTransaction'))).toBeTruthy();
    });

    it('is absent when the file has none', async () => {
      const { queryByText } = await render(
        <StatementPreviewBlock
          {...propsWith({ stats: { ...stats, firstTransaction: undefined } })}
        />,
      );

      expect(queryByText(i18n.t('statementImport.exampleTransaction'))).toBeNull();
    });
  });

  describe('the masked-card list', () => {
    it('shows each hint when there are some', async () => {
      const { getByTestId } = await render(
        <StatementPreviewBlock
          {...propsWith({ stats: { ...stats, maskedCardHints: ['*1234', '*5678'] } })}
        />,
      );

      expect(getByTestId('statement-import-masked-cards')).toHaveTextContent('*1234*5678');
    });

    it('is absent when there are none', async () => {
      const { queryByTestId } = await render(<StatementPreviewBlock {...propsWith()} />);

      expect(queryByTestId('statement-import-masked-cards')).toBeNull();
    });
  });

  describe('the skipped-rows note', () => {
    it('shows the translated count when rows were skipped', async () => {
      const { getByText } = await render(
        <StatementPreviewBlock {...propsWith({ stats: { ...stats, unresolvedRowCount: 3 } })} />,
      );

      expect(getByText(i18n.t('statementImport.unresolvedRowsSkipped', { count: 3 }))).toBeTruthy();
    });

    it('is absent when no row was skipped', async () => {
      const { queryByText } = await render(<StatementPreviewBlock {...propsWith()} />);

      expect(queryByText(i18n.t('statementImport.unresolvedRowsSkipped', { count: 0 }))).toBeNull();
      expect(queryByText(/skipped/)).toBeNull();
    });
  });

  describe('the multi-currency list', () => {
    it('shows its label and every currency when the file mixes currencies', async () => {
      const { getByText, getByTestId } = await render(
        <StatementPreviewBlock
          {...propsWith({ stats: { ...stats, detectedCurrencies: ['UAH', 'USD'] } })}
        />,
      );

      expect(getByText(i18n.t('statementImport.detectedCurrenciesLabel'))).toBeTruthy();
      expect(getByTestId('statement-import-detected-currencies')).toHaveTextContent(
        `${i18n.t('statementImport.detectedCurrenciesLabel')}UAHUSD`,
      );
    });

    it('is absent for a single currency', async () => {
      const { queryByTestId } = await render(<StatementPreviewBlock {...propsWith()} />);

      expect(queryByTestId('statement-import-detected-currencies')).toBeNull();
    });
  });
});
