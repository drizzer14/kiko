import i18next from 'i18next';
import { settingsRepo } from '@kiko/settings';
import { openSqliteWorld } from '@kiko/test-support/sqlite-live-query';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { seedRecurringWorld } from '@kiko/test-support/recurring-sqlite-world';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { at, chargeOf, ledgerOf, monthly } from '@kiko/test-support/recurring-ledger';
import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { renderStackInContainer, stackProbe } from '@kiko/test-support/navigator-stack-probe';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type { DetectedPeriod, RecurringPeriod } from '@kiko/recurring/detection';

import HomeStack from '../home-stack';
import { SETTLE_DELAY_MS } from '../pane-stack';

import SettingsStack from '.';

/**
 * A mark set in the transaction form, reached through a link, changes what Back shows. The hook
 * (`useRecurringSeries`), the detection, the settings parser and every repository are the real
 * ones, over a real migrated SQLite database whose live reads (the real `useLiveQuery`) fire on
 * a committed write (`sqlite-live-query`). Doubles: the menu row that opens the list, the layout
 * mode, the sync hooks, the held-currencies hook and the Home and Statistics screens of the Home
 * stack.
 */

type Row = ReturnType<typeof monthly>[number];
type View = Awaited<ReturnType<typeof renderStackInContainer>>;
type LayoutMode = 'single' | 'columns';

const NOW = new Date(2026, 10, 4, 9, 0).getTime();

// The import of the Home stack loads the screens that name these doubles first, so the factories
// read the shared data layer only when they run.
const syncDoubles = () =>
  require('@kiko/test-support/transaction-form-data-layer').transactionFormDataLayer;

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);
jest.mock('@kiko/db/client', () => require('@kiko/test-support/sqlite-live-query').clientModule());
jest.mock('@kiko/screens/home', () => {
  const { Text } = require('react-native');

  const HomeStub = () => <Text>Home</Text>;

  return { __esModule: true, default: HomeStub };
});
jest.mock('@kiko/screens/statistics', () => {
  const { Text } = require('react-native');

  const StatisticsStub = () => <Text>Statistics</Text>;

  return { __esModule: true, default: StatisticsStub };
});
jest.mock('@kiko/bonds/bond-register-repo', () => ({
  ...jest.requireActual('@kiko/bonds/bond-register-repo'),
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/sync/use-sync', () => syncDoubles().useSync);
jest.mock('@kiko/sync/use-crypto-sync', () => syncDoubles().useCryptoSync);
jest.mock('@kiko/sync/refresh-market-data', () => syncDoubles().refreshMarketData);
jest.mock('@kiko/loans/use-loan-auto-link', () => syncDoubles().loanAutoLink);
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

// The menu: its recurring row opens the list in the detail pane, as the real menu does.
jest.mock('@kiko/screens/settings/settings', () => {
  const { Pressable, Text } = require('react-native');
  const { useOpenInPane } = require('@kiko/navigation/pane-stack');

  const SettingsMenu = () => {
    const openInPane = useOpenInPane();

    return (
      <Pressable
        testID="settings-row-recurring-charges"
        onPress={() => openInPane('RecurringCharges')}
      >
        <Text>Recurring charges</Text>
      </Pressable>
    );
  };

  return { __esModule: true, default: SettingsMenu };
});

jest.setTimeout(30_000);

const navigationRef = createNavigationContainerRef<ParamListBase>();

const { routeNames } = stackProbe(navigationRef);

const FIELD_LABEL = i18next.t('forms.transaction.markRecurring');
const NOT_MARKED = i18next.t('forms.transaction.notMarkedRecurring');
const ROUTES_TO_SERIES = ['Settings', 'RecurringCharges', 'RecurringSeries'];

const periodLabel = (period: RecurringPeriod): string =>
  i18next.t(`forms.transaction.recurringPeriod.${period}`);

const detectedLabel = (period: DetectedPeriod): string =>
  i18next.t(`forms.transaction.detectedRecurring.${period}`);

const apple = { description: 'Apple' } as const;
const cheap = (count: number) => monthly(count, 5, 99, { ...apple, prefix: 'cheap' });
const dear = monthly(10, 20, 399, { ...apple, prefix: 'dear' });
const risen = chargeOf('rise', at(2026, 8, 12), 119, apple);

const NETFLIX_FIVE = monthly(5, 15, 100);

type Mark = { name: string; amountMinorUnits: number; period?: RecurringPeriod };

const NETFLIX_AT_100: Mark = { name: 'Netflix', amountMinorUnits: 10_000 };
const APPLE_AT_99: Mark = { name: 'Apple', amountMinorUnits: 9_900 };

const arrange = async (rows: Row[], marks: Mark[] = []): Promise<void> => {
  await seedRecurringWorld(ledgerOf(rows));

  for (const { name, amountMinorUnits, period = 'monthly' } of marks) {
    await settingsRepo.markRecurringCharge(name.toLowerCase(), name, {
      currency: 'UAH',
      amountMinorUnits,
      period,
    });
  }
};

const renderSettings = async (mode: LayoutMode): Promise<View> => {
  await emitLayoutMode(mode);

  return renderStackInContainer(navigationRef, SettingsStack, GestureRootWrapper);
};

const openSeries = async (view: View, rowId: string): Promise<void> => {
  await fireEvent.press(view.getByTestId('settings-row-recurring-charges'));
  await fireEvent.press(await view.findByTestId(`recurring-series-row-${rowId}`));
};

const openCharge = async (view: View, chargeId: string): Promise<void> => {
  await fireEvent.press(await view.findByTestId(`recurring-series-charge-${chargeId}`));
};

// The field, once its reads have settled, and the text it shows.
const fieldReads = async (view: View, label: string): Promise<void> => {
  await waitFor(() => {
    const field = view.getByLabelText(FIELD_LABEL);

    expect(field.props.accessibilityState.disabled).toBeFalsy();
    expect(within(field).queryByText(label)).not.toBeNull();
  });
};

const pick = async (view: View, label: string, readsAfter = label): Promise<void> => {
  await fireEvent.press(view.getByLabelText(FIELD_LABEL));
  await fireEvent.press(view.getByLabelText(label));
  await fieldReads(view, readsAfter);
};

// A change between one pane and two reaches the stack once the mode has held still.
const changeLayout = async (mode: LayoutMode): Promise<void> => {
  await emitLayoutMode(mode);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS + 50));
  });
};

const goBack = async (): Promise<void> => {
  await waitFor(() => expect(navigationRef.canGoBack()).toBe(true));
  await act(async () => navigationRef.goBack());
};

const seriesParams = (): object | undefined =>
  navigationRef.getRootState()?.routes.find(({ name }) => name === 'RecurringSeries')?.params;

const markedLine = (period: RecurringPeriod): string =>
  i18next.t(`recurringCharges.marked.${period}`);

// A marked series: Remove mark in place of "Not a recurring charge", its charge count and, where
// charges do not fit their period, the "Marked:" line. A series whose charges all fit keeps the
// detected wording, so `line` is stated only where the world makes it a "Marked:" one.
const expectMarkedSeries = async (
  view: View,
  { line, count }: { line?: string; count: number },
): Promise<void> => {
  await view.findByTestId('recurring-series-remove-mark');

  const header = view.getByTestId('recurring-series-header');

  expect(view.queryByTestId('recurring-series-hide')).toBeNull();
  expect(view.queryByTestId('recurring-series-empty')).toBeNull();

  if (line !== undefined) {
    expect(within(header).getByText(line)).toBeTruthy();
  }

  expect(within(header).getByTestId('recurring-series-summary-charge-count')).toHaveTextContent(
    String(count),
    { exact: true },
  );
};

const expectDetectedSeries = async (view: View): Promise<void> => {
  await view.findByTestId('recurring-series-hide');

  expect(view.queryByTestId('recurring-series-remove-mark')).toBeNull();
  expect(view.queryByTestId('recurring-series-empty')).toBeNull();
};

// The neutral text about the list, with no series, no button and no charge.
const expectNeutralText = async (view: View): Promise<void> => {
  await view.findByTestId('recurring-series-empty');

  expect(view.queryByTestId('recurring-series-hide')).toBeNull();
  expect(view.queryByTestId('recurring-series-remove-mark')).toBeNull();
  expect(view.queryByTestId('recurring-series-header')).toBeNull();
  expect(view.queryAllByTestId(/^recurring-series-charge-/)).toHaveLength(0);
};

let clock: jest.SpyInstance;

beforeEach(() => {
  clock = jest.spyOn(Date, 'now').mockImplementation(() => NOW);
  resetLayoutMode();
  openSqliteWorld();
});

afterEach(() => {
  clock.mockRestore();
  resetLayoutMode();
});

describe.each<[string, LayoutMode]>([
  ['one pane', 'single'],
  ['two panes', 'columns'],
])('Settings stack, %s: a mark set through a link', (_title, mode) => {
  it('shows the marked series of the key on Back after a detected series is marked whole', async () => {
    await arrange(NETFLIX_FIVE);

    const view = await renderSettings(mode);

    await openSeries(view, 'charge-4');
    await expectDetectedSeries(view);
    await openCharge(view, 'charge-0');
    await fieldReads(view, detectedLabel('monthly'));
    await pick(view, periodLabel('monthly'));
    await goBack();

    expect(routeNames()).toEqual(ROUTES_TO_SERIES);

    await expectMarkedSeries(view, { count: 5 });
  });

  it('shows the neutral text on Back after a 130 row of a detected x8 is marked', async () => {
    await arrange(monthly(8, 7, (index) => (index < 3 ? 130 : 100)));

    const view = await renderSettings(mode);

    await openSeries(view, 'charge-7');
    await expectDetectedSeries(view);
    await openCharge(view, 'charge-0');
    await fieldReads(view, detectedLabel('monthly'));
    await pick(view, periodLabel('monthly'));
    await goBack();
    await expectNeutralText(view);
  });

  it.each<[string, Row[], Mark, string, string, number, string]>([
    [
      'one detected series',
      NETFLIX_FIVE,
      NETFLIX_AT_100,
      'charge-4',
      'charge-0',
      5,
      detectedLabel('monthly'),
    ],
    [
      'Apple 99 beside detected 399',
      [...cheap(10), ...dear],
      APPLE_AT_99,
      'cheap-9',
      'cheap-0',
      10,
      detectedLabel('monthly'),
    ],
    [
      'marks-only 99 x2 beside detected 399 x10',
      [...cheap(2), ...dear],
      APPLE_AT_99,
      'cheap-1',
      'cheap-0',
      2,
      NOT_MARKED,
    ],
  ])(
    'shows the neutral text on Back after "Not marked" on a marked series: %s',
    async (_world, rows, mark, rowId, chargeId, count, readsAfter) => {
      await arrange(rows, [mark]);

      const view = await renderSettings(mode);

      await openSeries(view, rowId);
      await expectMarkedSeries(view, { count });
      await openCharge(view, chargeId);
      await fieldReads(view, periodLabel('monthly'));
      await pick(view, NOT_MARKED, readsAfter);
      await goBack();
      await expectNeutralText(view);
    },
  );

  it('shows the marked x11, yearly, and never the 399, after a yearly pick on the 119 row', async () => {
    await arrange([...cheap(10), risen, ...dear], [APPLE_AT_99]);

    const view = await renderSettings(mode);

    await openSeries(view, 'cheap-9');
    await expectMarkedSeries(view, { count: 11 });
    await openCharge(view, 'rise');
    await fieldReads(view, periodLabel('monthly'));
    await pick(view, periodLabel('yearly'));
    await goBack();
    await expectMarkedSeries(view, { line: markedLine('yearly'), count: 11 });

    expect(view.getByTestId('recurring-series-charge-rise')).toBeTruthy();
    expect(view.queryByTestId('recurring-series-charge-dear-0')).toBeNull();
  });
});

describe('Settings stack: a fold with a marked series and its form open', () => {
  it('keeps the route and its stored amount, and Back shows the marked x11, yearly', async () => {
    await arrange([...cheap(10), risen, ...dear], [APPLE_AT_99]);

    const view = await renderSettings('columns');

    await openSeries(view, 'cheap-9');
    await openCharge(view, 'rise');

    const routeBefore = seriesParams();

    expect(routeBefore).toMatchObject({ markedAmountMinorUnits: 9_900 });

    await changeLayout('single');

    expect(seriesParams()).toEqual(routeBefore);

    await fieldReads(view, periodLabel('monthly'));
    await pick(view, periodLabel('yearly'));
    await changeLayout('columns');

    expect(seriesParams()).toEqual(routeBefore);

    await goBack();
    await expectMarkedSeries(view, { line: markedLine('yearly'), count: 11 });

    expect(view.queryByTestId('recurring-series-charge-dear-0')).toBeNull();
  });
});

describe('The mark field reads the same state from Home and from a series link', () => {
  const FIELD_BY_ROW: [string, string, string, string][] = [
    ['a row of the marked chain', 'cheap-0', 'cheap-9', periodLabel('monthly')],
    ['a row of the other chain', 'dear-0', 'dear-9', detectedLabel('monthly')],
  ];

  it.each(FIELD_BY_ROW)('opened from Home: %s', async (_chain, chargeId, _seriesRow, label) => {
    await arrange([...cheap(10), ...dear], [APPLE_AT_99]);

    const view = await renderStackInContainer(navigationRef, HomeStack, GestureRootWrapper);

    await act(async () => navigationRef.navigate('TransactionForm', { transactionId: chargeId }));
    await fieldReads(view, label);
  });

  it.each(FIELD_BY_ROW)(
    'opened from a series link: %s',
    async (_chain, chargeId, seriesRow, label) => {
      await arrange([...cheap(10), ...dear], [APPLE_AT_99]);

      const view = await renderSettings('single');

      await openSeries(view, seriesRow);
      await openCharge(view, chargeId);
      await fieldReads(view, label);
    },
  );
});
