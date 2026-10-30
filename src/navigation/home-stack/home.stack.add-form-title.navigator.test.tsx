import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import { act, render, screen, within } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';

import '@kiko/design-system/unistyles';

import { SETTLE_DELAY_MS } from '../pane-stack';

import HomeStack from './home.stack';

/**
 * The Add transaction form opens in the left pane of the Duo, unfolded and beside the trailing
 * side bar, with its Cancel and Save in the bar's row. This suite renders the REAL Home stack with
 * the REAL form and reads where the form's own title heading sits: in the bar's row it would run
 * under those buttons, so it must sit below the bar. Statistics, the pane's default, shows its
 * heading as the real screen does, so the same window also proves the default's heading stays in
 * the bar's row while it is the pane's first page.
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

const headingWithText = (text: string) =>
  screen
    .getAllByTestId('large-title-heading')
    .find((heading) => within(heading).queryByText(text) !== null);

// The in-row heading is laid over the bar's row; the below-bar heading is in the content flow.
const isInBarRow = (text: string): boolean => {
  const heading = headingWithText(text);

  expect(heading).toBeDefined();

  return StyleSheet.flatten(heading?.props.style).position === 'absolute';
};

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

describe.each([
  ['en', 'Add Transaction'],
  ['uk', 'Додати транзакцію'],
])('HomeStack: the Add transaction title on an unfolded Duo, in %s', (language, title) => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await act(async () => i18n.changeLanguage(language));
  });

  afterEach(async () => {
    resetLayoutMode();
    jest.useRealTimers();
    await act(async () => i18n.changeLanguage('en'));
  });

  it('puts the title below the bar, clear of Cancel and Save', async () => {
    await renderUnfoldedAddForm();

    expect(isInBarRow(title)).toBe(false);
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

  it('keeps its heading in the bar row as the first page of the companion pane', async () => {
    await renderUnfoldedHome();

    expect(isInBarRow('Statistics')).toBe(true);
  });
});
