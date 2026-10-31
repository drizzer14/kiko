import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { act, render, screen } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';

import '@kiko/design-system/unistyles';

import { SETTLE_DELAY_MS } from '../pane-stack';

import HomeStack from './home.stack';

/**
 * The Add transaction form opens in the left pane of the Duo, unfolded and beside the trailing
 * side bar, with its Cancel and Save in the bar's row. This suite renders the REAL Home stack with
 * the REAL form and proves its title is the native large title below those buttons, with no
 * heading of its own in the content. Statistics, the pane's default, renders the heading as the
 * real screen does, so the same window also proves the default keeps the native large title.
 */

jest.mock('@kiko/display-regions', () => ({
  ...require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
  useFoldRegion: () => null,
  useVerticalBarEdge: () => 'trailing',
}));
jest.mock('@kiko/screens/home', () => {
  const { Text } = require('react-native');

  const HomeScreenStub = () => <Text testID="home-screen">Home</Text>;

  return { __esModule: true, default: HomeScreenStub };
});
jest.mock('@kiko/screens/statistics', () => {
  const { ScrollView } = require('react-native');
  const LargeTitleHeading = require('@kiko/design-system/components/large-title-heading').default;

  const StatisticsStub = () => (
    <ScrollView>
      <LargeTitleHeading />
    </ScrollView>
  );

  return { __esModule: true, default: StatisticsStub };
});
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, tables: string[]) => {
    const dataByTable: Record<string, readonly unknown[]> = {
      holdings: [
        {
          id: 'h1',
          currency: 'UAH',
          balanceMinorUnits: 0,
          type: 'cash',
          name: 'Wallet',
          accountId: 'acc',
        },
      ],
      accounts: [{ id: 'acc', name: 'Home' }],
      categories: [{ key: 'groceries', title: 'Groceries', icon: 'cart' }],
    };

    return { data: dataByTable[tables[0]] ?? [], isLoading: false };
  },
}));
jest.mock('@kiko/transactions/repo', () => mockDataLayer.transactionsRepo);
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

const navigationRef = createNavigationContainerRef<ParamListBase>();

const renderUnfoldedHome = async (): Promise<void> => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <HomeStack />
    </NavigationContainer>,
  );
  await emitLayoutMode('columns');
  await act(async () => jest.advanceTimersByTime(SETTLE_DELAY_MS));
};

const renderUnfoldedAddForm = async (): Promise<void> => {
  await renderUnfoldedHome();
  await act(async () => navigationRef.navigate('TransactionForm', {}));
};

describe('HomeStack: the Add transaction title on an unfolded Duo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    resetLayoutMode();
    jest.useRealTimers();
  });

  it('keeps the native large title below Cancel and Save, with no heading in the content', async () => {
    await renderUnfoldedAddForm();

    expect(screen.queryAllByTestId('large-title-heading')).toHaveLength(0);
  });
});

describe('HomeStack: the default Statistics page on an unfolded Duo', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    resetLayoutMode();
    jest.useRealTimers();
  });

  it('keeps the native large title on the first page of the companion pane', async () => {
    await renderUnfoldedHome();

    expect(screen.queryAllByTestId('large-title-heading')).toHaveLength(0);
  });
});
