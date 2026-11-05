import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { settingsRepo, type RecurringMerchantChoice } from '@kiko/settings';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringSeriesScreen from './recurring-series.screen';

type ContextRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

type RouteParams = {
  seriesId: string;
  merchantKey: string;
  currency: RecurringSeries['currency'];
  period: RecurringSeries['period'];
  name: string;
};

type ScreenProps = ComponentProps<typeof RecurringSeriesScreen>;

let mockResult: {
  series: RecurringSeries[];
  isLoading: boolean;
  choices?: ReadonlyMap<string, RecurringMerchantChoice>;
} = {
  series: [],
  isLoading: false,
};

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockResult,
}));

const mockOpenInPane = jest.fn();

let mockIsVisible = true;

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => mockOpenInPane,
  useDetailPaneRoute: () => null,
  useIsScreenVisible: () => mockIsVisible,
}));

// The ledger the by-id read answers from. It returns the rows whose ids the real query binds,
// newest first, so a row missing here is a deleted row.
let mockLedger: ContextRow[] = [];

type SqlQuery = { toSQL: () => { sql: string; params: unknown[] } };

const EMPTY_READ = { data: [], isLoading: false, isFresh: true };

// The by-id read of the charges answers as still loading while this is set.
let mockRowsLoading = false;

// The options each read was given on its latest render, by the tables it names.
const mockOptionsByTables = new Map<string, unknown>();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (
    query: SqlQuery,
    tables: string[],
    enabled = true,
    options: unknown = undefined,
  ) => {
    mockOptionsByTables.set(tables.join(), options);

    const { sql, params } = query.toSQL();

    if (!enabled || !sql.includes('json_each')) {
      return EMPTY_READ;
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

const screenElement = (params: RouteParams) => (
  <RecurringSeriesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigationSpy())}
    route={asRouteProp<ScreenProps['route']>('RecurringSeries', params)}
  />
);

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
  mockOptionsByTables.clear();
  mockIsVisible = true;
  mockRowsLoading = false;
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

    expect(i18n.t('recurringCharges.chargeCount', { count })).toBe(english);
    expect(getByTestId(HEADER)).toHaveTextContent(english, { exact: false });
  });
});

describe('RecurringSeriesScreen — header in Ukrainian', () => {
  beforeEach(async () => {
    await setLanguage('uk');
  });

  it.each(COUNT_CASES)('reads $count charges as "$ukrainian"', async ({ count, ukrainian }) => {
    const { getByTestId } = await headerWithCount(count);

    expect(i18n.t('recurringCharges.chargeCount', { count })).toBe(ukrainian);
    expect(getByTestId(HEADER)).toHaveTextContent(ukrainian, { exact: false });
  });

  it('states the neutral list text literally', () => {
    expect(i18n.t('recurringCharges.listChangedTitle')).toBe('Цей список змінився');
    expect(i18n.t('recurringCharges.listChangedMessage')).toBe(
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

  it('shows the loading state, never the empty state or a blank body, while the charges are read', async () => {
    mockRowsLoading = true;

    const series = seriesWith({});
    const { getByTestId, queryByTestId, queryAllByTestId } = await renderScreen(
      { series: [series], isLoading: false },
      paramsOf(series),
    );

    expect(getByTestId(HEADER)).toBeTruthy();
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

describe('RecurringSeriesScreen — live reads', () => {
  const READS = ['transactions,holdings,accounts', 'categories', 'settings'];

  it.each([
    { title: 'shows', isVisible: true, paused: false },
    { title: 'is hidden', isVisible: false, paused: true },
  ])(
    'passes paused: $paused to every read when the screen $title',
    async ({ isVisible, paused }) => {
      mockIsVisible = isVisible;

      const series = seriesWith({});

      await renderScreen({ series: [series], isLoading: false }, paramsOf(series));

      expect(Object.fromEntries(mockOptionsByTables)).toStrictEqual(
        Object.fromEntries(READS.map((tables) => [tables, { paused }])),
      );
    },
  );
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

    expect(getByTestId(EMPTY)).toHaveTextContent(i18n.t('recurringCharges.listChangedTitle'), {
      exact: false,
    });
    expect(getByTestId(EMPTY)).toHaveTextContent(i18n.t('recurringCharges.listChangedMessage'), {
      exact: false,
    });
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
    await found.unmount();

    const missing = await renderScreen(
      { series: [], isLoading: false },
      STALE_PARAMS,
      MOVED_LEDGER,
    );

    expect(missing.getByTestId(EMPTY)).not.toHaveTextContent(/netflix/i);
  });

  describe('after a charge was renamed into another merchant', () => {
    const NETFLIX_IDS = ['netflix-1', 'netflix-2', 'netflix-3', 'netflix-4'];
    const RENAMED_LEDGER = [
      ...NETFLIX_IDS.map((id, index) =>
        chargeRow(id, new Date(2026, 5 + index, 15, 9, 30).getTime(), 'Netflix'),
      ),
      chargeRow('spotify-2', new Date(2026, 6, 20, 9, 30).getTime(), 'Spotify'),
      chargeRow('spotify-3', new Date(2026, 7, 20, 9, 30).getTime(), 'Spotify'),
    ];
    const netflixRoute = paramsOf(
      seriesWith({
        id: 'netflix-1',
        chargeIds: ['netflix-4', 'netflix-3', 'netflix-2', 'netflix-1'],
      }),
    );
    // The first Netflix charge became "Spotify": the Spotify series now starts at that row and
    // the Netflix series at the next one.
    const spotifyHoldingTheOldId = seriesWith({
      id: 'netflix-1',
      merchantKey: 'spotify',
      name: 'Spotify',
      chargeIds: ['spotify-3', 'spotify-2', 'netflix-1'],
    });
    const netflixFromTheNextCharge = seriesWith({
      id: 'netflix-2',
      chargeIds: ['netflix-4', 'netflix-3', 'netflix-2'],
    });

    it('does not show the other merchant under an id that it now holds', async () => {
      const { getAllByTestId, getByTestId, queryByTestId } = await renderScreen(
        { series: [spotifyHoldingTheOldId, netflixFromTheNextCharge], isLoading: false },
        netflixRoute,
        RENAMED_LEDGER,
      );

      expect(shownChargeIds(getAllByTestId)).toEqual([
        chargeTestId('netflix-4'),
        chargeTestId('netflix-3'),
        chargeTestId('netflix-2'),
      ]);
      expect(getByTestId(HEADER)).toHaveTextContent('3 charges', { exact: false });
      expect(queryByTestId(chargeTestId('spotify-2'))).toBeNull();
      expect(queryByTestId(chargeTestId('netflix-1'))).toBeNull();
      expect(queryByTestId(EMPTY)).toBeNull();
    });

    it('shows the neutral text when no series of the route is left', async () => {
      const { getByTestId, queryAllByTestId } = await renderScreen(
        { series: [spotifyHoldingTheOldId], isLoading: false },
        netflixRoute,
        RENAMED_LEDGER,
      );

      expect(getByTestId(EMPTY)).toBeTruthy();
      expect(queryAllByTestId(CHARGE_ROW)).toHaveLength(0);
    });

    it('still shows a series found by its id under the same key and currency', async () => {
      const sameMerchantNewPeriod = seriesWith({
        id: 'netflix-1',
        period: 'weekly',
        recurrence: { kind: 'onWeekday', weekday: 2 },
        chargeIds: ['netflix-4', 'netflix-3', 'netflix-1'],
      });
      const { getAllByTestId, getByTestId } = await renderScreen(
        { series: [sameMerchantNewPeriod, spotifyHoldingTheOldId], isLoading: false },
        netflixRoute,
        RENAMED_LEDGER,
      );

      expect(shownChargeIds(getAllByTestId)).toEqual([
        chargeTestId('netflix-4'),
        chargeTestId('netflix-3'),
        chargeTestId('netflix-1'),
      ]);
      expect(getByTestId(HEADER)).toHaveTextContent('3 charges', { exact: false });
    });
  });

  it('states the neutral text literally', () => {
    expect(i18n.t('recurringCharges.listChangedTitle')).toBe('This list has changed');
    expect(i18n.t('recurringCharges.listChangedMessage')).toBe(
      'Go back to see your recurring charges as they are now.',
    );
  });
});

describe('RecurringSeriesScreen — hiding a false match', () => {
  const HIDE_BUTTON = 'recurring-series-hide';

  let hideSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  // The write the button starts, held open until the test settles it.
  let settleWrite: { resolve: () => void; reject: (reason: Error) => void };

  const openWrite = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      settleWrite = { resolve, reject };
    });

  const NETFLIX = seriesWith({});

  const hideScreen = (navigation: ReturnType<typeof navigationSpy>) => (
    <RecurringSeriesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigation)}
      route={asRouteProp<ScreenProps['route']>('RecurringSeries', paramsOf(NETFLIX))}
    />
  );

  const renderNetflix = async () => {
    const navigation = navigationSpy();

    mockResult = { series: [NETFLIX], isLoading: false };
    mockLedger = NETFLIX_LEDGER;

    const tree = await render(hideScreen(navigation));

    return { ...tree, navigation };
  };

  beforeEach(() => {
    hideSpy = jest.spyOn(settingsRepo, 'hideRecurringMerchant').mockImplementation(openWrite);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    hideSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('offers "Not a recurring charge" on a resolved series, and writes nothing before a tap', async () => {
    const { getByTestId } = await renderNetflix();

    expect(getByTestId(HIDE_BUTTON)).toHaveTextContent('Not a recurring charge');
    expect(hideSpy).not.toHaveBeenCalled();
  });

  it('offers no hide button on the neutral text, and offers it again with a series', async () => {
    const navigation = navigationSpy();

    mockResult = { series: [], isLoading: false };
    mockLedger = NETFLIX_LEDGER;

    const { getByTestId, queryByTestId, rerender } = await render(hideScreen(navigation));

    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HIDE_BUTTON)).toBeNull();

    mockResult = { series: [NETFLIX], isLoading: false };
    await rerender(hideScreen(navigation));

    expect(queryByTestId(EMPTY)).toBeNull();
    expect(getByTestId(HIDE_BUTTON)).toBeTruthy();
  });

  it('offers no hide button while the series read is loading, and offers it once loaded', async () => {
    const navigation = navigationSpy();

    mockResult = { series: [], isLoading: true };
    mockLedger = NETFLIX_LEDGER;

    const { getByTestId, queryByTestId, rerender } = await render(hideScreen(navigation));

    expect(getByTestId(LOADING)).toBeTruthy();
    expect(queryByTestId(HIDE_BUTTON)).toBeNull();

    mockResult = { series: [NETFLIX], isLoading: false };
    await rerender(hideScreen(navigation));

    expect(queryByTestId(LOADING)).toBeNull();
    expect(getByTestId(HIDE_BUTTON)).toBeTruthy();
  });

  it('states the button text literally in English', async () => {
    const { getByTestId } = await renderNetflix();

    expect(getByTestId(HIDE_BUTTON)).toHaveTextContent('Not a recurring charge');
    expect(i18n.t('recurringCharges.notRecurring')).toBe('Not a recurring charge');
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await setLanguage('uk');
    });

    it('states the button text literally', async () => {
      const { getByTestId } = await renderNetflix();

      expect(getByTestId(HIDE_BUTTON)).toHaveTextContent('Це не регулярний платіж');
      expect(i18n.t('recurringCharges.notRecurring')).toBe('Це не регулярний платіж');
    });
  });

  it('hides the merchant key with its name on a tap, and goes back only after the write', async () => {
    const { getByTestId, navigation } = await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));

    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(hideSpy).toHaveBeenCalledWith('netflix', 'Netflix');
    expect(navigation.goBack).not.toHaveBeenCalled();

    await act(async () => {
      settleWrite.resolve();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('does not go back when another screen was opened over it before the write landed', async () => {
    const { getByTestId, navigation } = await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));
    navigation.isFocused.mockReturnValue(false);
    await act(async () => {
      settleWrite.resolve();
    });

    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('blocks a second tap while the write is in flight, and takes one again once it settled', async () => {
    const { getByTestId } = await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));
    await fireEvent.press(getByTestId(HIDE_BUTTON));

    expect(hideSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleWrite.resolve();
    });
    await fireEvent.press(getByTestId(HIDE_BUTTON));

    expect(hideSpy).toHaveBeenCalledTimes(2);
  });

  it('shows the save alert and stays on a rejected write, then lets the user try again', async () => {
    const { getByTestId, navigation } = await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));
    await act(async () => {
      settleWrite.reject(new Error('disk full'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByTestId(HEADER)).toBeTruthy();

    await fireEvent.press(getByTestId(HIDE_BUTTON));

    expect(hideSpy).toHaveBeenCalledTimes(2);
  });

  it('shows no save alert when the write succeeds', async () => {
    const { getByTestId } = await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));
    await act(async () => {
      settleWrite.resolve();
    });

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps its series, never the neutral text, once the hide has fired and before it goes back', async () => {
    const { getAllByTestId, getByTestId, queryByTestId, rerender, navigation } =
      await renderNetflix();

    await fireEvent.press(getByTestId(HIDE_BUTTON));

    // The settings read has landed the hide; the hook still hands over the unfiltered series.
    mockResult = {
      series: [NETFLIX],
      isLoading: false,
      choices: new Map([['netflix', { name: 'Netflix', hidden: true }]]),
    };
    await rerender(hideScreen(navigation));

    expect(getByTestId(HEADER)).toHaveTextContent('3 charges', { exact: false });
    expect(shownChargeIds(getAllByTestId)).toHaveLength(3);
    expect(queryByTestId(EMPTY)).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
