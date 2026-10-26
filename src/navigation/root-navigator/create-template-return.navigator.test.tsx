import { fireEvent } from '@testing-library/react-native';
import { emitLayoutMode, resetLayoutMode } from '@kiko/test-support/layout-mode-spy';
import { createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { renderStackInContainer, stackProbe } from '@kiko/test-support/navigator-stack-probe';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import AccountsStack from '../accounts-stack';
import SettingsStack from '../settings-stack';
import StatisticsStack from '../statistics-stack';

/**
 * The empty Template tab's "Add template" row sends the user to the new-template form and back to
 * the SAME transaction form instance with its draft. That is a router property a `navigationSpy`
 * cannot see, so this suite renders the REAL Home, Accounts, Statistics and Settings stacks, with
 * the transaction form swapped for a stand-in that makes the exact call the real screen makes:
 * `push('TransactionForm', { newTemplate: true, handbackId })` (transaction-form.screen.tsx,
 * `onCreateTemplate`). It must push, because `navigate` to the focused route's own name only
 * updates that route's params. The handback id is the one-shot id the new-template form hands its
 * saved template back to, so it has to survive the push in every stack.
 */

function mockOpeningScreen(label: string) {
  const { Pressable, Text } = require('react-native');

  const OpeningScreen = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, params: object) => void };
  }) => (
    <Pressable
      testID="open-transaction-form"
      onPress={() => navigation.navigate('TransactionForm', {})}
    >
      <Text>{label}</Text>
    </Pressable>
  );

  return { __esModule: true, default: OpeningScreen };
}

jest.mock('@kiko/display-regions', () =>
  require('@kiko/test-support/layout-mode-spy').layoutModeSpyModule(),
);
jest.mock('@kiko/screens/home', () => mockOpeningScreen('Home'));
jest.mock('@kiko/screens/accounts', () => mockOpeningScreen('Accounts'));
jest.mock('@kiko/screens/statistics', () => mockOpeningScreen('Statistics'));
jest.mock('@kiko/screens/settings/settings', () => mockOpeningScreen('Settings'));

// The route key of every form that received a `focus` event, in order.
const mockFocusLog: string[] = [];

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { useEffect, useState } = require('react');
  const { Pressable, Text, TextInput } = require('react-native');

  const TransactionFormStub = ({
    navigation,
    route,
  }: {
    navigation: {
      addListener: (type: 'focus', listener: () => void) => () => void;
      goBack: () => void;
      navigate: (name: string, params: object) => void;
      push: (name: string, params: object) => void;
    };
    route: { key: string; params?: { newTemplate?: boolean; handbackId?: string } };
  }) => {
    const [amount, setAmount] = useState('');

    useEffect(
      () => navigation.addListener('focus', () => mockFocusLog.push(route.key)),
      [navigation, route.key],
    );

    return (
      <>
        <Text testID="form-kind">{route.params?.newTemplate ? 'template' : 'transaction'}</Text>

        <Text testID="form-handback">{route.params?.handbackId ?? 'none'}</Text>

        <TextInput testID="draft-amount" value={amount} onChangeText={setAmount} />

        <Pressable
          testID="add-template"
          onPress={() =>
            navigation.push('TransactionForm', { newTemplate: true, handbackId: 'h-1' })
          }
        >
          <Text>Add template</Text>
        </Pressable>

        <Pressable
          testID="navigate-transaction-form"
          onPress={() => navigation.navigate('TransactionForm', { newTemplate: true })}
        >
          <Text>Add template</Text>
        </Pressable>

        <Pressable testID="save-template" onPress={() => navigation.goBack()}>
          <Text>Save</Text>
        </Pressable>

        <Pressable testID="cancel-template" onPress={() => navigation.goBack()}>
          <Text>Cancel</Text>
        </Pressable>
      </>
    );
  };

  return { __esModule: true, default: TransactionFormStub };
});

const navigationRef = createNavigationContainerRef<ParamListBase>();

const { routeNames, keyOf } = stackProbe(navigationRef);

type RouteWithParams = { key: string; name: string; params?: { handbackId?: string } };

const topHandbackId = (): string | undefined =>
  ((navigationRef.getRootState()?.routes ?? []) as RouteWithParams[]).at(-1)?.params?.handbackId;

const STACKS = {
  home: HomeStack,
  accounts: AccountsStack,
  statistics: StatisticsStack,
  settings: SettingsStack,
};

const renderStack = (stack: keyof typeof STACKS) =>
  renderStackInContainer(navigationRef, STACKS[stack]);

describe.each([
  ['Home', 'home', 'Home'],
  ['Accounts', 'accounts', 'Accounts'],
  ['Statistics', 'statistics', 'Statistics'],
  ['Settings', 'settings', 'Settings'],
] as const)('%s stack — adding a template from the transaction form', (_name, stack, rootName) => {
  const openNewTemplateForm = async (view: Awaited<ReturnType<typeof renderStack>>) => {
    await fireEvent.press(view.getByTestId('open-transaction-form'));
    await fireEvent.changeText(view.getByTestId('draft-amount'), '12.5');

    const transactionFormKey = keyOf('TransactionForm');

    await fireEvent.press(view.getByTestId('add-template'));

    expect(routeNames()).toEqual([rootName, 'TransactionForm', 'TransactionForm']);

    return transactionFormKey;
  };

  const expectBackOnSameForm = (
    view: Awaited<ReturnType<typeof renderStack>>,
    transactionFormKey: string | undefined,
  ) => {
    expect(routeNames()).toEqual([rootName, 'TransactionForm']);
    expect(keyOf('TransactionForm')).toBe(transactionFormKey);
    expect(view.getByTestId('form-kind')).toHaveTextContent('transaction');
    expect(view.getByTestId('draft-amount').props.value).toBe('12.5');
  };

  it('pushes a new-template form and returns to the SAME transaction form instance with its draft on save', async () => {
    const view = await renderStack(stack);
    const transactionFormKey = await openNewTemplateForm(view);

    expect(view.getAllByTestId('form-kind').at(-1)).toHaveTextContent('template');

    await fireEvent.press(view.getAllByTestId('save-template').at(-1) as never);

    expectBackOnSameForm(view, transactionFormKey);
  });

  it('returns to the SAME transaction form instance with its draft on cancel', async () => {
    const view = await renderStack(stack);
    const transactionFormKey = await openNewTemplateForm(view);

    await fireEvent.press(view.getAllByTestId('cancel-template').at(-1) as never);

    expectBackOnSameForm(view, transactionFormKey);
  });

  it('carries the handback id to the pushed new-template form in its params', async () => {
    const view = await renderStack(stack);

    await openNewTemplateForm(view);

    expect(topHandbackId()).toBe('h-1');
    expect(view.getAllByTestId('form-handback').at(-1)).toHaveTextContent('h-1');
  });
});

// Two panes: the pane stack's own view renders the stack, so the focus a form regains on return is
// the pane stack's to deliver.
describe.each([
  ['Accounts', 'accounts', 'Accounts'],
  ['Settings', 'settings', 'Settings'],
] as const)(
  '%s stack in two panes — adding a template from the transaction form',
  (_name, stack, rootName) => {
    beforeEach(async () => {
      resetLayoutMode();
      await emitLayoutMode('columns');
      mockFocusLog.length = 0;
    });

    afterEach(() => {
      resetLayoutMode();
    });

    const openNewTemplateForm = async (view: Awaited<ReturnType<typeof renderStack>>) => {
      await fireEvent.press(view.getByTestId('open-transaction-form'));

      const transactionFormKey = keyOf('TransactionForm') as string;

      await fireEvent.press(view.getByTestId('add-template'));

      expect(routeNames()).toEqual([rootName, 'TransactionForm', 'TransactionForm']);

      mockFocusLog.length = 0;

      return transactionFormKey;
    };

    it('returns to the SAME transaction form in the split layout and fires its focus once on save', async () => {
      const view = await renderStack(stack);
      const transactionFormKey = await openNewTemplateForm(view);

      await fireEvent.press(view.getAllByTestId('save-template').at(-1) as never);

      expect(routeNames()).toEqual([rootName, 'TransactionForm']);
      expect(keyOf('TransactionForm')).toBe(transactionFormKey);
      expect(mockFocusLog).toEqual([transactionFormKey]);
    });

    it('fires the original form focus once on cancel in the split layout', async () => {
      const view = await renderStack(stack);
      const transactionFormKey = await openNewTemplateForm(view);

      await fireEvent.press(view.getAllByTestId('cancel-template').at(-1) as never);

      expect(routeNames()).toEqual([rootName, 'TransactionForm']);
      expect(keyOf('TransactionForm')).toBe(transactionFormKey);
      expect(mockFocusLog).toEqual([transactionFormKey]);
    });
  },
);

describe('Home stack — a transaction form opening its own name', () => {
  it('adds no route when a transaction form navigates to its own name, which is why the row pushes', async () => {
    const view = await renderStack('home');

    await fireEvent.press(view.getByTestId('open-transaction-form'));

    const transactionFormKey = keyOf('TransactionForm');

    await fireEvent.press(view.getByTestId('navigate-transaction-form'));

    expect(routeNames()).toEqual(['Home', 'TransactionForm']);
    expect(keyOf('TransactionForm')).toBe(transactionFormKey);
    expect(view.getByTestId('form-kind')).toHaveTextContent('template');
  });
});
