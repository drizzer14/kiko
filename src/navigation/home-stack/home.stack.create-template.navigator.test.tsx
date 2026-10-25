import {
  createNavigationContainerRef,
  NavigationContainer,
  type ParamListBase,
} from '@react-navigation/native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from './home.stack';

/**
 * The empty Template tab's "Add template" row pushes the new-template form over the form that asked
 * for it, and the template saved there is picked on the form beneath. This suite renders the REAL
 * Home stack with the REAL transaction form in both roles and mocks only the data layer and the
 * Home root: what a screen test cannot show is that the original form keeps its route key, its tab
 * and its draft while the pushed one is open, and that the focus it regains reaches the picker.
 * The template list is a live query over a mutable list, and the mocked create writes to it.
 */

type StoredTemplate = {
  id: string;
  name: string;
  draft: object;
  createdAt: number;
  updatedAt: number;
};

const mockTemplates: StoredTemplate[] = [];
const mockListeners = new Set<() => void>();
let mockTemplateSnapshot: readonly StoredTemplate[] = [];

const mockChangeTemplates = (change: (templates: StoredTemplate[]) => void): void => {
  change(mockTemplates);
  mockTemplateSnapshot = [...mockTemplates];

  for (const listener of mockListeners) {
    listener();
  }
};

const mockHoldings = [
  {
    id: 'h1',
    currency: 'UAH',
    balanceMinorUnits: 0,
    type: 'cash',
    name: 'Wallet',
    accountId: 'acc',
  },
];

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);
jest.mock('@kiko/screens/home', () => {
  const { Text } = require('react-native');

  const HomeScreenStub = () => <Text testID="home-screen">Home</Text>;

  return { __esModule: true, default: HomeScreenStub };
});
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }, tables: string[]) => {
    const { useSyncExternalStore } = require('react');

    const templates = useSyncExternalStore(
      (listener: () => void) => {
        mockListeners.add(listener);

        return () => mockListeners.delete(listener);
      },
      () => mockTemplateSnapshot,
    );

    const dataByTable: Record<string, readonly unknown[]> = {
      holdings: mockHoldings,
      accounts: [{ id: 'acc', name: 'Home' }],
      categories: [{ key: 'groceries', title: 'Groceries', icon: 'cart' }],
    };

    if (query.__kind === 'templateList') {
      return { data: templates, isLoading: false };
    }

    return { data: dataByTable[tables[0]] ?? [], isLoading: false };
  },
}));
jest.mock('@kiko/transactions/repo', () => mockDataLayer.transactionsRepo);
jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    listQuery: () => ({ __kind: 'templateList', toSQL: () => ({ sql: '', params: [] }) }),
    create: jest.fn(async (input: { name: string; draft: object }) => {
      mockChangeTemplates((templates) => {
        templates.push({
          id: 'created',
          name: input.name,
          draft: input.draft,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
    }),
  },
}));
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

type StackRoute = { key: string; name: string; params?: { newTemplate?: boolean } };

const routes = (): StackRoute[] => (navigationRef.getRootState()?.routes ?? []) as StackRoute[];

const formRoutes = (): StackRoute[] => routes().filter((route) => route.name === 'TransactionForm');

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

// The native bar of the form on top, pressed the way the native side reports a press.
const pressSaveOnTopForm = async (): Promise<void> => {
  const tree = screen.toJSON() as RenderedNode | RenderedNode[] | null;
  const roots = Array.isArray(tree) ? tree : [tree];

  const saveConfigs = roots
    .flatMap(headerConfigsOf)
    .filter((config) =>
      (config.headerRightBarButtonItems ?? []).some((item) => item.title === 'Save'),
    );
  const config = saveConfigs.at(-1);
  const save = config?.headerRightBarButtonItems?.find((item) => item.title === 'Save');

  expect(save).toBeDefined();

  await act(async () => {
    config?.onPressHeaderBarButtonItem?.({ nativeEvent: { buttonId: save?.buttonId ?? '' } });
  });
};

const openTransactionForm = async (): Promise<void> => {
  await act(async () => navigationRef.navigate('TransactionForm', {}));
};

const openTemplateTab = async (): Promise<void> => {
  await fireEvent.press(within(screen.getByTestId('entry-tabs')).getByText('Template'));
};

const pressAddTemplate = async (): Promise<void> => {
  await fireEvent.press(screen.getByTestId('template-field'));

  const sheet = screen.getByTestId('template-field-sheet-modal');

  await fireEvent.press(screen.getByTestId('template-field-empty-action'));
  await act(async () => (sheet.props.onDismiss as () => void)());
};

const renderHomeStack = async (): Promise<void> => {
  await render(
    <NavigationContainer ref={navigationRef}>
      <HomeStack />
    </NavigationContainer>,
  );
};

describe('HomeStack — adding a template from the empty Template tab', () => {
  beforeEach(async () => {
    resetLayoutMode();
    await emitLayoutMode('single');
    mockChangeTemplates((templates) => templates.splice(0));
  });

  afterEach(() => {
    resetLayoutMode();
  });

  it('selects the template saved in the pushed form on the SAME original form, keeping its route key and its Template tab', async () => {
    await renderHomeStack();
    await openTransactionForm();
    await openTemplateTab();

    const originalKey = formRoutes()[0]?.key;

    await pressAddTemplate();

    expect(formRoutes().map((route) => route.params?.newTemplate)).toEqual([undefined, true]);

    await fireEvent.changeText(screen.getByLabelText('Template name'), 'Rent');
    await pressSaveOnTopForm();

    expect(routes().map((route) => route.name)).toEqual(['Home', 'TransactionForm']);
    expect(formRoutes()[0]?.key).toBe(originalKey);
    expect(screen.getByTestId('template-field')).toHaveTextContent('Rent');
  });

  it('selects nothing on the original form when the pushed form goes back unsaved, keeping its typed amount', async () => {
    await renderHomeStack();
    await openTransactionForm();
    await fireEvent.changeText(screen.getByLabelText('Amount'), '42');
    await openTemplateTab();

    const originalKey = formRoutes()[0]?.key;

    await pressAddTemplate();

    expect(formRoutes()).toHaveLength(2);

    await act(async () => navigationRef.goBack());

    expect(routes().map((route) => route.name)).toEqual(['Home', 'TransactionForm']);
    expect(formRoutes()[0]?.key).toBe(originalKey);
    expect(screen.getByTestId('template-field')).toHaveTextContent('Select a template');

    await fireEvent.press(within(screen.getByTestId('entry-tabs')).getByText('Manual'));

    expect(screen.getByLabelText('Amount').props.value).toBe('42');
  });
});
