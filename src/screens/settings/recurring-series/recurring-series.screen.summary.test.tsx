import { StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { en, uk } from '@kiko/i18n/locales';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { testIdsInOrder } from '@kiko/test-support/test-ids-in-order';
import type SummaryTable from '@kiko/design-system/components/summary-table';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringSeriesScreen from './recurring-series.screen';

type ContextRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

type ScreenProps = ComponentProps<typeof RecurringSeriesScreen>;

type TableProps = ComponentProps<typeof SummaryTable>;

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

// The real table, wrapped so a test sees how many tables the header holds and the rows each
// render gave it.
let mockTableProps: TableProps[] = [];

jest.mock('@kiko/design-system/components/summary-table', () => {
  const { View: HostView } = require('react-native');
  const actual = jest.requireActual('@kiko/design-system/components/summary-table');
  const Actual = actual.default;

  return {
    __esModule: true,
    default: (props: TableProps) => {
      mockTableProps.push(props);

      return (
        <HostView testID="summary-table-probe">
          <Actual {...props} />
        </HostView>
      );
    },
  };
});

let mockLedger: ContextRow[] = [];

let mockRowsLoading = false;

type SqlQuery = { toSQL: () => { sql: string; params: unknown[] } };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: SqlQuery) => {
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
const MAY = new Date(2026, 4, 1, 8, 0).getTime();
const QUIET_SINCE = new Date(2026, 9, 20, 18, 5).getTime();

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

const chargeRow = (id: string, amountMinorUnits: number): ContextRow => ({
  id,
  amountMinorUnits,
  currency: 'UAH',
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

const LEDGER = [
  chargeRow('netflix-1', -10000),
  chargeRow('netflix-2', -20050),
  chargeRow('netflix-3', -30025),
];

const PAID = 10000 + 20050 + 30025;

const paidText = (): string => formatMoney(Money.of('UAH', PAID), activeLocale());

const ROUTE = {
  seriesId: 'netflix-1',
  merchantKey: 'netflix',
  currency: 'UAH' as const,
  period: 'monthly' as const,
  name: 'Netflix',
};

const HEADER = 'recurring-series-header';

const VALUE = {
  repeats: 'recurring-series-summary-repeats',
  lastCharge: 'recurring-series-summary-last-charge',
  status: 'recurring-series-summary-status',
  chargeCount: 'recurring-series-summary-charge-count',
  paid: 'recurring-series-summary-paid',
};

type Labels = {
  repeats: string;
  lastCharge: string;
  status: string;
  chargeCount: string;
  paid: string;
  stopped: string;
  monthly: string;
};

const LABELS: Record<'en' | 'uk', Labels> = {
  en: {
    repeats: 'Repeats',
    lastCharge: 'Last charge',
    status: 'Status',
    chargeCount: 'Number of charges',
    paid: 'All paid so far',
    stopped: 'No recent charge',
    monthly: 'Monthly',
  },
  uk: {
    repeats: 'Періодичність',
    lastCharge: 'Останнє списання',
    status: 'Стан',
    chargeCount: 'Кількість списань',
    paid: 'Усього сплачено',
    stopped: 'Без нових списань',
    monthly: 'Щомісяця',
  },
};

const screenElement = (route: ScreenProps['route']['params'] = ROUTE) => (
  <RecurringSeriesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
    route={asRouteProp<ScreenProps['route']>('RecurringSeries', route)}
  />
);

const renderWorld = async (detected: RecurringSeries[], marked: RecurringSeries[] = []) => {
  mockSeries = detected;
  mockMarkedSeries = marked;

  return render(screenElement());
};

const renderSeries = (series: RecurringSeries) => renderWorld([series]);

const latestRows = (): TableProps['rows'] => mockTableProps.at(-1)?.rows ?? [];

const latestLabels = (): string[] => latestRows().map(({ label }) => label);

const latestWrapLabels = (): string[] =>
  latestRows()
    .filter(({ wraps }) => wraps === true)
    .map(({ label }) => label);

const MARKED_SERIES = seriesWith({
  recurrence: { kind: 'marked' },
  marks: [{ currency: 'UAH', amountMinorUnits: 25000, period: 'monthly' }],
  markedSpan: { lowest: 10000, highest: 30025 },
});

const STOPPED = seriesWith({ isStopped: true, lastChargeTime: MAY });

const QUIET = seriesWith({
  isStopped: true,
  quiet: { since: QUIET_SINCE, holdingName: 'Card' },
});

const setLanguage = (language: 'en' | 'uk') =>
  act(async () => {
    await i18n.changeLanguage(language);
  });

beforeEach(async () => {
  mockTableProps = [];
  mockLedger = LEDGER;
  mockRowsLoading = false;
  await setLanguage('en');
});

afterEach(async () => {
  await setLanguage('en');
});

describe.each(['en', 'uk'] as const)('RecurringSeriesScreen — the table, in %s', (language) => {
  const labels = LABELS[language];

  beforeEach(async () => {
    await setLanguage(language);
  });

  it('holds one table in the header, the rows in the spec order, an active series with no status', async () => {
    const { getByTestId } = await renderSeries(seriesWith());

    expect(within(getByTestId(HEADER)).getAllByTestId('summary-table-probe')).toHaveLength(1);
    expect(latestLabels()).toEqual([
      labels.repeats,
      labels.lastCharge,
      labels.chargeCount,
      labels.paid,
    ]);
    expect(within(getByTestId(HEADER)).queryByTestId(VALUE.status)).toBeNull();
  });

  it('reads each label beside its value, inside the header', async () => {
    const { getByTestId } = await renderSeries(seriesWith());
    const header = within(getByTestId(HEADER));

    expect(header.getByText(labels.repeats)).toBeTruthy();
    expect(header.getByText(labels.lastCharge)).toBeTruthy();
    expect(header.getByText(labels.chargeCount)).toBeTruthy();
    expect(header.getByText(labels.paid)).toBeTruthy();
    expect(header.getByTestId(VALUE.repeats)).toHaveTextContent(
      i18n.t('recurringCharges.monthlyOnDay', { day: 15 }),
      { exact: true },
    );
    expect(header.getByTestId(VALUE.lastCharge)).toHaveTextContent(formatDate(OCTOBER), {
      exact: true,
    });
    expect(header.getByTestId(VALUE.chargeCount)).toHaveTextContent('3', { exact: true });
    expect(header.getByTestId(VALUE.paid)).toHaveTextContent(paidText(), { exact: true });
  });

  it('shows a stopped series its status between the last charge and the count', async () => {
    const { getByTestId } = await renderSeries(STOPPED);

    expect(latestLabels()).toEqual([
      labels.repeats,
      labels.lastCharge,
      labels.status,
      labels.chargeCount,
      labels.paid,
    ]);
    expect(getByTestId(VALUE.status)).toHaveTextContent(labels.stopped, { exact: true });
    expect(getByTestId(VALUE.lastCharge)).toHaveTextContent(formatDate(MAY), { exact: true });
  });

  it('shows a quiet series the quiet text as its status, not the stopped value', async () => {
    const { getByTestId } = await renderSeries(QUIET);

    expect(getByTestId(VALUE.status)).toHaveTextContent(
      i18n.t('recurringCharges.holdingQuietSince', {
        holding: 'Card',
        date: formatDate(QUIET_SINCE),
      }),
      { exact: true },
    );
    expect(getByTestId(VALUE.lastCharge)).toHaveTextContent(formatDate(OCTOBER), {
      exact: true,
    });
  });

  it('lets only the two free-text rows wrap', async () => {
    await renderSeries(QUIET);

    expect(latestWrapLabels()).toEqual([labels.repeats, labels.status]);
  });

  it('lets only the recurrence row wrap on an active series', async () => {
    await renderSeries(seriesWith());

    expect(latestWrapLabels()).toEqual([labels.repeats]);
  });

  it('reads the marked line of a marked series as its recurrence, with no status row', async () => {
    const { getByTestId, queryByTestId } = await renderWorld([], [MARKED_SERIES]);

    expect(getByTestId(VALUE.repeats)).toHaveTextContent(labels.monthly, { exact: true });
    expect(queryByTestId(VALUE.status)).toBeNull();
    expect(getByTestId(VALUE.chargeCount)).toHaveTextContent('3', { exact: true });
  });

  it('leaves the paid row out until the rows read lands, then shows it', async () => {
    mockRowsLoading = true;

    const { getByTestId, queryByTestId, rerender } = await renderSeries(seriesWith());

    expect(latestLabels()).toEqual([labels.repeats, labels.lastCharge, labels.chargeCount]);
    expect(queryByTestId(VALUE.paid)).toBeNull();

    mockRowsLoading = false;
    await rerender(screenElement());

    expect(latestLabels()).toEqual([
      labels.repeats,
      labels.lastCharge,
      labels.chargeCount,
      labels.paid,
    ]);
    expect(getByTestId(VALUE.paid)).toHaveTextContent(paidText(), { exact: true });
  });
});

describe('RecurringSeriesScreen — the page of a joined row', () => {
  const dayOf = (month: number): number => new Date(2026, month, 15, 9, 30).getTime();
  const inCurrency = (id: string, currency: 'USD' | 'UAH', minorUnits: number, time: number) => ({
    ...chargeRow(id, minorUnits),
    currency,
    time,
  });

  const JOINED = seriesWith({
    currency: 'USD',
    chargeIds: ['usd-2', 'usd-1', 'uah-2', 'uah-1'],
    parts: [
      { id: 'usd-1', currency: 'USD', chargeIds: ['usd-2', 'usd-1'] },
      { id: 'uah-1', currency: 'UAH', chargeIds: ['uah-2', 'uah-1'] },
    ],
  });

  // The route holds the newest part's currency, as the list opens it.
  const renderJoined = () => {
    mockSeries = [JOINED];
    mockMarkedSeries = [];

    return render(screenElement({ ...ROUTE, currency: 'USD' }));
  };

  beforeEach(() => {
    mockLedger = [
      inCurrency('uah-1', 'UAH', -100_000, dayOf(2)),
      inCurrency('uah-2', 'UAH', -100_000, dayOf(3)),
      inCurrency('usd-1', 'USD', -2_500, dayOf(8)),
      inCurrency('usd-2', 'USD', -2_500, dayOf(9)),
    ];
  });

  it('lists the charges of both currencies newest first, and counts all of them', async () => {
    const { getByTestId, toJSON } = await renderJoined();
    const chargeIds = testIdsInOrder(toJSON()).filter((id) =>
      id.startsWith('recurring-series-charge-'),
    );

    expect(chargeIds).toEqual(
      ['usd-2', 'usd-1', 'uah-2', 'uah-1'].map((id) => `recurring-series-charge-${id}`),
    );
    expect(getByTestId(VALUE.chargeCount)).toHaveTextContent('4', { exact: true });
  });

  it('gives "All paid so far" one line per currency, the newest part first', async () => {
    const { getByTestId } = await renderJoined();
    const usd = formatMoney(Money.of('USD', 5_000), activeLocale());
    const uah = formatMoney(Money.of('UAH', 200_000), activeLocale());

    expect(getByTestId(VALUE.paid)).toHaveTextContent(`${usd}${uah}`, { exact: true });
  });
});

describe('RecurringSeriesScreen — the header against the charge cards', () => {
  const DIVIDER = 'recurring-series-divider';

  it('puts one divider after the summary rows and before the first charge card', async () => {
    const { toJSON } = await renderSeries(seriesWith());
    const order = testIdsInOrder(toJSON());
    const firstCharge = order.findIndex((id) => id.startsWith('recurring-series-charge-'));

    expect(order.filter((id) => id === DIVIDER)).toHaveLength(1);
    expect(firstCharge).toBeGreaterThan(-1);
    expect(order.indexOf(VALUE.paid)).toBeGreaterThan(-1);
    expect(order.indexOf(DIVIDER)).toBeGreaterThan(-1);
    expect(order.indexOf(VALUE.paid)).toBeLessThan(order.indexOf(DIVIDER));
    expect(order.indexOf(DIVIDER)).toBeLessThan(firstCharge);
  });

  it('keeps the divider on a stopped series, whose header is a row longer', async () => {
    const { getByTestId } = await renderSeries(STOPPED);

    expect(getByTestId(DIVIDER)).toBeTruthy();
  });
});

describe('RecurringSeriesScreen — the wrapped summary values', () => {
  const alignmentOf = (text: { props: { style?: unknown } }) =>
    StyleSheet.flatten(text.props.style as never)?.textAlign;

  it('right-aligns the recurrence value, so a wrapped line starts at the same edge', async () => {
    const { getByTestId } = await renderSeries(seriesWith());
    const value = within(getByTestId(VALUE.repeats)).getByText(
      i18n.t('recurringCharges.monthlyOnDay', { day: 15 }),
    );

    expect(alignmentOf(value)).toBe('right');
  });

  it('right-aligns the status value of a stopped series', async () => {
    const { getByTestId } = await renderSeries(STOPPED);

    expect(alignmentOf(within(getByTestId(VALUE.status)).getByText(LABELS.en.stopped))).toBe(
      'right',
    );
  });

  it('right-aligns the status value of a quiet series, which is the longer text', async () => {
    const { getByTestId } = await renderSeries(QUIET);
    const quietLine = i18n.t('recurringCharges.holdingQuietSince', {
      holding: 'Card',
      date: formatDate(QUIET_SINCE),
    });

    expect(alignmentOf(within(getByTestId(VALUE.status)).getByText(quietLine))).toBe('right');
  });

  it('leaves the values that never wrap as they were', async () => {
    const { getByTestId } = await renderSeries(seriesWith());

    expect(
      alignmentOf(within(getByTestId(VALUE.lastCharge)).getByText(formatDate(OCTOBER))),
    ).toBeUndefined();
  });
});

describe('RecurringSeriesScreen — the removed count text', () => {
  it.each([
    ['en', en],
    ['uk', uk],
  ])('has no plural charge-count key in %s', (_language, catalogue) => {
    const keys = Object.keys(catalogue.recurringCharges).filter((key) =>
      key.startsWith('chargeCount_'),
    );

    expect(keys).toEqual([]);
  });
});
