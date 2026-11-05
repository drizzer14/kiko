import type { FC } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

type ContextRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

type RouteParams = {
  seriesId: string;
  merchantKey: string;
  currency: RecurringSeries['currency'];
  period: RecurringSeries['period'];
  name: string;
};

type ScreenProps = { navigation: unknown; route: unknown };

// A key read by name, because the catalogue does not hold it before the screen lands.
const catalogueText = (key: string, options?: object): string =>
  String((i18n.t as unknown as (key: string, options?: object) => unknown)(key, options));

// Read when a test runs, not imported, so the file type-checks before the screen exists.
const screenOf = (): FC<ScreenProps> =>
  (jest.requireActual('./recurring-series.screen') as { default: FC<ScreenProps> }).default;

let mockResult: { series: RecurringSeries[]; isLoading: boolean } = {
  series: [],
  isLoading: false,
};

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockResult,
}));

const mockOpenInPane = jest.fn();

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => mockOpenInPane,
  useDetailPaneRoute: () => null,
  useIsScreenVisible: () => true,
}));

// The ledger the by-id read answers from. It returns the rows whose ids the real query binds,
// newest first, so a row missing here is a deleted row.
let mockLedger: ContextRow[] = [];

type SqlQuery = { toSQL: () => { sql: string; params: unknown[] } };

const EMPTY_READ = { data: [], isLoading: false, isFresh: true };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: SqlQuery, _tables: string[], enabled = true) => {
    const { sql, params } = query.toSQL();

    if (!enabled || !sql.includes('json_each')) {
      return EMPTY_READ;
    }

    const ids = new Set(JSON.parse(String(params[0])) as string[]);

    return {
      data: mockLedger.filter(({ id }) => ids.has(id)).sort((a, b) => b.time - a.time),
      isLoading: false,
      isFresh: true,
    };
  },
}));

const FIFTEENTH_OF_AUGUST = new Date(2026, 7, 15, 9, 30).getTime();
const FIFTEENTH_OF_SEPTEMBER = new Date(2026, 8, 15, 9, 30).getTime();
const FIFTEENTH_OF_OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();
const FIRST_OF_MAY = new Date(2026, 4, 1, 8, 0).getTime();

const seriesWith = (overrides: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'netflix-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: ['netflix-3', 'netflix-2', 'netflix-1'],
  lastChargeTime: FIFTEENTH_OF_OCTOBER,
  lastChargeAmountMinorUnits: 29900,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
  ...overrides,
});

const chargeRow = (id: string, time: number, description: string): ContextRow => ({
  id,
  amountMinorUnits: -29900,
  currency: 'UAH',
  time,
  description,
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

const NETFLIX_LEDGER = [
  chargeRow('netflix-1', FIFTEENTH_OF_AUGUST, 'Netflix'),
  chargeRow('netflix-2', FIFTEENTH_OF_SEPTEMBER, 'Netflix'),
  chargeRow('netflix-3', FIFTEENTH_OF_OCTOBER, 'Netflix'),
];

const paramsOf = (series: RecurringSeries): RouteParams => ({
  seriesId: series.id,
  merchantKey: series.merchantKey,
  currency: series.currency,
  period: series.period,
  name: series.name,
});

const chargeTestId = (id: string): string => `recurring-series-charge-${id}`;

const CHARGE_ROW = /^recurring-series-charge-/;
const HEADER = 'recurring-series-header';
const EMPTY = 'recurring-series-empty';
const LOADING = 'recurring-series-loading';

const screenElement = (params: RouteParams) => {
  const Screen = screenOf();

  return (
    <Screen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
      route={asRouteProp<ScreenProps['route']>('RecurringSeries', params)}
    />
  );
};

const renderScreen = async (
  result: typeof mockResult,
  params: RouteParams,
  ledger: ContextRow[] = NETFLIX_LEDGER,
) => {
  mockResult = result;
  mockLedger = ledger;

  const tree = await render(screenElement(params));

  return {
    ...tree,
    update: async (next: typeof mockResult, nextLedger: ContextRow[]) => {
      mockResult = next;
      mockLedger = nextLedger;
      await tree.rerender(screenElement(params));
    },
  };
};

const shownChargeIds = (getAllByTestId: (matcher: RegExp) => { props: { testID?: string } }[]) =>
  getAllByTestId(CHARGE_ROW).map((node) => node.props.testID);

const setLanguage = (language: 'en' | 'uk') =>
  act(async () => {
    await i18n.changeLanguage(language);
  });

const idsOfCount = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `netflix-${count - index}`);

const COUNT_CASES = [
  { count: 1, english: '1 charge', ukrainian: '1 списання' },
  { count: 2, english: '2 charges', ukrainian: '2 списання' },
  { count: 5, english: '5 charges', ukrainian: '5 списань' },
  { count: 21, english: '21 charges', ukrainian: '21 списання' },
];

const headerWithCount = async (count: number) => {
  const series = seriesWith({ chargeIds: idsOfCount(count) });

  return renderScreen({ series: [series], isLoading: false }, paramsOf(series), []);
};

beforeEach(async () => {
  mockOpenInPane.mockClear();
  await setLanguage('en');
});

afterEach(async () => {
  await setLanguage('en');
});

describe('RecurringSeriesScreen — header', () => {
  it('shows the recurrence line, the last-charge line and the charge count', async () => {
    const series = seriesWith({});
    const { getByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
    );

    expect(getByTestId(HEADER)).toHaveTextContent('Charged monthly, on day 15', { exact: false });
    expect(getByTestId(HEADER)).toHaveTextContent(
      `Last charge ${formatDate(FIFTEENTH_OF_OCTOBER)}`,
      { exact: false },
    );
    expect(getByTestId(HEADER)).toHaveTextContent('3 charges', { exact: false });
  });

  it('shows the no-charge-since line of a stopped series', async () => {
    const series = seriesWith({ isStopped: true, lastChargeTime: FIRST_OF_MAY });
    const { getByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
    );

    expect(getByTestId(HEADER)).toHaveTextContent(`No charge since ${formatDate(FIRST_OF_MAY)}`, {
      exact: false,
    });
  });

  it.each(COUNT_CASES)('reads $count charges as "$english"', async ({ count, english }) => {
    const { getByTestId } = await headerWithCount(count);

    expect(catalogueText('recurringCharges.chargeCount', { count })).toBe(english);
    expect(getByTestId(HEADER)).toHaveTextContent(english, { exact: false });
  });
});

describe('RecurringSeriesScreen — header in Ukrainian', () => {
  beforeEach(async () => {
    await setLanguage('uk');
  });

  it.each(COUNT_CASES)('reads $count charges as "$ukrainian"', async ({ count, ukrainian }) => {
    const { getByTestId } = await headerWithCount(count);

    expect(catalogueText('recurringCharges.chargeCount', { count })).toBe(ukrainian);
    expect(getByTestId(HEADER)).toHaveTextContent(ukrainian, { exact: false });
  });

  it('states the neutral list text literally', () => {
    expect(catalogueText('recurringCharges.listChangedTitle')).toBe('Цей список змінився');
    expect(catalogueText('recurringCharges.listChangedMessage')).toBe(
      'Поверніться назад, щоб побачити регулярні платежі в поточному вигляді.',
    );
  });
});

describe('RecurringSeriesScreen — charges', () => {
  it('lists every charge of the series newest first, with its date in the trailing slot', async () => {
    const series = seriesWith({});
    const { getAllByTestId, getByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
    );

    expect(shownChargeIds(getAllByTestId)).toEqual([
      chargeTestId('netflix-3'),
      chargeTestId('netflix-2'),
      chargeTestId('netflix-1'),
    ]);
    expect(getByTestId(chargeTestId('netflix-3'))).toHaveTextContent(
      formatDate(FIFTEENTH_OF_OCTOBER),
      { exact: false },
    );
    expect(getByTestId(chargeTestId('netflix-2'))).toHaveTextContent(
      formatDate(FIFTEENTH_OF_SEPTEMBER),
      { exact: false },
    );
    expect(getByTestId(chargeTestId('netflix-1'))).toHaveTextContent(
      formatDate(FIFTEENTH_OF_AUGUST),
      { exact: false },
    );
  });

  it('lists only the rows of this series', async () => {
    const series = seriesWith({});
    const { getAllByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
      [...NETFLIX_LEDGER, chargeRow('spotify-1', FIFTEENTH_OF_OCTOBER, 'Spotify')],
    );

    expect(shownChargeIds(getAllByTestId)).toEqual([
      chargeTestId('netflix-3'),
      chargeTestId('netflix-2'),
      chargeTestId('netflix-1'),
    ]);
  });

  it.each(['netflix-3', 'netflix-1'])(
    'opens the form of the charge %s through the pane opener',
    async (id) => {
      const series = seriesWith({});
      const { getByTestId } = await renderScreen(
        { series: [series], isLoading: false },
        paramsOf(series),
      );

      expect(mockOpenInPane).not.toHaveBeenCalled();

      await fireEvent.press(getByTestId(chargeTestId(id)));

      expect(mockOpenInPane).toHaveBeenCalledTimes(1);
      expect(mockOpenInPane).toHaveBeenCalledWith('TransactionForm', { transactionId: id });
    },
  );

  it('drops a charge deleted in a live fire from the list and keeps the others', async () => {
    const series = seriesWith({});
    const screen = await renderScreen({ series: [series], isLoading: false }, paramsOf(series));

    expect(screen.getByTestId(chargeTestId('netflix-2'))).toBeTruthy();

    await screen.update(
      { series: [seriesWith({ chargeIds: ['netflix-3', 'netflix-1'] })], isLoading: false },
      NETFLIX_LEDGER.filter(({ id }) => id !== 'netflix-2'),
    );

    expect(shownChargeIds(screen.getAllByTestId)).toEqual([
      chargeTestId('netflix-3'),
      chargeTestId('netflix-1'),
    ]);
    expect(screen.getByTestId(HEADER)).toHaveTextContent('2 charges', { exact: false });
  });
});

describe('RecurringSeriesScreen — loading', () => {
  it('shows the loading state, never the empty state, while the series read is queued', async () => {
    const { getByTestId, queryByTestId, queryAllByTestId } = await renderScreen(
      { series: [], isLoading: true },
      paramsOf(seriesWith({})),
    );

    expect(getByTestId(LOADING)).toBeTruthy();
    expect(queryByTestId(EMPTY)).toBeNull();
    expect(queryAllByTestId(CHARGE_ROW)).toHaveLength(0);
  });

  it('shows the series and no loading state once the read has settled', async () => {
    const series = seriesWith({});
    const { getByTestId, queryByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
    );

    expect(getByTestId(HEADER)).toBeTruthy();
    expect(queryByTestId(LOADING)).toBeNull();
    expect(queryByTestId(EMPTY)).toBeNull();
  });
});

describe('RecurringSeriesScreen — an id that no longer resolves', () => {
  const MOVED = seriesWith({ id: 'netflix-2', chargeIds: ['netflix-3', 'netflix-2'] });
  const MOVED_LEDGER = NETFLIX_LEDGER.filter(({ id }) => id !== 'netflix-1');
  const STALE_PARAMS = paramsOf(seriesWith({}));

  it('shows the one series with the same key, currency and period', async () => {
    const { getAllByTestId, getByTestId, queryByTestId } = await renderScreen(
      { series: [MOVED], isLoading: false },
      STALE_PARAMS,
      MOVED_LEDGER,
    );

    expect(getByTestId(HEADER)).toHaveTextContent('2 charges', { exact: false });
    expect(shownChargeIds(getAllByTestId)).toEqual([
      chargeTestId('netflix-3'),
      chargeTestId('netflix-2'),
    ]);
    expect(queryByTestId(EMPTY)).toBeNull();
  });

  it('keeps the series on screen when its earliest charge is deleted while it still lists', async () => {
    const screen = await renderScreen({ series: [seriesWith({})], isLoading: false }, STALE_PARAMS);

    expect(screen.getByTestId(chargeTestId('netflix-1'))).toBeTruthy();

    await screen.update({ series: [MOVED], isLoading: false }, MOVED_LEDGER);

    expect(screen.queryByTestId(EMPTY)).toBeNull();
    expect(screen.queryByTestId(chargeTestId('netflix-1'))).toBeNull();
    expect(shownChargeIds(screen.getAllByTestId)).toEqual([
      chargeTestId('netflix-3'),
      chargeTestId('netflix-2'),
    ]);
  });

  it.each([
    {
      title: 'no series shares its key, currency and period',
      series: [
        seriesWith({ id: 'spotify-1', merchantKey: 'spotify', name: 'Spotify' }),
        seriesWith({ id: 'netflix-9', currency: 'USD' }),
        seriesWith({ id: 'netflix-8', period: 'yearly' }),
      ],
    },
    {
      title: 'two series share its key, currency and period',
      series: [
        seriesWith({ id: 'netflix-8', chargeIds: ['netflix-8'] }),
        seriesWith({ id: 'netflix-9', chargeIds: ['netflix-9'] }),
      ],
    },
  ])('shows the neutral text and no series when $title', async ({ series }) => {
    const ledger = [
      ...NETFLIX_LEDGER,
      chargeRow('netflix-8', FIFTEENTH_OF_OCTOBER, 'Netflix'),
      chargeRow('netflix-9', FIFTEENTH_OF_OCTOBER, 'Netflix'),
      chargeRow('spotify-1', FIFTEENTH_OF_OCTOBER, 'Spotify'),
    ];
    const { getByTestId, queryByTestId, queryAllByTestId, queryByText } = await renderScreen(
      { series, isLoading: false },
      STALE_PARAMS,
      ledger,
    );

    expect(getByTestId(EMPTY)).toHaveTextContent(
      catalogueText('recurringCharges.listChangedTitle'),
      {
        exact: false,
      },
    );
    expect(getByTestId(EMPTY)).toHaveTextContent(
      catalogueText('recurringCharges.listChangedMessage'),
      {
        exact: false,
      },
    );
    expect(queryByTestId(HEADER)).toBeNull();
    expect(queryAllByTestId(CHARGE_ROW)).toHaveLength(0);
    expect(queryByText('Spotify')).toBeNull();
    expect(queryByText('Netflix')).toBeNull();
  });

  it('words the neutral text without the merchant, which a resolved series does show', async () => {
    const found = await renderScreen(
      { series: [MOVED], isLoading: false },
      STALE_PARAMS,
      MOVED_LEDGER,
    );

    expect(within(found.getByTestId(chargeTestId('netflix-3'))).getByText('Netflix')).toBeTruthy();
    found.unmount();

    const missing = await renderScreen(
      { series: [], isLoading: false },
      STALE_PARAMS,
      MOVED_LEDGER,
    );

    expect(missing.getByTestId(EMPTY)).not.toHaveTextContent(/netflix/i);
  });

  it('states the neutral text literally', () => {
    expect(catalogueText('recurringCharges.listChangedTitle')).toBe('This list has changed');
    expect(catalogueText('recurringCharges.listChangedMessage')).toBe(
      'Go back to see your recurring charges as they are now.',
    );
  });
});
