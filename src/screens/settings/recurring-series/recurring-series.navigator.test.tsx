import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { renderStackInContainer, stackProbe } from '@kiko/test-support/navigator-stack-probe';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import '@kiko/test-support/mock-transaction-form-link';

import SettingsStack from '@kiko/navigation/settings-stack';
import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';

type ContextRow = Awaited<ReturnType<typeof transactionsRepo.listWithContextByIdsQuery>>[number];

const SEPTEMBER = new Date(2026, 8, 15, 9, 30).getTime();
const OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();

const MANUAL_CHARGE = 'manual-charge';
const SYNCED_CHARGE = 'synced-charge';

const mockNetflix: RecurringSeries = {
  id: 'netflix-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: [MANUAL_CHARGE, SYNCED_CHARGE],
  lastChargeTime: OCTOBER,
  lastChargeAmountMinorUnits: 29900,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
};

const chargeRow = (id: string, time: number, source: ContextRow['source']): ContextRow => ({
  id,
  amountMinorUnits: -29900,
  currency: 'UAH',
  time,
  description: 'Netflix',
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  operation: null,
  holdingId: 'holding-1',
  changeGroupId: null,
  source,
  category: null,
  accountId: 'account-1',
  accountName: 'Monobank',
  accountKind: 'bank',
  accountArchivedAt: null,
  holdingName: 'Card',
  holdingType: 'card',
  loanHoldingId: null,
});

// The newest charge is a manual row, the older one a synced row.
const mockLedger: ContextRow[] = [
  chargeRow(MANUAL_CHARGE, OCTOBER, 'manual'),
  chargeRow(SYNCED_CHARGE, SEPTEMBER, 'monobank'),
];

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => ({ series: [mockNetflix], isLoading: false }),
}));

// The by-id read answers from the ledger; every other read is empty.
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (
    query: { toSQL: () => { sql: string; params: unknown[] } },
    _tables: string[],
    enabled = true,
  ) => {
    const { sql, params } = query.toSQL();

    if (!enabled || !sql.includes('json_each')) {
      return { data: [], isLoading: false, isFresh: true };
    }

    const ids = new Set(JSON.parse(String(params[0])) as string[]);

    return {
      data: mockLedger.filter(({ id }) => ids.has(id)).sort((a, b) => b.time - a.time),
      isLoading: false,
      isFresh: true,
    };
  },
}));

// The menu: its recurring row opens the list and is marked while the list is the detail pane's
// first route, as the real menu does through the same two hooks.
jest.mock('@kiko/screens/settings/settings', () => {
  const { Pressable, Text } = require('react-native');
  const { useDetailPaneRoute, useOpenInPane } = require('@kiko/navigation/pane-stack');

  const SettingsMenu = () => {
    const openInPane = useOpenInPane();
    const detailRoute = useDetailPaneRoute();

    return (
      <Pressable
        testID="settings-row-recurring-charges"
        accessibilityState={{ selected: detailRoute?.name === 'RecurringCharges' }}
        onPress={() => openInPane('RecurringCharges')}
      >
        <Text>Recurring charges</Text>
      </Pressable>
    );
  };

  return { __esModule: true, default: SettingsMenu };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

const { routeNames, keyOf } = stackProbe(navigationRef);

type StateWithPanes = {
  routes: { key: string; name: string; params?: object }[];
  panes: Record<string, string>;
};

const state = (): StateWithPanes => navigationRef.getRootState() as unknown as StateWithPanes;

const paneOf = (name: string): string | undefined => state().panes[keyOf(name) ?? ''];

const paramsOf = (name: string): object | undefined =>
  state().routes.find((candidate) => candidate.name === name)?.params;

const SERIES_PARAMS = {
  seriesId: 'netflix-1',
  merchantKey: 'netflix',
  currency: 'UAH',
  period: 'monthly',
  name: 'Netflix',
};

const ROUTES_TO_FORM = ['Settings', 'RecurringCharges', 'RecurringSeries', 'TransactionForm'];
const ROUTES_TO_SERIES = ROUTES_TO_FORM.slice(0, 3);

type View = Awaited<ReturnType<typeof renderStackInContainer>>;

const openSeries = async (view: View) => {
  await fireEvent.press(view.getByTestId('settings-row-recurring-charges'));
  await fireEvent.press(await view.findByTestId('recurring-series-row-netflix-1'));
};

const openCharge = async (view: View, id: string) => {
  await fireEvent.press(await view.findByTestId(`recurring-series-charge-${id}`));
};

const goBack = async () => {
  await waitFor(() => expect(navigationRef.canGoBack()).toBe(true));
  await act(async () => navigationRef.goBack());
};

afterEach(() => {
  resetLayoutMode();
});

describe('Settings stack, one pane: a recurring series and its charges', () => {
  it('walks list, series, form, and back twice to the list', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
    expect(paramsOf('TransactionForm')).toEqual({ transactionId: MANUAL_CHARGE });

    await goBack();

    expect(routeNames()).toEqual(ROUTES_TO_SERIES);

    await goBack();

    expect(routeNames()).toEqual(['Settings', 'RecurringCharges']);
  });

  it('opens a synced charge read-only, the twin of a manual charge being editable', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, SYNCED_CHARGE);

    expect(view.getByTestId('form-transaction-id')).toHaveTextContent(SYNCED_CHARGE);
    expect(view.getByTestId('form-read-only')).toBeTruthy();
    expect(view.queryByTestId('form-save')).toBeNull();
  });

  it('saves a manual charge opened from the series and returns to the same series', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    const seriesKey = keyOf('RecurringSeries');

    expect(view.getByTestId('form-transaction-id')).toHaveTextContent(MANUAL_CHARGE);

    await fireEvent.press(view.getByTestId('form-save'));

    expect(routeNames()).toEqual(ROUTES_TO_SERIES);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
  });
});

describe('Settings stack, two panes: a recurring series and its charges', () => {
  beforeEach(async () => {
    resetLayoutMode();
    await emitLayoutMode('columns');
  });

  it('keeps list, series and form in the detail pane and Settings in the list pane', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(paneOf('Settings')).toBe('companion');
    expect(paneOf('RecurringCharges')).toBe('primary');
    expect(paneOf('RecurringSeries')).toBe('primary');
    expect(paneOf('TransactionForm')).toBe('primary');
  });

  it('keeps the menu row marked from the list to the form, and unmarked before the list opens', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);
    const isMarked = () =>
      view.getByTestId('settings-row-recurring-charges').props.accessibilityState.selected;

    expect(isMarked()).toBe(false);

    await fireEvent.press(view.getByTestId('settings-row-recurring-charges'));

    expect(isMarked()).toBe(true);

    await fireEvent.press(await view.findByTestId('recurring-series-row-netflix-1'));

    expect(isMarked()).toBe(true);

    await openCharge(view, MANUAL_CHARGE);

    expect(isMarked()).toBe(true);
  });

  it('saves a manual charge and leaves the series in the detail pane', async () => {
    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);
    await fireEvent.press(view.getByTestId('form-save'));

    expect(routeNames()).toEqual(ROUTES_TO_SERIES);
    expect(paneOf('RecurringSeries')).toBe('primary');
  });
});

describe('Settings stack: folding with a series open', () => {
  it('keeps the routes and params of the series and the form across a fold and an unfold', async () => {
    resetLayoutMode();
    await emitLayoutMode('columns');

    const view = await renderStackInContainer(navigationRef, SettingsStack);

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    const seriesKey = keyOf('RecurringSeries');

    await emitLayoutMode('single');

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
    expect(paramsOf('TransactionForm')).toEqual({ transactionId: MANUAL_CHARGE });

    await emitLayoutMode('columns');

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
    expect(paneOf('RecurringSeries')).toBe('primary');
  });
});
