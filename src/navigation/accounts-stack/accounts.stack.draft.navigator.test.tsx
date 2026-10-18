import {
  CommonActions,
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type { AccountsStackParamList } from '../types';

import AccountsStack from './accounts.stack';

/**
 * A form keeps its unsaved fields in its route's params, because a fold or unfold remounts every
 * screen and keeps the params. This suite renders the REAL pane stack with the REAL transaction
 * form and mocks only the data layer and the Accounts root: the part a unit test of the form
 * cannot show is which route a blur writes to when two panes are on screen, and what the stack
 * does with the params across a fold and an unfold.
 */

const mockHoldings = [
  { id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Wallet' },
];
const mockCategories = [{ key: 'groceries', title: 'Groceries', icon: 'cart' }];

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);
jest.mock('@kiko/screens/accounts', () => {
  const { Text } = require('react-native');

  const AccountsScreenStub = () => <Text testID="accounts-screen">Accounts</Text>;

  return { __esModule: true, default: AccountsScreenStub };
});
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, tables: string[]) => {
    const dataByTable: Record<string, unknown[]> = {
      holdings: mockHoldings,
      categories: mockCategories,
    };

    return { data: dataByTable[tables[0]] ?? [], isLoading: false };
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    recordManual: jest.fn().mockResolvedValue(undefined),
    getByIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    distinctDescriptionsQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    latestManualHoldingQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/bonds/bond-register-repo', () => ({
  bondRegisterRepo: {
    findByIsinQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    fetchedAtQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
  refreshBondRegisterIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/sync/use-sync', () => ({ useSync: () => ({ sync: jest.fn() }) }));
jest.mock('@kiko/sync/use-crypto-sync', () => ({ useCryptoSync: () => ({ sync: jest.fn() }) }));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const navigationRef = createNavigationContainerRef<AccountsStackParamList>();

type StackRoute = { key: string; name: string; params?: { draft?: { amount?: string } } };

const routes = (): StackRoute[] => (navigationRef.getRootState()?.routes ?? []) as StackRoute[];

const routeNamed = (name: string): StackRoute | undefined =>
  routes().find((route) => route.name === name);

// A pose change reports a burst of snapshots; the stack waits this long for it to end.
const SETTLED = 200;

const changeWindow = async (mode: 'single' | 'columns'): Promise<void> => {
  await emitLayoutMode(mode);
  await act(async () => {
    jest.advanceTimersByTime(SETTLED);
  });
};

const renderStack = async (): Promise<void> => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <AccountsStack />
    </NavigationContainer>,
  );
};

const openTransactionForm = async (): Promise<void> => {
  await act(async () => navigationRef.navigate('TransactionForm', { holdingId: 'h1' }));
};

// What a screen asking to open another one does: the new screen goes on top of the asking form.
const openAccountFormFrom = async (formKey: string): Promise<void> => {
  await act(async () => {
    navigationRef.dispatch({ ...CommonActions.navigate('AccountForm', {}), source: formKey });
  });
};

const fillAmount = async (value: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('Amount'), value);
};

const blurAmount = async (): Promise<void> => {
  await fireEvent(screen.getByLabelText('Amount'), 'blur');
};

describe('AccountsStack — form drafts across a fold and an unfold', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    resetLayoutMode();
    await emitLayoutMode('columns');
  });

  afterEach(() => {
    jest.useRealTimers();
    resetLayoutMode();
  });

  describe('in two panes', () => {
    it('opens the form in its pane, beside the list', async () => {
      await renderStack();
      await openTransactionForm();

      expect(routes().map((route) => route.name)).toEqual(['Accounts', 'TransactionForm']);
      expect(screen.getByTestId('transaction-form')).toBeTruthy();
      expect(screen.getByTestId('accounts-screen')).toBeTruthy();
    });

    // Both forms are in the detail pane, and the one that is covered cannot be typed in.
    it('keeps a blur on the route of the form it came from when a deeper step covers the form', async () => {
      await renderStack();
      await openTransactionForm();
      const formKey = routeNamed('TransactionForm')?.key ?? '';

      await fillAmount('12.34');
      await blurAmount();
      await openAccountFormFrom(formKey);

      expect(routes().map((route) => route.name)).toEqual([
        'Accounts',
        'TransactionForm',
        'AccountForm',
      ]);
      expect(routeNamed('TransactionForm')?.params?.draft?.amount).toBe('12.34');
      expect(routeNamed('AccountForm')?.params?.draft).toBeUndefined();
      expect(routeNamed('Accounts')?.params).toBeUndefined();
    });

    it('keeps the values of the form beneath a deeper step through a fold and the way back to it', async () => {
      await renderStack();
      await openTransactionForm();
      const formKey = routeNamed('TransactionForm')?.key ?? '';

      await fillAmount('12.34');
      await blurAmount();
      await openAccountFormFrom(formKey);

      await changeWindow('single');
      await act(async () => navigationRef.goBack());

      expect(screen.getByLabelText('Amount').props.value).toBe('12.34');
      expect(routeNamed('TransactionForm')?.key).toBe(formKey);
    });
  });

  describe('a fold, then an unfold', () => {
    it('gives back what was filled in, with a blur before the fold', async () => {
      await renderStack();
      await openTransactionForm();
      await fillAmount('12.34');
      await blurAmount();

      await changeWindow('single');

      expect(screen.getByTestId('transaction-form')).toBeTruthy();
      expect(screen.getByLabelText('Amount').props.value).toBe('12.34');

      await changeWindow('columns');

      expect(screen.getByLabelText('Amount').props.value).toBe('12.34');
    });

    it('gives back what was typed after the last blur, as the fold saves it before the screens remount', async () => {
      await renderStack();
      await openTransactionForm();
      await fillAmount('99');

      expect(routeNamed('TransactionForm')?.params?.draft).toBeUndefined();

      await changeWindow('single');

      expect(screen.getByLabelText('Amount').props.value).toBe('99');
      expect(routeNamed('TransactionForm')?.params?.draft?.amount).toBe('99');

      await changeWindow('columns');

      expect(screen.getByLabelText('Amount').props.value).toBe('99');
    });

    it('saves what was typed before the fold when the pose change reports columns, rows, then one pane', async () => {
      await renderStack();
      await openTransactionForm();
      await fillAmount('99');
      const before = screen.getByTestId('transaction-form');

      await emitLayoutMode('rows');
      await emitLayoutMode('single');

      // The fold waits for the burst to end; the draft is already on the route.
      expect(routeNamed('TransactionForm')?.params?.draft?.amount).toBe('99');
      expect(screen.getByTestId('transaction-form')).toBe(before);

      await act(async () => {
        jest.advanceTimersByTime(SETTLED);
      });

      expect(screen.getByTestId('transaction-form')).not.toBe(before);
      expect(screen.getByLabelText('Amount').props.value).toBe('99');
    });

    it('saves what was typed before the unfold when the pose change reports one pane, rows, then columns', async () => {
      await renderStack();
      await openTransactionForm();
      await changeWindow('single');
      await fillAmount('55');
      const before = screen.getByTestId('transaction-form');

      await emitLayoutMode('rows');
      await emitLayoutMode('columns');

      expect(routeNamed('TransactionForm')?.params?.draft?.amount).toBe('55');
      expect(screen.getByTestId('transaction-form')).toBe(before);

      await act(async () => {
        jest.advanceTimersByTime(SETTLED);
      });

      expect(screen.getByTestId('transaction-form')).not.toBe(before);
      expect(screen.getByLabelText('Amount').props.value).toBe('55');
    });

    it('remounts the form: it is a new screen with the same route', async () => {
      await renderStack();
      await openTransactionForm();
      const formKey = routeNamed('TransactionForm')?.key;
      const before = screen.getByTestId('transaction-form');

      await changeWindow('single');

      expect(routeNamed('TransactionForm')?.key).toBe(formKey);
      expect(screen.getByTestId('transaction-form')).not.toBe(before);
    });

    it('leaves a form nobody touched without a draft', async () => {
      await renderStack();
      await openTransactionForm();

      await changeWindow('single');
      await changeWindow('columns');

      expect(routeNamed('TransactionForm')?.params?.draft).toBeUndefined();
    });
  });

  describe('in one pane', () => {
    beforeEach(async () => {
      await emitLayoutMode('single');
    });

    it('writes a blur onto the route of the form, as before', async () => {
      await renderStack();
      await openTransactionForm();
      await fillAmount('7');
      await blurAmount();

      expect(routeNamed('TransactionForm')?.params?.draft?.amount).toBe('7');
    });

    it('drops the draft with the route once the form is left', async () => {
      await renderStack();
      await openTransactionForm();
      await fillAmount('7');
      await blurAmount();

      await act(async () => navigationRef.goBack());
      await openTransactionForm();

      expect(screen.getByLabelText('Amount').props.value).toBe('');
      expect(routeNamed('TransactionForm')?.params?.draft).toBeUndefined();
    });
  });
});
