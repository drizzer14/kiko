import type { ReactNode, ComponentProps } from 'react';
import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { Money } from '@kiko/currency/money';
import { ratesRepo } from '@kiko/rates/repo';
import { formatMoney } from '@kiko/currency/format';
import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringSeriesScreen from './recurring-series.screen';

type ContextRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

type ScreenProps = ComponentProps<typeof RecurringSeriesScreen>;

type ButtonProps = {
  variant?: string;
  size?: string;
  fullWidth?: boolean;
  testID?: string;
  children: ReactNode;
  onPress: () => void;
};

let mockSeries: RecurringSeries[] = [];
let mockMarkedSeries: RecurringSeries[] = [];

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => ({
    series: mockSeries,
    markedSeries: mockMarkedSeries,
    withoutCharges: [],
    choices: new Map(),
    isLoading: false,
  }),
}));

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => jest.fn(),
  useDetailPaneRoute: () => null,
  useIsScreenVisible: () => true,
}));

// The Button variant maps to a themed fill inside a unistyles `variants` block that the Jest mock
// strips, so the screen's wiring is proven by recording the props Button receives.
const mockButtonProps = new Map<string, Omit<ButtonProps, 'children' | 'onPress'>>();

jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ children, onPress, testID, ...rest }: ButtonProps) => {
      mockButtonProps.set(String(testID), { testID, ...rest });

      return (
        <Pressable accessibilityRole="button" testID={testID} onPress={onPress}>
          <RNText>{children}</RNText>
        </Pressable>
      );
    },
  };
});

let mockLedger: ContextRow[] = [];

let mockRowsLoading = false;

const mockReadTables: string[] = [];

type SqlQuery = { toSQL: () => { sql: string; params: unknown[] } };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: SqlQuery, tables: string[]) => {
    mockReadTables.push(tables.join());

    const { sql, params } = query.toSQL();

    if (!sql.includes('json_each')) {
      return { data: [], isLoading: false, isFresh: true };
    }

    if (mockRowsLoading) {
      return { data: [], isLoading: true, isFresh: false };
    }

    const ids = new Set(JSON.parse(String(params[0])) as string[]);

    return {
      data: mockLedger.filter(({ id }) => ids.has(id)).sort((a, b) => b.time - a.time),
      isLoading: false,
      isFresh: true,
    };
  },
}));

const OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();

const seriesWith = (overrides: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id: 'netflix-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: ['netflix-3', 'netflix-2', 'netflix-1'],
  lastChargeTime: OCTOBER,
  lastChargeAmountMinorUnits: 30025,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
  ...overrides,
});

const chargeRow = (id: string, amountMinorUnits: number, currency: 'UAH' | 'USD'): ContextRow => ({
  id,
  amountMinorUnits,
  currency,
  time: OCTOBER,
  description: 'Netflix',
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  operation: null,
  holdingId: 'holding-1',
  changeGroupId: null,
  source: 'manual',
  category: null,
  accountId: 'account-1',
  accountName: 'Monobank',
  accountKind: 'bank',
  accountArchivedAt: null,
  holdingName: 'Card',
  holdingType: 'card',
  loanHoldingId: null,
});

const ledgerOf = (currency: 'UAH' | 'USD'): ContextRow[] => [
  chargeRow('netflix-1', -10000, currency),
  chargeRow('netflix-2', -20050, currency),
  chargeRow('netflix-3', -30025, currency),
];

const PAID = 10000 + 20050 + 30025;

const PAID_VALUE = 'recurring-series-summary-paid';

const MARKED = seriesWith({
  recurrence: { kind: 'marked' },
  marks: [{ currency: 'UAH', amountMinorUnits: 25000, period: 'monthly' }],
  markedSpan: { lowest: 10000, highest: 30025 },
});

const DETECTED_ROUTE = {
  seriesId: 'netflix-1',
  merchantKey: 'netflix',
  currency: 'UAH' as const,
  period: 'monthly' as const,
  name: 'Netflix',
};

const screenElement = (params: ScreenProps['route']['params']) => (
  <RecurringSeriesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
    route={asRouteProp<ScreenProps['route']>('RecurringSeries', params)}
  />
);

const renderDetected = async (
  series: RecurringSeries = seriesWith(),
  rows: ContextRow[] = ledgerOf('UAH'),
) => {
  mockSeries = [series];
  mockMarkedSeries = [];
  mockLedger = rows;

  return render(screenElement({ ...DETECTED_ROUTE, currency: series.currency }));
};

const renderMarked = async () => {
  mockSeries = [];
  mockMarkedSeries = [MARKED];
  mockLedger = ledgerOf('UAH');

  return render(screenElement({ ...DETECTED_ROUTE, markedAmountMinorUnits: 10000 }));
};

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  mockButtonProps.clear();
  mockReadTables.length = 0;
  mockRowsLoading = false;
});

describe('RecurringSeriesScreen — the footer button', () => {
  it.each([
    { kind: 'detected', testID: 'recurring-series-hide', render: renderDetected },
    { kind: 'marked', testID: 'recurring-series-remove-mark', render: renderMarked },
  ])(
    'puts the $kind series button alone in the screen footer',
    async ({ testID, render: open }) => {
      const { getByTestId, queryAllByTestId } = await open();
      const footer = within(getByTestId('screen-footer'));

      expect(footer.getByTestId(testID)).toBeTruthy();
      expect(footer.getAllByRole('button')).toHaveLength(1);
      expect(queryAllByTestId(testID)).toHaveLength(1);
    },
  );

  it.each([
    { kind: 'detected', testID: 'recurring-series-hide', render: renderDetected },
    { kind: 'marked', testID: 'recurring-series-remove-mark', render: renderMarked },
  ])(
    'makes the $kind series button a regular full-width secondary tonal one',
    async ({ testID, render: open }) => {
      await open();

      const props = mockButtonProps.get(testID);

      expect(props?.variant).toBe('secondaryTonal');
      expect(props?.size ?? 'regular').toBe('regular');
      expect(props?.fullWidth ?? true).toBe(true);
    },
  );
});

describe('RecurringSeriesScreen — all paid so far', () => {
  it('shows the sum of the listed rows in the series currency in the header', async () => {
    const { getByTestId } = await renderDetected();
    const header = within(getByTestId('recurring-series-header'));

    expect(header.getByText('All paid so far')).toBeTruthy();
    expect(header.getByTestId(PAID_VALUE)).toHaveTextContent(formatMoney(Money.of('UAH', PAID)), {
      exact: true,
    });
  });

  it('sums a series in its own currency, whatever the base currency is', async () => {
    const { getByTestId } = await renderDetected(seriesWith({ currency: 'USD' }), ledgerOf('USD'));

    expect(
      within(getByTestId('recurring-series-header')).getByTestId(PAID_VALUE),
    ).toHaveTextContent(formatMoney(Money.of('USD', PAID)), { exact: true });
  });

  it('waits for the rows read, then shows the sum', async () => {
    mockRowsLoading = true;

    const { getByTestId, queryByTestId, queryByText, rerender } = await renderDetected();

    expect(queryByText('All paid so far')).toBeNull();
    expect(queryByTestId(PAID_VALUE)).toBeNull();

    mockRowsLoading = false;
    await rerender(screenElement(DETECTED_ROUTE));

    expect(
      within(getByTestId('recurring-series-header')).getByText('All paid so far'),
    ).toBeTruthy();
    expect(getByTestId(PAID_VALUE)).toHaveTextContent(formatMoney(Money.of('UAH', PAID)), {
      exact: true,
    });
  });

  it('reads no rates for it', async () => {
    const allQuery = jest.spyOn(ratesRepo, 'allQuery');

    await renderDetected();

    expect(allQuery).not.toHaveBeenCalled();
    expect(mockReadTables).not.toContain('currency_rates');

    allQuery.mockRestore();
  });
});
