import { fireEvent } from '@testing-library/react-native';
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
 * `push('TransactionForm', { newTemplate: true })` (transaction-form.screen.tsx,
 * `onCreateTemplate`). It must push, because `navigate` to the focused route's own name only
 * updates that route's params.
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

jest.mock('@kiko/screens/home', () => mockOpeningScreen('Home'));
jest.mock('@kiko/screens/accounts', () => mockOpeningScreen('Accounts'));
jest.mock('@kiko/screens/statistics', () => mockOpeningScreen('Statistics'));
jest.mock('@kiko/screens/settings/settings', () => mockOpeningScreen('Settings'));

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { useState } = require('react');
  const { Pressable, Text, TextInput } = require('react-native');

  const TransactionFormStub = ({
    navigation,
    route,
  }: {
    navigation: {
      goBack: () => void;
      navigate: (name: string, params: object) => void;
      push: (name: string, params: object) => void;
    };
    route: { params?: { newTemplate?: boolean } };
  }) => {
    const [amount, setAmount] = useState('');

    return (
      <>
        <Text testID="form-kind">{route.params?.newTemplate ? 'template' : 'transaction'}</Text>

        <TextInput testID="draft-amount" value={amount} onChangeText={setAmount} />

        <Pressable
          testID="add-template"
          onPress={() => navigation.push('TransactionForm', { newTemplate: true })}
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
});

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
