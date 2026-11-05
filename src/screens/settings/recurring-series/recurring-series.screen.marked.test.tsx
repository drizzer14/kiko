import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import maybe, { foldMap } from 'fnts/maybe';
import { settingsRepo } from '@kiko/settings';
import type { Currency } from '@kiko/currency/currency';
import { chargesAt } from '@kiko/test-support/marked-series-worlds';
import type { RecurringPeriod, RecurringSeries } from '@kiko/recurring/detection';
import { ledgerOf, monthly, type Ledger } from '@kiko/test-support/recurring-ledger';
import { hookStateOf, type MarkedNames } from '@kiko/test-support/marked-series-hook-result';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import RecurringSeriesScreen from './recurring-series.screen';

type ScreenProps = ComponentProps<typeof RecurringSeriesScreen>;

type RouteParams = {
  seriesId: string;
  merchantKey: string;
  currency: Currency;
  period: RecurringPeriod;
  name: string;
  markedAmountMinorUnits?: number;
};

type HookResult = ReturnType<typeof hookStateOf>;

let mockResult: HookResult;

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => mockResult,
}));

jest.mock('@kiko/navigation/pane-stack', () => ({
  ...jest.requireActual('@kiko/navigation/pane-stack'),
  useOpenInPane: () => jest.fn(),
  useDetailPaneRoute: () => null,
  useIsScreenVisible: () => true,
}));

// The charge rows are not under test here: the header holds the series that was found.
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false, isFresh: true }),
}));

const HEADER = 'recurring-series-header';
const EMPTY = 'recurring-series-empty';

const removeMarkText = (): string => i18n.t('recurringCharges.removeMark');
const notRecurringText = (): string => i18n.t('recurringCharges.notRecurring');
const lastChargeText = (series: RecurringSeries): string =>
  i18n.t('recurringCharges.lastCharge', { date: formatDate(series.lastChargeTime) });

const lowestMarkOf = (series: RecurringSeries): { markedAmountMinorUnits: number } | undefined =>
  foldMap(maybe(series.marks), (marks) => ({
    markedAmountMinorUnits: Math.min(...marks.map((mark) => mark.amountMinorUnits)),
  }));

const routeOf = (series: RecurringSeries, overrides: Partial<RouteParams> = {}): RouteParams => ({
  seriesId: series.id,
  merchantKey: series.merchantKey,
  currency: series.currency,
  period: series.period,
  name: series.name,
  ...lowestMarkOf(series),
  ...overrides,
});

const withoutAmount = (route: RouteParams): RouteParams =>
  Object.fromEntries(
    Object.entries(route).filter(([key]) => key !== 'markedAmountMinorUnits'),
  ) as RouteParams;

const must = <Value,>(value: Value | undefined, what: string): Value => {
  if (value === undefined) {
    throw new Error(`the world holds no ${what}`);
  }

  return value;
};

const markedOf = (result: HookResult, name: string): RecurringSeries =>
  must(
    result.markedSeries.find((series) => series.name === name),
    `marked series of ${name}`,
  );

const detectedOf = (result: HookResult, name: string): RecurringSeries =>
  must(
    result.series.find((series) => series.name === name),
    `detected series of ${name}`,
  );

// Apple's cheap chain at 99 and its dear one at 399, ten monthly charges each.
const appleLedger = (): Ledger =>
  ledgerOf([
    ...monthly(10, 5, 99, { prefix: 'cheap', description: 'Apple' }),
    ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
  ]);

const APPLE_MARKED: MarkedNames = ['Apple', ['monthly', 99]];

const screenElement = (params: RouteParams, navigation: ReturnType<typeof navigationSpy>) => (
  <RecurringSeriesScreen
    navigation={asNavigationProp<ScreenProps['navigation']>(navigation)}
    route={asRouteProp<ScreenProps['route']>('RecurringSeries', params)}
  />
);

const renderScreen = async (result: typeof mockResult, params: RouteParams) => {
  mockResult = result;

  const navigation = navigationSpy();
  const tree = await render(screenElement(params, navigation));

  return {
    ...tree,
    navigation,
    update: async (next: typeof mockResult) => {
      mockResult = next;
      await tree.rerender(screenElement(params, navigation));
    },
  };
};

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('RecurringSeriesScreen — a marked series', () => {
  it('shows the marked line, the last charge and the count of the series found', async () => {
    const ledger = ledgerOf(
      chargesAt('bill', [
        [2026, 8, 2, 250],
        [2026, 9, 19, 250],
        [2026, 10, 28, 250],
      ]),
    );
    const state = hookStateOf(ledger, [['Netflix', ['monthly', 250]]]);
    const series = markedOf(state, 'Netflix');
    const { getByTestId } = await renderScreen(state, routeOf(series));

    expect(getByTestId(HEADER)).toHaveTextContent(i18n.t('recurringCharges.marked.monthly'), {
      exact: false,
    });
    expect(getByTestId(HEADER)).toHaveTextContent(lastChargeText(series), { exact: false });
    expect(getByTestId(HEADER)).toHaveTextContent('3 charges', { exact: false });
  });

  it('offers only "Remove mark" on a marked series', async () => {
    const state = hookStateOf(appleLedger(), [APPLE_MARKED]);
    const { getByText, queryByText, queryByTestId } = await renderScreen(
      state,
      routeOf(markedOf(state, 'Apple')),
    );

    expect(getByText(removeMarkText())).toBeTruthy();
    expect(queryByText(notRecurringText())).toBeNull();
    expect(queryByTestId('recurring-series-hide')).toBeNull();
  });

  it.each([
    { title: 'alone', marked: [] },
    { title: 'beside a marked series', marked: [APPLE_MARKED] },
  ])('offers only "Not a recurring charge" on a detected series $title', async ({ marked }) => {
    const state = hookStateOf(appleLedger(), marked);
    const { getByText, queryByText } = await renderScreen(
      state,
      routeOf(detectedOf(state, 'Apple')),
    );

    expect(getByText(notRecurringText())).toBeTruthy();
    expect(queryByText(removeMarkText())).toBeNull();
  });

  it('states the button literally in English', async () => {
    const state = hookStateOf(appleLedger(), [APPLE_MARKED]);
    const { getByText } = await renderScreen(state, routeOf(markedOf(state, 'Apple')));

    expect(getByText('Remove mark')).toBeTruthy();
  });

  describe('in Ukrainian', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    it('states the button literally', async () => {
      const state = hookStateOf(appleLedger(), [APPLE_MARKED]);
      const { getByText } = await renderScreen(state, routeOf(markedOf(state, 'Apple')));

      expect(getByText('Зняти позначку')).toBeTruthy();
    });
  });
});

describe('RecurringSeriesScreen — removing a mark', () => {
  let removeSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  // The write the button starts, held open until the test settles it.
  let settleWrite: { resolve: () => void; reject: (reason: Error) => void };

  const APPLE = hookStateOf(appleLedger(), [APPLE_MARKED]);
  const MARKED_APPLE = markedOf(APPLE, 'Apple');

  beforeEach(() => {
    removeSpy = jest.spyOn(settingsRepo, 'removeRecurringMarks').mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => {
          settleWrite = { resolve, reject };
        }),
    );
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    removeSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('writes nothing before a tap, then removes the marks of that series under its key', async () => {
    const { getByText, navigation } = await renderScreen(APPLE, routeOf(MARKED_APPLE));

    expect(removeSpy).not.toHaveBeenCalled();

    await fireEvent.press(getByText(removeMarkText()));

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('apple', MARKED_APPLE.marks);
    expect(navigation.goBack).not.toHaveBeenCalled();

    await act(async () => {
      settleWrite.resolve();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('blocks a second tap while the write is in flight, and takes one again once it settled', async () => {
    const { getByText } = await renderScreen(APPLE, routeOf(MARKED_APPLE));

    await fireEvent.press(getByText(removeMarkText()));
    await fireEvent.press(getByText(removeMarkText()));

    expect(removeSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleWrite.resolve();
    });
    await fireEvent.press(getByText(removeMarkText()));

    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it('shows the save alert and stays on a rejected write, then lets the user try again', async () => {
    const { getByText, getByTestId, navigation } = await renderScreen(APPLE, routeOf(MARKED_APPLE));

    await fireEvent.press(getByText(removeMarkText()));
    await act(async () => {
      settleWrite.reject(new Error('disk full'));
    });

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        i18n.t('forms.fields.saveErrorTitle'),
        i18n.t('forms.fields.saveErrorMessage'),
      ),
    );
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByTestId(HEADER)).toBeTruthy();

    await fireEvent.press(getByText(removeMarkText()));

    expect(removeSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps its series, never the neutral text, between the write landing and going back', async () => {
    const { getByText, getByTestId, queryByTestId, update, navigation } = await renderScreen(
      APPLE,
      routeOf(MARKED_APPLE),
    );

    await fireEvent.press(getByText(removeMarkText()));

    // The settings read has landed the removal: both Apple chains are detected again.
    await update(hookStateOf(appleLedger(), []));

    expect(getByTestId(HEADER)).toHaveTextContent('10 charges', { exact: false });
    expect(getByTestId(HEADER)).toHaveTextContent(lastChargeText(MARKED_APPLE), { exact: false });
    expect(queryByTestId(EMPTY)).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('holds the removed series over the detected one the same route now finds, until it goes back', async () => {
    const detectedRoute = must(
      hookStateOf(appleLedger(), []).series.find(({ id }) => id === MARKED_APPLE.id),
      'detected cheap chain',
    );
    const { getByText, getByTestId, queryByTestId, update, navigation } = await renderScreen(
      APPLE,
      withoutAmount(routeOf(detectedRoute)),
    );

    expect(getByTestId('recurring-series-remove-mark')).toBeTruthy();

    await fireEvent.press(getByText(removeMarkText()));
    await update(hookStateOf(appleLedger(), []));

    expect(getByTestId('recurring-series-remove-mark')).toBeTruthy();
    expect(queryByTestId('recurring-series-hide')).toBeNull();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows the current state, not the removed series, when the write lands off the focused screen', async () => {
    const { getByText, getByTestId, queryByTestId, update, navigation } = await renderScreen(
      APPLE,
      routeOf(MARKED_APPLE),
    );

    navigation.isFocused.mockReturnValue(false);
    await fireEvent.press(getByText(removeMarkText()));
    await update(hookStateOf(appleLedger(), []));
    await act(async () => {
      settleWrite.resolve();
    });

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HEADER)).toBeNull();
    expect(queryByTestId('recurring-series-remove-mark')).toBeNull();
  });

  it('shows the current result, not the held series, after a rejected write and a changed route', async () => {
    const { getByText, getByTestId, queryByTestId, update } = await renderScreen(
      APPLE,
      routeOf(MARKED_APPLE),
    );

    await fireEvent.press(getByText(removeMarkText()));
    await act(async () => {
      settleWrite.reject(new Error('disk full'));
    });
    await update(hookStateOf(appleLedger(), []));

    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HEADER)).toBeNull();
  });

  it('shows the neutral text for the same removal made elsewhere, with no write of its own', async () => {
    const { getByTestId, queryByTestId, update } = await renderScreen(APPLE, routeOf(MARKED_APPLE));

    expect(getByTestId(HEADER)).toBeTruthy();
    expect(queryByTestId(EMPTY)).toBeNull();

    await update(hookStateOf(appleLedger(), []));

    expect(getByTestId(EMPTY)).toBeTruthy();
  });
});

describe('RecurringSeriesScreen — a route that holds the stored amount', () => {
  // Two marked chains under one key: 99 to 110 in six charges, 399 to 450 in four.
  const TWO_CHAINS = ledgerOf([
    ...monthly(6, 5, (index) => (index % 2 === 0 ? 110 : 99), {
      prefix: 'low',
      description: 'Apple',
    }),
    ...monthly(4, 20, (index) => (index % 2 === 0 ? 450 : 399), {
      prefix: 'high',
      description: 'Apple',
    }),
  ]);
  const TWO_MARKS = hookStateOf(TWO_CHAINS, [['Apple', ['monthly', 99], ['monthly', 399]]]);
  const chainOf = (count: number): RecurringSeries =>
    must(
      TWO_MARKS.markedSeries.find(({ chargeIds }) => chargeIds.length === count),
      `marked chain of ${count} charges`,
    );
  const LOW = chainOf(6);
  const HIGH = chainOf(4);

  it('starts from two marked series under one key, with a span each', () => {
    expect(TWO_MARKS.markedSeries).toHaveLength(2);
    expect(LOW.markedSpan).toEqual({ lowest: 9900, highest: 11000 });
    expect(HIGH.markedSpan).toEqual({ lowest: 39900, highest: 45000 });
  });

  it.each([
    { title: 'between its stored amounts', amount: 10500, count: '6 charges', wrong: HIGH },
    { title: 'at the top of the dear chain', amount: 45000, count: '4 charges', wrong: LOW },
    { title: 'on a stored amount', amount: 39900, count: '4 charges', wrong: LOW },
  ])(
    'finds the series whose span holds an amount $title, whatever its seriesId says',
    async ({ amount, count, wrong }) => {
      const { getByTestId, queryByTestId } = await renderScreen(
        TWO_MARKS,
        routeOf(wrong, { markedAmountMinorUnits: amount }),
      );

      expect(getByTestId(HEADER)).toHaveTextContent(count, { exact: false });
      expect(queryByTestId(EMPTY)).toBeNull();
    },
  );

  it('shows the neutral text for an amount that lies in no span, also with a matching seriesId', async () => {
    const { getByTestId, queryByTestId } = await renderScreen(
      TWO_MARKS,
      routeOf(LOW, { markedAmountMinorUnits: 20000 }),
    );

    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HEADER)).toBeNull();
  });

  it('never matches the span of another currency under the same key', async () => {
    const found = await renderScreen(TWO_MARKS, routeOf(LOW));

    expect(found.getByTestId(HEADER)).toBeTruthy();
    await found.unmount();

    const dollars: RecurringSeries = { ...LOW, currency: 'USD' };
    const missing = await renderScreen(
      { ...TWO_MARKS, markedSeries: [dollars, HIGH] },
      routeOf(LOW),
    );

    expect(missing.getByTestId(EMPTY)).toBeTruthy();
  });
});

describe('RecurringSeriesScreen — a route without the stored amount', () => {
  it('finds the marked series that holds its seriesId, not the detected one left beside it', async () => {
    const before = hookStateOf(appleLedger(), []);
    const after = hookStateOf(appleLedger(), [APPLE_MARKED]);
    const marked = markedOf(after, 'Apple');
    // The detected route of the cheap chain: its seriesId is that chain's earliest charge.
    const cheap = must(
      before.series.find(({ id }) => id === marked.id),
      'detected cheap chain',
    );
    const { getByTestId, getByText, queryByText } = await renderScreen(after, routeOf(cheap));

    expect(detectedOf(after, 'Apple').id).not.toBe(marked.id);
    expect(getByTestId(HEADER)).toHaveTextContent(lastChargeText(marked), { exact: false });
    expect(getByText(removeMarkText())).toBeTruthy();
    expect(queryByText(notRecurringText())).toBeNull();
  });

  it('finds the marked series when the whole detected series was marked in the form', async () => {
    const ledger = ledgerOf(monthly(6, 3, 419, { prefix: 'bill' }));
    const before = hookStateOf(ledger, []);
    const after = hookStateOf(ledger, [['Netflix', ['monthly', 419]]]);
    const { getByTestId, queryByTestId } = await renderScreen(
      after,
      routeOf(detectedOf(before, 'Netflix')),
    );

    expect(after.series).toEqual([]);
    expect(getByTestId(HEADER)).toHaveTextContent('6 charges', { exact: false });
    expect(queryByTestId(EMPTY)).toBeNull();
  });

  it('shows the neutral text, never a guess, once a detected x8 left and its seriesId is not in the chain', async () => {
    const ledger = ledgerOf(monthly(8, 7, (index) => (index < 3 ? 130 : 100), { prefix: 'rise' }));
    const before = hookStateOf(ledger, []);
    const after = hookStateOf(ledger, [['Netflix', ['monthly', 130]]]);
    const route = routeOf(detectedOf(before, 'Netflix'));

    expect(before.series[0].chargeIds).toHaveLength(8);
    expect(after.markedSeries[0].chargeIds).toHaveLength(3);
    expect(after.markedSeries[0].chargeIds).not.toContain(route.seriesId);

    const { getByTestId, queryByTestId } = await renderScreen(after, route);

    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HEADER)).toBeNull();
  });

  it('does not take a marked series of another key for its seriesId', async () => {
    const ledger = ledgerOf(monthly(6, 3, 419, { prefix: 'bill' }));
    const after = hookStateOf(ledger, [['Netflix', ['monthly', 419]]]);
    const marked = markedOf(after, 'Netflix');
    const own = await renderScreen(after, withoutAmount(routeOf(marked)));

    expect(own.getByTestId(HEADER)).toBeTruthy();
    await own.unmount();

    const other = await renderScreen(
      after,
      withoutAmount(routeOf(marked, { merchantKey: 'spotify' })),
    );

    expect(other.getByTestId(EMPTY)).toBeTruthy();
  });

  describe('among the detected series left beside a marked one', () => {
    const APPLE_BESIDE = hookStateOf(appleLedger(), [APPLE_MARKED]);
    const DEAR = detectedOf(APPLE_BESIDE, 'Apple');

    it('resolves its seriesId, and shows the hide button', async () => {
      const { getByTestId, getByText, queryByText } = await renderScreen(
        APPLE_BESIDE,
        routeOf(DEAR),
      );

      expect(getByTestId(HEADER)).toHaveTextContent(lastChargeText(DEAR), { exact: false });
      expect(getByText(notRecurringText())).toBeTruthy();
      expect(queryByText(removeMarkText())).toBeNull();
    });

    it('counts a seriesId hit only with its merchantKey and currency, then falls back to the one series', async () => {
      const dollars: RecurringSeries = { ...DEAR, id: 'apple-usd', currency: 'USD' };
      const { getByTestId } = await renderScreen(
        { ...APPLE_BESIDE, series: [dollars, DEAR] },
        routeOf(DEAR, { seriesId: 'apple-usd' }),
      );

      expect(getByTestId(HEADER)).toHaveTextContent(lastChargeText(DEAR), { exact: false });
    });

    it('shows the neutral text when several detected series share its key, currency and period', async () => {
      const twin: RecurringSeries = { ...DEAR, id: 'apple-twin', chargeIds: ['apple-twin'] };
      const { getByTestId } = await renderScreen(
        { ...APPLE_BESIDE, series: [DEAR, twin] },
        routeOf(DEAR, { seriesId: 'moved-away' }),
      );

      expect(getByTestId(EMPTY)).toBeTruthy();
    });
  });
});

// A marked route holds the stored amount, and its seriesId is set to an id a detected series
// holds once the mark is gone. The id must not be followed; the same route without the amount is
// the twin that shows the id does resolve.
describe('RecurringSeriesScreen — a marked route after its mark was removed', () => {
  type World = { title: string; ledger: Ledger; marked: MarkedNames[]; name: string };

  const worlds: World[] = [
    {
      title: 'Apple 99 marked beside a detected 399',
      ledger: appleLedger(),
      marked: [APPLE_MARKED],
      name: 'Apple',
    },
    {
      title: 'marked yearly over a detected monthly',
      ledger: ledgerOf(monthly(12, 3, 199, { prefix: 'bill' })),
      marked: [['Netflix', ['yearly', 199]]],
      name: 'Netflix',
    },
    {
      title: 'marked monthly over one detected monthly',
      ledger: ledgerOf(monthly(10, 5, 99, { prefix: 'bill' })),
      marked: [['Netflix', ['monthly', 99]]],
      name: 'Netflix',
    },
    {
      title: 'a marks-only 99 x2 beside a detected 399 x10',
      ledger: ledgerOf([
        ...monthly(2, 5, 99, { prefix: 'cheap', description: 'Apple' }),
        ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
      ]),
      marked: [APPLE_MARKED],
      name: 'Apple',
    },
  ];

  const routeAfterRemoval = ({ ledger, marked, name }: World) => {
    const markedRoute = routeOf(markedOf(hookStateOf(ledger, marked), name));
    const removed = hookStateOf(ledger, []);
    // A detected series still under the key, the marked chain's own id where there is one.
    const heldId = must(
      removed.series.find(({ id }) => id === markedRoute.seriesId)?.id ??
        removed.series.find(({ merchantKey }) => merchantKey === markedRoute.merchantKey)?.id,
      'detected series under the key',
    );

    return { removed, route: { ...markedRoute, seriesId: heldId } };
  };

  it.each(worlds)('shows the neutral text and no detected series: $title', async (world) => {
    const { removed, route } = routeAfterRemoval(world);
    const { getByTestId, queryByTestId, queryByText } = await renderScreen(removed, route);

    expect(route.markedAmountMinorUnits).toBeGreaterThan(0);
    expect(removed.series.some(({ id }) => id === route.seriesId)).toBe(true);
    expect(getByTestId(EMPTY)).toBeTruthy();
    expect(queryByTestId(HEADER)).toBeNull();
    expect(queryByText(notRecurringText())).toBeNull();
  });

  it.each(worlds)(
    'would resolve that detected series if the route held no stored amount: $title',
    async (world) => {
      const { removed, route } = routeAfterRemoval(world);
      const { getByTestId, getByText } = await renderScreen(removed, withoutAmount(route));

      expect(getByTestId(HEADER)).toBeTruthy();
      expect(getByText(notRecurringText())).toBeTruthy();
    },
  );
});

describe('RecurringSeriesScreen — a marked route after a pick on a row of its chain', () => {
  it('finds the marked x11 by its span, though its period and the detected 399 differ', async () => {
    const ledger = ledgerOf([
      ...monthly(10, 5, 99, { prefix: 'cheap', description: 'Apple' }),
      ...monthly(1, 12, 119, { prefix: 'odd', description: 'Apple', newest: [2026, 7] }),
      ...monthly(10, 20, 399, { prefix: 'dear', description: 'Apple' }),
    ]);
    const before = hookStateOf(ledger, [['Apple', ['monthly', 99]]]);
    const after = hookStateOf(ledger, [['Apple', ['yearly', 99]]]);
    const route = routeOf(markedOf(before, 'Apple'));
    const { getByTestId, getByText, queryByTestId } = await renderScreen(after, route);

    expect(route.period).toBe('monthly');
    expect(markedOf(after, 'Apple').period).toBe('yearly');
    expect(markedOf(after, 'Apple').chargeIds).toHaveLength(11);
    expect(detectedOf(after, 'Apple').chargeIds).toHaveLength(10);
    expect(getByTestId(HEADER)).toHaveTextContent('11 charges', { exact: false });
    expect(getByTestId(HEADER)).toHaveTextContent(i18n.t('recurringCharges.marked.yearly'), {
      exact: false,
    });
    expect(getByText(removeMarkText())).toBeTruthy();
    expect(queryByTestId(EMPTY)).toBeNull();
  });
});
