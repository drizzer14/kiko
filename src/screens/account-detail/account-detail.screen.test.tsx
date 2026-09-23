import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '../../design-system/unistyles';

import { formatDateTime } from '../../dates/format';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '../../design-system/components/card-context-menu';
import { darkTheme } from '../../design-system/theme';
import { i18n } from '../../i18n';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import AccountDetailScreen from './account-detail.screen';

// A grid card's delete menu is a react-native-gesture-handler long-press, so
// the screen must mount under a GestureHandlerRootView (the app supplies one at
// its root in production).
const gestureRootWrapper = ({ children }: { children: ReactNode }) => (
  <GestureHandlerRootView>{children}</GestureHandlerRootView>
);

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// Mock Text here — following the money-text/home test precedent — so the
// resolved `tone` MoneyText emits is observable via a testID, while the amount
// still renders as plain text so every getByText assertion is unaffected.
jest.mock('../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

// The Button variant maps to a themed fill inside a react-native-unistyles
// `variants` block that the project's Jest mock strips from the resolved style,
// and onAccent/textPrimary are both white so the label color cannot tell primary
// from secondaryTonal apart either. Mock Button to record the `variant` it
// receives — following the contribution-buttons precedent — while still
// rendering the label (and forwarding onPress/disabled) so every
// getByText/press assertion in this file is unaffected.
const mockButtonProps: {
  variant?: string;
  children: ReactNode;
  icon?: string;
  fullWidth?: boolean;
}[] = [];

jest.mock('../../design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: (props: {
      variant?: string;
      children?: ReactNode;
      onPress: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      testID?: string;
      icon?: string;
      fullWidth?: boolean;
    }) => {
      mockButtonProps.push({
        variant: props.variant,
        children: props.children,
        icon: props.icon,
        fullWidth: props.fullWidth,
      });

      return (
        <Pressable
          accessibilityLabel={props.accessibilityLabel}
          testID={props.testID}
          onPress={props.onPress}
          disabled={props.disabled}
        >
          {props.children !== undefined && <RNText>{props.children}</RNText>}
        </Pressable>
      );
    },
  };
});

const mockUseLiveQuery = jest.fn();
const mockSync = jest.fn();
const mockUseSync = jest.fn();
const mockSaveToken = jest.fn();
const mockFetchClientInfo = jest.fn();
const mockPick = jest.fn();
const mockReadFile = jest.fn();
const mockRemove = jest.fn();
const mockReorder = jest.fn();
const mockAccountSetIcon = jest.fn();
const mockAccountUpdate = jest.fn();
const mockDisconnect = jest.fn();

// HoldingCard (rendered inside this screen) subscribes to the native stack's
// `transitionEnd` event via `useNavigation` to defer its Liquid Glass one-shot
// until the push slide-in settles. These tests mount the screen with a spy
// navigation *prop* and no NavigationContainer, so the real `useNavigation`
// hook has no context and throws. Stub only `useNavigation` (keep the rest of
// the module real) with a navigation whose `addListener` is an inert
// noop-unsubscribe — the card simply never settles under test, which is fine.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    addListener: () => () => {},
    navigate: jest.fn(),
    setOptions: jest.fn(),
    goBack: jest.fn(),
  }),
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
// `BankSyncSection` (real, unmocked here) calls `useSync` once per render for
// its sole shipped provider (Guideline 5.6 remediation: Monobank-only).
jest.mock('@kiko/sync/use-sync', () => ({
  useSync: () => mockUseSync(),
}));
jest.mock('../../monobank/disconnect', () => ({
  disconnectMonobank: (...args: unknown[]) => mockDisconnect(...args),
}));
jest.mock('../../monobank/token', () => ({
  saveToken: (...args: unknown[]) => mockSaveToken(...args),
}));
jest.mock('../../monobank/client', () => ({
  fetchClientInfo: (...args: unknown[]) => mockFetchClientInfo(...args),
}));
jest.mock('@react-native-documents/picker', () => ({
  pick: (...args: unknown[]) => mockPick(...args),
  types: { csv: 'text/csv', xlsx: 'application/xlsx', plainText: 'text/plain', allFiles: '*/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: (error: unknown): error is { code: string } =>
    typeof error === 'object' && error !== null && 'code' in error,
}));
jest.mock('react-native-fs', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: (accountId: string) => ({
      __kind: 'byId',
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    setIcon: (...args: unknown[]) => mockAccountSetIcon(...args),
    update: (...args: unknown[]) => mockAccountUpdate(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    listByAccountQuery: (accountId: string) => ({
      toSQL: () => ({ sql: '', params: [accountId] }),
    }),
    remove: (...args: unknown[]) => mockRemove(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
  },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: () => ({ __kind: 'sync_state', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));

// The crypto section is tested on its own; here it collapses to a marker view
// so the screen's kind-gating is what is under test.
jest.mock('./crypto-sync-section', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ account }: { account: { id: string } }) => (
      <View testID="crypto-sync-section" accessibilityLabel={`crypto-sync ${account.id}`} />
    ),
  };
});

type Account = {
  id: string;
  name: string;
  kind: string;
  institution?: string | null;
  bankId?: string | null;
  icon?: string | null;
  color?: string | null;
};
type Holding = {
  id: string;
  name: string;
  currency: string;
  balanceMinorUnits: number;
  closedAt?: number | null;
  sortOrder?: number;
  type?: string;
  metadata?: Record<string, unknown> | null;
};
type Rate = { base: string; quote: string; rate: string };
type Settings = { baseCurrency: string };
type SyncState = { lastSyncAt?: number | null; lastSyncDisplayAt?: number | null };

/**
 * Drive the `useLiveQuery` calls, keying on the query's `__kind` (the
 * account-by-id query subscribes to `['accounts']`, so the table name alone
 * can't tell it apart from a future account query) and otherwise on the
 * subscribed table. `settings` defaults to a UAH base. The Monobank "last sync"
 * line now reads the PER-CONNECTION `sync_state` cursor, seeded via `syncState`.
 */
const setLiveData = (data: {
  accounts?: Account[];
  holdings?: Holding[];
  rates?: Rate[];
  settings?: Settings[];
  syncState?: SyncState[];
}): void => {
  const accounts = data.accounts ?? [];
  mockUseLiveQuery.mockImplementation((_query: { __kind?: string }, tables: string[]) => {
    if (tables[0] === 'holdings') {
      // A real holding row always carries a `type`; default it here so a fixture
      // that only cares about name/currency/balance still yields a valid type
      // for the card's color/icon derivation (an undefined type has no default
      // color and would throw in the tint helper).
      return { data: (data.holdings ?? []).map((holding) => ({ type: 'card', ...holding })) };
    }
    if (tables[0] === 'currency_rates') {
      return { data: data.rates ?? [] };
    }
    if (tables[0] === 'settings') {
      return { data: data.settings ?? [{ baseCurrency: 'UAH' }] };
    }
    if (tables[0] === 'sync_state') {
      return { data: data.syncState ?? [] };
    }
    return { data: accounts };
  });
};

const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'Monobank',
  kind: 'bank',
  institution: null,
  ...overrides,
});

type AccountDetailProps = ComponentProps<typeof AccountDetailScreen>;

const route = asRouteProp<AccountDetailProps['route']>('AccountDetail', { accountId: 'a' });

// A UAH + USD holding pair with a USD->UAH rate: the overall converts to
// 1,000.00 ₴ + $50.00 * 40 = 3,000.00 ₴. Shared by the two balance tests.
const multiCurrencyData = {
  accounts: [account()],
  holdings: [
    { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
    { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
  ],
  rates: [{ base: 'USD', quote: 'UAH', rate: '40' }],
  settings: [{ baseCurrency: 'UAH' }],
};

/**
 * Render the screen with a fresh spy navigation, returned alongside the RNTL
 * queries so a test can assert on `navigation.navigate` without re-wiring the
 * boilerplate. Live data is seeded per-test (or by `beforeEach`) before this.
 */
const renderScreen = async () => {
  const navigation = navigationSpy();
  const view = await render(
    <AccountDetailScreen
      route={route}
      navigation={asNavigationProp<AccountDetailProps['navigation']>(navigation)}
    />,
    { wrapper: gestureRootWrapper },
  );
  return { ...view, navigation };
};

/**
 * Drives the disconnected picker flow up to (not including) the Connect
 * press: opens `AddBankProviderSheet` via the "Add a bank" trigger, then
 * selects the Monobank row — the sheet reports the choice and closes itself,
 * leaving `MonobankConnectField` mounted for the caller to drive further.
 */
const openMonobankConnectField = async (
  view: Pick<Awaited<ReturnType<typeof render>>, 'getByText' | 'getByTestId'>,
): Promise<void> => {
  await fireEvent.press(view.getByText(i18n.t('accountDetail.addBankAction')));
  await fireEvent.press(view.getByTestId('add-bank-option-monobank'));
};

describe('AccountDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    mockSaveToken.mockResolvedValue(undefined);
    mockFetchClientInfo.mockResolvedValue({ name: 'Jane Doe' });
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
  });

  it('spaces the connected Monobank last-sync line above the actions row evenly', async () => {
    // The last-sync line sits above the single actions row (Sync + Disconnect
    // side by side). The gap inside the status/actions group (last sync ↔ actions
    // row) must equal the content container's gap for one even vertical rhythm.
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    const { getByTestId } = await renderScreen();

    const contentGap = StyleSheet.flatten(getByTestId('account-detail-content').props.style).gap;
    const groupGap = StyleSheet.flatten(getByTestId('bank-sync-status-actions').props.style).gap;

    expect(groupGap).toBe(contentGap);
  });

  it('puts Sync and Disconnect side by side in a single row when connected', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    const { getByTestId } = await renderScreen();

    // The two buttons now share one horizontal row rather than stacking.
    const row = getByTestId('bank-sync-actions-row');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
  });

  it('makes the connected Sync button blue (primary) and keeps Disconnect neutral', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    mockButtonProps.length = 0;
    await renderScreen();

    // Once connected, Sync is the affirmative re-import CTA in the solid blue
    // `primary` fill; Disconnect stays the neutral `secondaryTonal` tint beside
    // it (never blue).
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.variant).toBe('primary');
    expect(disconnectEntry?.variant).toBe('secondaryTonal');
  });

  it('uses the Kiko UI sync glyph for the connected Sync button and the open-lock glyph for Disconnect', async () => {
    setLiveData({ accounts: [account({ institution: 'monobank' })] });

    mockButtonProps.length = 0;
    await renderScreen();

    // Sync-now takes the iOS-26 rotate glyph (central availability map supplies
    // the iOS-16-safe fallback for free); Disconnect takes the open-lock glyph.
    const syncEntry = mockButtonProps.find((entry) => entry.children === 'Sync');
    const disconnectEntry = mockButtonProps.find((entry) => entry.children === 'Disconnect');
    expect(syncEntry?.icon).toBe('arrow.trianglehead.2.clockwise.rotate.90');
    expect(disconnectEntry?.icon).toBe('lock.open');
  });

  it('lists holdings for the account', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
  });

  it('sets the header title to the account name', async () => {
    const { navigation } = await renderScreen();
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Monobank' }),
    );
  });

  it('shows the holding balance as money', async () => {
    const { getAllByText } = await renderScreen();
    // The amount now appears in the per-holding row, the overall balance, and
    // the single-currency breakdown line — at least one is enough here.
    expect(getAllByText(/1,000\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('shows the overall converted balance and a per-currency breakdown', async () => {
    setLiveData(multiCurrencyData);
    const { getByText } = await renderScreen();
    // Overall = 1,000.00 ₴ + $50.00 * 40 = 3,000.00 ₴ (unique to the headline).
    expect(getByText(/3,000\.00 ₴/)).toBeTruthy();
    // A breakdown line per held currency (labels appear only in the breakdown).
    expect(getByText('UAH')).toBeTruthy();
    expect(getByText('USD')).toBeTruthy();
  });

  it('renders a positive overall balance in the balance tone (white / textPrimary)', async () => {
    setLiveData(multiCurrencyData);
    const { getByText } = await renderScreen();
    // The converted overall amount is unique to the headline MoneyText.
    expect(getByText(/3,000\.00 ₴/).props.testID).toBe('text-tone-textPrimary');
  });

  it('navigates to HoldingDetail when a holding row is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    // The holding row is display-only now (rename/icon editing moved to
    // HoldingDetail), so pressing anywhere on it — the name included — opens the
    // detail page.
    await fireEvent.press(getByText('Black card'));
    // The holding's name rides along so the detail screen's large title (and any
    // back button pushed from it) reads immediately, before its own live query.
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingDetail', {
      holdingId: 'h1',
      name: 'Black card',
    });
  });

  it('lays the account holdings out as a drag-and-drop vertical list of wide row cards', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId, getAllByTestId } = await renderScreen();

    // The holdings render inside the sortable grid, one wrapper item per holding,
    // each a full-width row card (icon + name left, value right) — mirroring the
    // accounts list. The grid is a single column, so the cards carry no square
    // aspectRatio; a dragged card is pinned to its vertical axis.
    const grid = getByTestId('sortable-grid');
    expect(grid.props.overDrag).toBe('vertical');
    const items = getAllByTestId('holding-grid-item');
    expect(items).toHaveLength(2);
    expect(
      StyleSheet.flatten(getAllByTestId('holding-card')[0].props.style).aspectRatio,
    ).toBeUndefined();
  });

  it('renders holdings in the query sort_order, with no zero-value auto-sink', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        // `listByAccountQuery` already returns rows ordered by sort_order, and
        // manual drag order is the sole ordering key: a zero-value holding the
        // user dragged to the front (sort_order 0) stays at the front rather
        // than sinking below a still-valuable holding.
        { id: 'z', name: 'Empty jar', currency: 'UAH', balanceMinorUnits: 0, sortOrder: 0 },
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000, sortOrder: 1 },
      ],
    });
    const { getAllByTestId } = await renderScreen();

    const cards = getAllByTestId('holding-card');
    expect(within(cards[0]).getByText('Empty jar')).toBeTruthy();
    expect(within(cards[1]).getByText('Black card')).toBeTruthy();
  });

  it('shows the holding icon as a display-only glyph, not an editable icon control', async () => {
    const { getByLabelText, queryByLabelText } = await renderScreen();
    // The holding row renders a plain, non-editable icon (icon editing moved to
    // HoldingDetail), so its glyph is present but no "Change … icon" affordance.
    expect(getByLabelText('Black card icon')).toBeTruthy();
    expect(queryByLabelText('Change Black card icon')).toBeNull();
  });

  it('tints the account identity icon beside the Balance amount with its stored color', async () => {
    setLiveData({
      accounts: [account({ color: darkTheme.colors.entityColors.violet })],
      holdings: [],
    });
    const { getByLabelText } = await renderScreen();

    // The account icon now sits beside the Balance amount (the nav title shows the
    // NAME only), tinted its stored violet — a bank shows the columns-fill glyph.
    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.violet,
    );
  });

  it('tints the account identity icon beside the Balance amount with the kind default color when none is stored', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByLabelText } = await renderScreen();

    // A `bank` account with no color reads the bank kind default (white).
    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('resolves the identity icon color the same way the card does — an empty-string stored color falls back to the kind default', async () => {
    // A stored color of '' (neither null nor undefined) slips past a bare
    // `color ?? default`, leaving the header tinted with an invalid empty color
    // while the card (via resolveEntityColor) shows the kind default. The header
    // must resolve through the same helper so the identity color never diverges.
    setLiveData({ accounts: [account({ color: '' })], holdings: [] });
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Icon building.columns.fill').props.tintColor).toBe(
      darkTheme.colors.entityColors.white,
    );
  });

  it('excludes closed holdings from the list', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          closedAt: null,
        },
        {
          id: 'h2',
          name: 'Closed jar',
          currency: 'UAH',
          balanceMinorUnits: 5000,
          closedAt: 1_700_000_000_000,
        },
      ],
    });
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('Black card')).toBeTruthy();
    expect(queryByText('Closed jar')).toBeNull();
  });

  it('navigates to HoldingForm when Add holding is pressed', async () => {
    const { getByText, navigation } = await renderScreen();
    await fireEvent.press(getByText('Add holding'));
    expect(navigation.navigate).toHaveBeenCalledWith('HoldingForm', { accountId: 'a' });
  });

  it('pins the Add holding action to the screen footer', async () => {
    const { getByTestId } = await renderScreen();
    // The action lives in the Screen footer slot so it stays pinned to the
    // bottom on a short page rather than floating beneath the holdings list.
    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Add holding')).toBeTruthy();
  });

  it("drives the nav title from the account's real name, with no custom header title component", async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card' })],
      holdings: [],
    });
    const { navigation } = await renderScreen();
    // The name is the plain string `title` — the native large title — with NO
    // `headerTitle` render function and NO `headerLargeTitle` toggle (the icon
    // moved to the body), so the back button on any pushed screen reads it
    // immediately and the large title never flashes collapsing on load.
    expect(navigation.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Ukrsibbank Card' }),
    );
    for (const [options] of (navigation.setOptions as jest.Mock).mock.calls) {
      expect(options.headerTitle).toBeUndefined();
      expect(options.headerLargeTitle).toBeUndefined();
    }
  });

  it('renders in scroll mode so the native large title renders and collapses', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { getByTestId } = await renderScreen();
    expect(getByTestId('screen-scroll-view')).toBeTruthy();
  });

  type MonobankGateCase = {
    description: string;
    account: Account | undefined;
    visible: string[];
    hidden: string[];
  };

  const monobankGateCases: MonobankGateCase[] = [
    {
      description: 'the account has not loaded yet',
      account: undefined,
      visible: [],
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      description: 'a bank account not yet connected to Monobank',
      account: account({ kind: 'bank', institution: null }),
      // Disconnected now shows the "Add a bank" picker trigger, not the
      // Monobank field directly — see the picker-flow tests below.
      visible: ['Add a bank'],
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      description: 'a bank account connected to Monobank',
      account: account({ kind: 'bank', institution: 'monobank' }),
      visible: ['Sync'],
      hidden: ['Connect Monobank'],
    },
    {
      description: 'a cash account',
      account: account({ kind: 'cash', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync'],
    },
    {
      // device-feedback-round-4 item 4: an import-only bank (bankCatalog's
      // `connectable: false`) must show NO sync/connect affordance at all —
      // not even the disconnected "Add a bank" trigger.
      description: 'a bank account whose picked bank is import-only (e.g. PrivatBank)',
      account: account({ kind: 'bank', bankId: 'privatbank', institution: null }),
      visible: [],
      hidden: ['Connect Monobank', 'Sync', 'Add a bank'],
    },
    {
      // A bank account whose picked bank IS connectable (Monobank) keeps the
      // disconnected "Add a bank" trigger — only a KNOWN import-only bank
      // hides the section.
      description: 'a bank account whose picked bank is connectable (Monobank), not yet connected',
      account: account({ kind: 'bank', bankId: 'monobank', institution: null }),
      visible: ['Add a bank'],
      hidden: ['Connect Monobank', 'Sync'],
    },
  ];

  it.each(monobankGateCases)(
    'gates the Monobank controls when $description',
    async ({ account: testAccount, visible, hidden }) => {
      setLiveData({ accounts: testAccount ? [testAccount] : [], holdings: [] });
      const { getByText, queryByText } = await renderScreen();
      for (const text of visible) {
        expect(getByText(text)).toBeTruthy();
      }
      for (const text of hidden) {
        expect(queryByText(text)).toBeNull();
      }
    },
  );

  it('hides the whole Synchronization section (heading included) for an import-only bank account', async () => {
    // device-feedback-round-4 item 4: a non-syncable (import-only) bank
    // account must show NO trace of the sync section — not merely the
    // buttons the table above checks, but the "Synchronization" heading
    // itself, which `BankSyncSection` renders at its own top.
    setLiveData({
      accounts: [account({ kind: 'bank', bankId: 'privatbank', institution: null })],
      holdings: [],
    });
    const { queryByText } = await renderScreen();

    expect(queryByText(i18n.t('accountDetail.synchronization'))).toBeNull();
  });

  it('lets a bank account connect independently, with no single-connection gate or hint', async () => {
    // The single-connection gate is gone: a bank account shows Connect on its
    // own — the screen no longer queries whether another account already holds a
    // Monobank connection — and no "connected elsewhere" hint is ever rendered.
    setLiveData({
      accounts: [account({ id: 'a', kind: 'bank', institution: null })],
      holdings: [],
    });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    expect(view.getByText('Connect Monobank')).toBeTruthy();
    expect(view.queryByText('Monobank is connected to another account')).toBeNull();
  });

  it('re-syncs a connected account when Sync is pressed', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Sync'));
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('connects a bank account by validating the token, saving it, then syncing it (Connect folds save into connect)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const input = view.getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'entered-here');
    await act(async () => {
      await fireEvent.press(view.getByText('Connect Monobank'));
    });

    // Validate BEFORE save: fetchClientInfo runs first, and only a successful
    // validation reaches saveToken — no orphaned Keychain item on an invalid
    // token (see the invalid-token test below).
    expect(mockFetchClientInfo).toHaveBeenCalledWith('entered-here');
    // The token binds to THIS account's id (per-account Keychain item), not a
    // shared global slot.
    expect(mockSaveToken).toHaveBeenCalledWith('a', 'entered-here');
    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('a'));
  });

  it('never saves an invalid token: validation failure keeps the field usable and skips saveToken/sync entirely', async () => {
    mockFetchClientInfo.mockRejectedValue(new Error('401'));
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const input = view.getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'bad-token');
    await act(async () => {
      await fireEvent.press(view.getByText('Connect Monobank'));
    });

    expect(await view.findByText('Invalid token')).toBeTruthy();
    expect(mockSaveToken).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
    // The entered text is kept so the user can retry immediately, without
    // re-entering the token.
    expect(view.getByPlaceholderText('Monobank token').props.value).toBe('bad-token');
  });

  it('keeps a valid-but-unsynced token retryable: a failed connect keeps the field usable for an immediate retry', async () => {
    mockSync.mockResolvedValueOnce(false);
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
    const view = await renderScreen();
    await openMonobankConnectField(view);
    const { getByPlaceholderText, getByText, findByText } = view;
    const input = getByPlaceholderText('Monobank token');
    await fireEvent.changeText(input, 'entered-here');
    await act(async () => {
      await fireEvent.press(getByText('Connect Monobank'));
    });

    expect(await findByText('Could not connect Monobank')).toBeTruthy();
    // The token is kept in the field (not cleared) so a retry does not require
    // re-entering it.
    expect(getByPlaceholderText('Monobank token').props.value).toBe('entered-here');

    // Retrying without re-entering the token succeeds: Connect stayed pressable
    // and re-runs the same validated token through save + sync.
    mockSync.mockResolvedValueOnce(true);
    await act(async () => {
      await fireEvent.press(getByText('Connect Monobank'));
    });
    expect(mockSaveToken).toHaveBeenCalledTimes(2);
    expect(mockSaveToken).toHaveBeenLastCalledWith('a', 'entered-here');
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(2));
  });

  it('shows the last sync time on a connected bank account, formatted as DD.MM.YYYY HH:mm', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
      syncState: [{ lastSyncAt: 1_700_000_000_000 }],
    });
    const { getByText } = await renderScreen();
    // The shared formatDateTime helper (European DD.MM.YYYY, 24h) replaces the
    // old locale-dependent toLocaleString rendering.
    const stamp = formatDateTime(1_700_000_000_000);
    expect(getByText(new RegExp(stamp.replace(/[.]/g, '\\.')))).toBeTruthy();
  });

  it('does not render the token input for a cash account', async () => {
    setLiveData({ accounts: [account({ kind: 'cash', institution: null })], holdings: [] });
    const { queryByPlaceholderText } = await renderScreen();
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
  });

  it('renders the crypto sync section for a crypto account, with that account', async () => {
    setLiveData({ accounts: [account({ kind: 'crypto', name: 'Cold storage' })], holdings: [] });
    const { getByTestId, getByLabelText, queryByPlaceholderText } = await renderScreen();

    expect(getByTestId('crypto-sync-section')).toBeTruthy();
    expect(getByLabelText('crypto-sync a')).toBeTruthy();
    // no Monobank controls on a crypto account
    expect(queryByPlaceholderText('Monobank token')).toBeNull();
  });

  it.each([
    ['a bank account', account({ kind: 'bank' })],
    ['a cash account', account({ kind: 'cash' })],
  ])('does not render the crypto sync section for %s', async (_label, testAccount) => {
    setLiveData({ accounts: [testAccount], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });

  it('does not render the crypto sync section before the account has loaded', async () => {
    setLiveData({ accounts: [], holdings: [] });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('crypto-sync-section')).toBeNull();
  });

  it('surfaces the sync error from useSync', async () => {
    mockUseSync.mockReturnValue({ isSyncing: false, error: 'sync boom', sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('sync boom')).toBeTruthy();
  });

  it('shows a syncing label while a connected account is syncing', async () => {
    mockUseSync.mockReturnValue({ isSyncing: true, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: 'monobank' })], holdings: [] });
    const { getByText } = await renderScreen();
    expect(getByText('Syncing…')).toBeTruthy();
  });

  it('deletes a manual holding via the themed deep-press delete confirm', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { getByTestId, getByText } = await renderScreen();
    // The manual holding card is wrapped in the deep-press long-press. A hold
    // that stays still opens the themed ConfirmSheet (not a native
    // ActionSheetIOS); pressing its destructive confirm removes the holding.
    await act(async () => {
      fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    expect(getByText('Delete "Black card"')).toBeTruthy();
    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));
    expect(mockRemove).toHaveBeenCalledWith('h1');
  });

  it('wires an auto-scroll ref and an edge activation offset to the holdings grid (F9)', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId } = await renderScreen();
    const grid = getByTestId('sortable-grid');
    // The grid receives the parent scroll view's animated ref plus a positive
    // edge offset, so a drag near the top/bottom edge auto-scrolls the list.
    expect(grid.props.scrollableRef).toBeDefined();
    expect(grid.props.autoScrollActivationOffset).toBeGreaterThan(0);
  });

  it('persists a reorder to holdingsRepo.reorder when a holding is dragged to a new slot', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [
        { id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 },
        { id: 'h2', name: 'Dollar jar', currency: 'USD', balanceMinorUnits: 5000 },
      ],
    });
    const { getByTestId } = await renderScreen();
    // A drag that moved (fromIndex !== toIndex) persists the new front-to-back
    // order (indexToKey) rather than opening the menu.
    await act(async () => {
      getByTestId('sortable-grid').props.onDragEnd({
        key: 'h2',
        fromIndex: 1,
        toIndex: 0,
        indexToKey: ['h2', 'h1'],
      });
    });
    expect(mockReorder).toHaveBeenCalledWith(['h2', 'h1']);
  });

  it('wires a manual holding card to the shared long-press menu, not a swipe-to-delete row', async () => {
    setLiveData({
      accounts: [account()],
      holdings: [{ id: 'h1', name: 'Black card', currency: 'UAH', balanceMinorUnits: 100000 }],
    });
    const { queryByTestId } = await renderScreen();
    // The delete affordance is the shared CardContextMenu long-press — the card
    // is wrapped in its `card-context-menu` layer and registers the hold
    // gesture — rather than a swipe-to-delete row. `getByGestureTestId` throws
    // when the hold gesture is absent, so reaching it asserts the affordance.
    expect(queryByTestId('card-context-menu')).not.toBeNull();
    expect(getByGestureTestId(HOLD_GESTURE_TEST_ID)).toBeTruthy();
  });

  it('renders no context menu on a synced holding (monobankId)', async () => {
    setLiveData({
      accounts: [account({ institution: 'monobank' })],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          metadata: { monobankId: 'mono-1' },
        },
      ],
    });
    const { queryByTestId } = await renderScreen();
    // A synced holding is owned by the sync, so its card renders bare with no
    // native context menu to offer a delete.
    expect(queryByTestId('card-context-menu')).toBeNull();
  });

  it('renders the context menu on a holding whose account was disconnected', async () => {
    setLiveData({
      // A disconnect clears the institution but KEEPS the holding's monobankId,
      // so a later reconnect re-adopts the row. Nothing syncs the balance
      // anymore, so the card is deletable again and offers its menu.
      accounts: [account({ institution: null })],
      holdings: [
        {
          id: 'h1',
          name: 'Black card',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          metadata: { monobankId: 'mono-1' },
        },
      ],
    });
    const { queryByTestId } = await renderScreen();

    expect(queryByTestId('card-context-menu')).not.toBeNull();
  });

  it('renders a view-only header with no inline name, icon, or color editors', async () => {
    setLiveData({
      accounts: [account({ name: 'Ukrsibbank Card', icon: 'banknote' })],
      holdings: [],
    });
    const { queryByLabelText } = await renderScreen();
    // Identity editing moved to the dedicated edit form: the header no longer
    // offers the icon-picker toggle, the editable name field, or the color
    // swatch row it used to.
    expect(queryByLabelText('Change Icon')).toBeNull();
    expect(queryByLabelText('Ukrsibbank Card name')).toBeNull();
    expect(queryByLabelText('Color violet')).toBeNull();
  });

  it('offers an Edit action in the header that opens the account edit form', async () => {
    setLiveData({ accounts: [account()], holdings: [] });
    const { navigation } = await renderScreen();
    // The Edit affordance sits at the header top-right (via setOptions
    // headerRight). Render it and press it: it opens this account's edit form.
    const call = (navigation.setOptions as jest.Mock).mock.calls.find(
      ([options]) => options.headerRight,
    );
    expect(call).toBeDefined();
    const { getByText } = await render(call[0].headerRight());
    await fireEvent.press(getByText('Edit'));
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', { accountId: 'a' });
  });

  it('offers a Disconnect action on a connected account and confirms via the themed sheet before disconnecting', async () => {
    mockDisconnect.mockResolvedValue(undefined);
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByText, getByTestId } = await renderScreen();
    await fireEvent.press(getByText('Disconnect'));
    // The themed ConfirmSheet (not a native Alert.alert) opens before the
    // connection + token are cleared.
    expect(getByText('Disconnect Monobank')).toBeTruthy();
    expect(mockDisconnect).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('bank-disconnect-confirm'));
    await waitFor(() => expect(mockDisconnect).toHaveBeenCalledWith('a'));
  });

  it('disconnects nothing when the themed Disconnect confirm is dismissed via Cancel', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: 'monobank' })],
      holdings: [],
    });
    const { getByText } = await renderScreen();
    await fireEvent.press(getByText('Disconnect'));
    await fireEvent.press(getByText('Cancel'));
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it('does not offer Disconnect on an account that is not connected', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: null })],
      holdings: [],
    });
    const { queryByText } = await renderScreen();
    expect(queryByText('Disconnect')).toBeNull();
  });

  // Guideline 5.6 remediation: PrivatBank, bunq, and Starling bank-CONNECT
  // were removed entirely — Monobank is the sole shipped native provider, so
  // the picker sheet lists exactly one row and no cross-provider routing
  // remains to exercise (that coverage now lives in
  // `bank-sync-section.component.test.tsx` and `add-bank-sheet.component.test.tsx`).
  it('opens the add-a-bank picker sheet for a disconnected bank account, listing the shipped native provider', async () => {
    setLiveData({
      accounts: [account({ kind: 'bank', institution: null })],
      holdings: [],
    });
    const view = await renderScreen();

    // No provider's field is mounted before a choice is made.
    expect(view.queryByText('Connect Monobank')).toBeNull();

    await fireEvent.press(view.getByText('Add a bank'));

    expect(view.getByTestId('add-bank-sheet')).toBeTruthy();
    expect(view.getByText('Monobank')).toBeTruthy();
  });

  it('reflects term-deposit growth in net worth (now is passed)', async () => {
    // A recapitalizing 10%/yr deposit funded well in the past has matured: its
    // value grows to 1,100.00 ₴ gross, less 23% tax on 100.00 ₴ interest, for a
    // 1,077.00 ₴ net worth — distinct from the 1,000.00 ₴ cached balance. Without
    // the `now` argument the growth math yields NaN and this value never renders.
    const START = Date.UTC(2020, 0, 1);
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Term deposit',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          type: 'term_deposit',
          metadata: {
            contributions: [{ amountMinorUnits: 100000, date: START }],
            annualRatePct: 10,
            termMonths: 12,
            recapitalization: true,
            compounding: 'annually',
          },
        },
      ],
    });
    // The grown value now appears in both the headline and the (single UAH)
    // breakdown line, so more than one match is expected.
    const { getAllByText } = await renderScreen();
    expect(getAllByText(/1,077\.00 ₴/).length).toBeGreaterThan(0);
  });

  it('reflects the grown deposit value in the per-currency breakdown (not the raw balance)', async () => {
    // Same matured recapitalizing deposit: gross 1,100.00 ₴, net-of-tax 1,077.00 ₴.
    // The breakdown values the holding via holdingValue, so the grown 1,077.00 ₴
    // appears both in the headline and in the single UAH breakdown line — while
    // the raw 1,000.00 ₴ cached balance shows only in the holding row. Passing
    // `now` to sumByCurrency is what makes the breakdown line agree.
    const START = Date.UTC(2020, 0, 1);
    setLiveData({
      accounts: [account()],
      holdings: [
        {
          id: 'h1',
          name: 'Term deposit',
          currency: 'UAH',
          balanceMinorUnits: 100000,
          type: 'term_deposit',
          metadata: {
            contributions: [{ amountMinorUnits: 100000, date: START }],
            annualRatePct: 10,
            termMonths: 12,
            recapitalization: true,
            compounding: 'annually',
          },
        },
      ],
    });
    const { getAllByText } = await renderScreen();
    // Two occurrences: the balance headline and the UAH breakdown line. Without
    // the grown valuation the breakdown would instead show 1,000.00 ₴, leaving
    // only the single headline match.
    expect(getAllByText(/1,077\.00 ₴/).length).toBeGreaterThanOrEqual(2);
  });
});

describe('AccountDetailScreen — statement import (footer button + pickAndOpenStatement)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ bankId: 'monobank' })], holdings: [] });
  });

  it('renders an Import statement action beside Add holding in the footer', async () => {
    const { getByTestId } = await renderScreen();

    const footer = getByTestId('screen-footer');
    expect(within(footer).getByText('Import statement')).toBeTruthy();
    expect(within(footer).getByText('Add holding')).toBeTruthy();
  });

  it('renders Import statement with the secondaryTonal variant and its doc icon (Add holding stays primary)', async () => {
    await renderScreen();

    const importButton = mockButtonProps.find((props) => props.children === 'Import statement');
    const addHoldingButton = mockButtonProps.find((props) => props.children === 'Add holding');

    expect(importButton?.variant).toBe('secondaryTonal');
    expect(importButton?.icon).toBe('doc.badge.plus');
    expect(addHoldingButton?.variant).toBe('primary');
  });

  it('renders Import statement full-width, stacked above Add holding (not sharing a row)', async () => {
    await renderScreen();

    const importButton = mockButtonProps.find((props) => props.children === 'Import statement');

    expect(importButton?.fullWidth).toBe(true);
  });

  it('opens the document picker with csv/xlsx/plainText/allFiles accepted types when Import statement is pressed', async () => {
    mockPick.mockRejectedValue({ code: 'OPERATION_CANCELED' });
    const { getByText } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(mockPick).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ['text/csv', 'application/xlsx', 'text/plain', '*/*'],
      }),
    );
  });

  it('handles a cancelled picker gracefully: no file read, no navigation, no thrown error', async () => {
    mockPick.mockRejectedValue({ code: 'OPERATION_CANCELED' });
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('StatementImport', expect.anything());
  });

  it('navigates to StatementImport with the resolved filePath and accountId on success, without reading the file itself', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.csv', name: 'statement.csv', type: 'text/csv' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    // `pickAndOpenStatement` hands the picked `uri` straight to
    // `StatementImportScreen`, which owns the ONE read of this file — a
    // pre-read here would pay for the read twice and leave its own failure
    // mode unhandled at this call site (see the handler's own doc comment).
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///mock/statement.csv',
      accountId: 'a',
      expectedFormatId: 'monobank-csv',
    });
  });

  it('passes expectedFormatId resolved from the account bankId when navigating to StatementImport', async () => {
    setLiveData({ accounts: [account({ bankId: 'privatbank' })], holdings: [] });
    mockPick.mockResolvedValue([
      { uri: 'file:///mock/statement.xlsx', name: 'statement.xlsx', type: 'application/xlsx' },
    ]);
    const { getByText, navigation } = await renderScreen();

    await act(async () => {
      await fireEvent.press(getByText('Import statement'));
    });

    expect(navigation.navigate).toHaveBeenCalledWith('StatementImport', {
      filePath: 'file:///mock/statement.xlsx',
      accountId: 'a',
      expectedFormatId: 'privatbank-xlsx',
    });
  });

  it('hides Import statement for a cash account', async () => {
    setLiveData({ accounts: [account({ kind: 'cash', bankId: null })], holdings: [] });
    const { queryByText } = await renderScreen();

    expect(queryByText('Import statement')).toBeNull();
  });

  it('hides Import statement for a crypto account', async () => {
    setLiveData({ accounts: [account({ kind: 'crypto', bankId: null })], holdings: [] });
    const { queryByText } = await renderScreen();

    expect(queryByText('Import statement')).toBeNull();
  });

  // T7: `canImportStatement` became `isBankAccount` — EVERY bank account
  // offers the entry point now, with or without a known statement format,
  // since an unrecognized/mismatched file still routes through the generic
  // column-mapping screen (`statement-import.screen.tsx`'s own "Map columns
  // manually" button) rather than dead-ending.
  it('shows Import statement for a bank account with no bank picked (no known statement format, still a bank account)', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', bankId: null })], holdings: [] });
    const { getByText } = await renderScreen();

    expect(getByText('Import statement')).toBeTruthy();
  });

  it('shows Import statement for a bank account whose picked bank resolves to a statement format', async () => {
    setLiveData({ accounts: [account({ kind: 'bank', bankId: 'privatbank' })], holdings: [] });
    const { getByText } = await renderScreen();

    expect(getByText('Import statement')).toBeTruthy();
  });
});

describe('AccountDetailScreen — localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockButtonProps.length = 0;
    mockSync.mockResolvedValue(undefined);
    mockUseSync.mockReturnValue({ isSyncing: false, error: undefined, sync: mockSync });
    setLiveData({ accounts: [account({ kind: 'bank', institution: null })], holdings: [] });
  });

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the footer action, the Holdings heading, and the Monobank controls from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const view = await renderScreen();

    expect(view.getByText('Додати актив')).toBeTruthy();
    expect(view.getByText('Активи')).toBeTruthy();
    expect(view.getByText('Додати банк')).toBeTruthy();
    expect(view.queryByText('Add holding')).toBeNull();

    // Opening the picker and choosing Monobank renders its connect field
    // from the same Ukrainian catalog.
    await fireEvent.press(view.getByText('Додати банк'));
    await fireEvent.press(view.getByTestId('add-bank-option-monobank'));

    expect(view.getByText('Підключити Monobank')).toBeTruthy();
    expect(view.queryByText('Connect Monobank')).toBeNull();
  });
});
