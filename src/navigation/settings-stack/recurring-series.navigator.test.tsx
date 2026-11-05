import i18next from 'i18next';
import { settingsRepo } from '@kiko/settings';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { renderStackInContainer, stackProbe } from '@kiko/test-support/navigator-stack-probe';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type { transactionsRepo } from '@kiko/transactions/repo';
import type { RecurringSeries } from '@kiko/recurring/detection';

import SettingsStack from '.';

/**
 * The recurring series screen opens a charge in the REAL transaction form, inside the REAL
 * Settings stack. Only the data layer, the menu and the series detection are doubles, so the form
 * decides read-only from the row's own source and its Save goes back through the stack.
 */

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

// The stored row the form reads by id: the ledger row plus the columns only the table has.
const storedRow = (row: ContextRow) => ({
  id: row.id,
  holdingId: row.holdingId,
  amountMinorUnits: row.amountMinorUnits,
  time: row.time,
  description: row.description,
  source: row.source,
  category: null,
  comment: null,
  loanHoldingId: null,
  loanLinkSource: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  changeGroupId: null,
  setsBalance: false,
});

const mockHoldings = [
  {
    id: 'holding-1',
    currency: 'UAH',
    balanceMinorUnits: 100000,
    type: 'card',
    name: 'Card',
    accountId: 'account-1',
  },
];

const mockUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);

jest.mock('@kiko/recurring/use-recurring-series', () => ({
  useRecurringSeries: () => ({ series: [mockNetflix], choices: new Map(), isLoading: false }),
}));

// The series screen reads its charges by id and the form reads one row by id; every other read
// answers the table's list, or nothing.
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (
    query: { toSQL: () => { sql: string; params: unknown[] } },
    tables: string[],
    enabled = true,
  ) => {
    const { sql, params } = query.toSQL();

    if (!enabled) {
      return { data: [], isLoading: false, isFresh: true };
    }

    if (sql.includes('json_each')) {
      const ids = new Set(JSON.parse(String(params[0])) as string[]);

      return {
        data: mockLedger.filter(({ id }) => ids.has(id)).sort((a, b) => b.time - a.time),
        isLoading: false,
        isFresh: true,
      };
    }

    if (sql.includes('"transactions"."id" = ?')) {
      return {
        data: mockLedger.filter(({ id }) => id === params[0]).map(storedRow),
        isLoading: false,
        isFresh: true,
      };
    }

    const dataByTable: Record<string, readonly unknown[]> = {
      holdings: mockHoldings,
      accounts: [{ id: 'account-1', name: 'Monobank' }],
      categories: [{ key: 'groceries', title: 'Groceries', icon: 'cart' }],
    };

    return { data: dataByTable[tables[0]] ?? [], isLoading: false, isFresh: true };
  },
}));

jest.mock('@kiko/transactions/repo', () => {
  const actual = jest.requireActual('@kiko/transactions/repo');

  return {
    ...actual,
    transactionsRepo: {
      ...actual.transactionsRepo,
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  };
});
jest.mock('@kiko/categories/repo', () => mockDataLayer.categoriesRepo);
jest.mock('@kiko/categories/category-rules-repo', () => mockDataLayer.categoryRulesRepo);
jest.mock('@kiko/accounts/accounts.repo', () => mockDataLayer.accountsRepo);
jest.mock('@kiko/holdings/repo', () => mockDataLayer.holdingsRepo);
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/bonds/bond-register-repo', () => mockDataLayer.bondRegisterRepo);
jest.mock('@kiko/sync/use-sync', () => mockDataLayer.useSync);
jest.mock('@kiko/sync/use-crypto-sync', () => mockDataLayer.useCryptoSync);
jest.mock('@kiko/sync/refresh-market-data', () => mockDataLayer.refreshMarketData);
jest.mock('@kiko/loans/use-loan-auto-link', () => mockDataLayer.loanAutoLink);
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

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

const renderSettings = () =>
  renderStackInContainer(navigationRef, SettingsStack, GestureRootWrapper);

type View = Awaited<ReturnType<typeof renderSettings>>;

type HeaderItem = { title: string; buttonId: string };

type HeaderConfigProps = {
  headerRightBarButtonItems?: HeaderItem[];
  onPressHeaderBarButtonItem?: (event: { nativeEvent: { buttonId: string } }) => void;
};

type RenderedNode = { type: string; props: object; children: (RenderedNode | string)[] | null };

const headerConfigsOf = (node: RenderedNode | string | null): HeaderConfigProps[] => {
  if (node === null || typeof node === 'string') {
    return [];
  }

  return [
    ...(node.type === 'RNSScreenStackHeaderConfig' ? [node.props as HeaderConfigProps] : []),
    ...(node.children ?? []).flatMap(headerConfigsOf),
  ];
};

const saveItemOnTopForm = () => {
  const tree = screen.toJSON() as RenderedNode | RenderedNode[] | null;
  const roots = Array.isArray(tree) ? tree : [tree];

  const config = roots
    .flatMap(headerConfigsOf)
    .filter((candidate) =>
      (candidate.headerRightBarButtonItems ?? []).some((item) => item.title === 'Save'),
    )
    .at(-1);

  return {
    config,
    item: config?.headerRightBarButtonItems?.find((item) => item.title === 'Save'),
  };
};

// The native bar of the form on top, pressed the way the native side reports a press.
const pressSaveOnTopForm = async (): Promise<void> => {
  const { config, item } = saveItemOnTopForm();

  expect(item).toBeDefined();

  await act(async () => {
    config?.onPressHeaderBarButtonItem?.({ nativeEvent: { buttonId: item?.buttonId ?? '' } });
  });
};

const syncedNotice = (): string => i18next.t('forms.transaction.syncedNotice');

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

beforeEach(() => {
  mockUpdate.mockClear();
});

afterEach(() => {
  resetLayoutMode();
});

describe('Settings stack, one pane: a recurring series and its charges', () => {
  it('walks list, series, form, and back twice to the list', async () => {
    const view = await renderSettings();

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

  it('opens a synced charge read-only, with no Save in the bar', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, SYNCED_CHARGE);

    expect(paramsOf('TransactionForm')).toEqual({ transactionId: SYNCED_CHARGE });
    expect(await view.findByText(syncedNotice())).toBeTruthy();
    expect(saveItemOnTopForm().item).toBeUndefined();
  });

  it('opens a manual charge editable, with no read-only notice and a Save in the bar', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    expect(await view.findByLabelText('Amount')).toBeTruthy();
    expect(view.queryByText(syncedNotice())).toBeNull();
    expect(saveItemOnTopForm().item).toBeDefined();
  });

  it('saves a manual charge opened from the series and returns to the same series', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    const seriesKey = keyOf('RecurringSeries');

    await view.findByLabelText('Amount');
    await pressSaveOnTopForm();

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: MANUAL_CHARGE, amountMinorUnits: -29900 }),
      undefined,
    );
    expect(routeNames()).toEqual(ROUTES_TO_SERIES);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
  });
});

describe('Settings stack: a hide write that lands after the user moved on', () => {
  const HIDE_BUTTON = 'recurring-series-hide';
  const ROUTES_TO_LIST = ['Settings', 'RecurringCharges'];

  // The write the button starts, held open until the test settles it.
  let settleWrite: () => void;

  let hideSpy: jest.SpyInstance;

  beforeEach(() => {
    hideSpy = jest.spyOn(settingsRepo, 'hideRecurringMerchant').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settleWrite = resolve;
        }),
    );
  });

  afterEach(() => {
    hideSpy.mockRestore();
  });

  const settle = async (): Promise<void> => {
    await act(async () => {
      settleWrite();
    });
  };

  it('keeps the form on top of the series when a charge was opened while the write was queued', async () => {
    const view = await renderSettings();

    await openSeries(view);

    const seriesKey = keyOf('RecurringSeries');

    await fireEvent.press(view.getByTestId(HIDE_BUTTON));
    await openCharge(view, MANUAL_CHARGE);

    expect(hideSpy).toHaveBeenCalledTimes(1);

    await settle();

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('TransactionForm')).toEqual({ transactionId: MANUAL_CHARGE });
  });

  it('leaves the list on top when the user went back while the write was queued', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await fireEvent.press(view.getByTestId(HIDE_BUTTON));
    await goBack();

    expect(routeNames()).toEqual(ROUTES_TO_LIST);

    await settle();

    expect(routeNames()).toEqual(ROUTES_TO_LIST);
  });

  it('returns to the list once the write lands and the series is still the focused screen', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await fireEvent.press(view.getByTestId(HIDE_BUTTON));

    expect(routeNames()).toEqual(ROUTES_TO_SERIES);

    await settle();

    expect(routeNames()).toEqual(ROUTES_TO_LIST);
  });
});

describe('Settings stack: a link to a row that was deleted after the series was read', () => {
  const LEDGER_AS_SEEDED = [...mockLedger];

  afterEach(() => {
    mockLedger.splice(0, mockLedger.length, ...LEDGER_AS_SEEDED);
  });

  it('opens the form on no stored values and writes nothing on Save', async () => {
    const view = await renderSettings();

    await openSeries(view);

    const link = await view.findByTestId(`recurring-series-charge-${MANUAL_CHARGE}`);

    // The series still shows the link, as in the gap before its paused re-read lands.
    mockLedger.splice(
      mockLedger.findIndex(({ id }) => id === MANUAL_CHARGE),
      1,
    );
    await fireEvent.press(link);

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(paramsOf('TransactionForm')).toEqual({ transactionId: MANUAL_CHARGE });
    expect(await view.findByLabelText('Amount')).toBeTruthy();
    expect(view.queryByText(syncedNotice())).toBeNull();
    expect(view.getByLabelText('Amount').props.value).toBe('');
    expect(view.getByLabelText('Description').props.value).toBe('');
    expect(view.queryByDisplayValue('Netflix')).toBeNull();

    await pressSaveOnTopForm();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(routeNames()).toEqual(ROUTES_TO_FORM);
  });

  it('writes nothing on Save either once the amount is filled', async () => {
    const view = await renderSettings();

    await openSeries(view);

    const link = await view.findByTestId(`recurring-series-charge-${MANUAL_CHARGE}`);

    mockLedger.splice(
      mockLedger.findIndex(({ id }) => id === MANUAL_CHARGE),
      1,
    );
    await fireEvent.press(link);
    await fireEvent.changeText(await view.findByLabelText('Amount'), '150');

    expect(view.getByLabelText('Amount').props.value).toBe('150');

    await pressSaveOnTopForm();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(routeNames()).toEqual(ROUTES_TO_FORM);
  });

  it('fills the same form from the row while the row is still stored', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    expect(await view.findByDisplayValue('Netflix')).toBeTruthy();
    expect(view.getByLabelText('Amount').props.value).toBe('299');
  });
});

describe('Settings stack, two panes: a recurring series and its charges', () => {
  beforeEach(async () => {
    resetLayoutMode();
    await emitLayoutMode('columns');
  });

  it('keeps list, series and form in the detail pane and Settings in the list pane', async () => {
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(paneOf('Settings')).toBe('companion');
    expect(paneOf('RecurringCharges')).toBe('primary');
    expect(paneOf('RecurringSeries')).toBe('primary');
    expect(paneOf('TransactionForm')).toBe('primary');
  });

  it('keeps the menu row marked from the list to the form, and unmarked before the list opens', async () => {
    const view = await renderSettings();
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
    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);
    await view.findByLabelText('Amount');
    await pressSaveOnTopForm();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(ROUTES_TO_SERIES);
    expect(paneOf('RecurringSeries')).toBe('primary');
  });
});

describe('Settings stack: folding with a series open', () => {
  it('keeps the routes and params of the series and the form across a fold and an unfold', async () => {
    resetLayoutMode();
    await emitLayoutMode('columns');

    const view = await renderSettings();

    await openSeries(view);
    await openCharge(view, MANUAL_CHARGE);

    const seriesKey = keyOf('RecurringSeries');

    await emitLayoutMode('single');

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
    expect(paramsOf('TransactionForm')).toMatchObject({ transactionId: MANUAL_CHARGE });

    await emitLayoutMode('columns');

    expect(routeNames()).toEqual(ROUTES_TO_FORM);
    expect(keyOf('RecurringSeries')).toBe(seriesKey);
    expect(paramsOf('RecurringSeries')).toEqual(SERIES_PARAMS);
    expect(paneOf('RecurringSeries')).toBe('primary');
  });
});
