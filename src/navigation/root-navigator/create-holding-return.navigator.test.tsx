import {
  CommonActions,
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import HomeStack from '../home-stack';
import AccountsStack from '../accounts-stack';

/**
 * The empty picker's "Add holding" row sends the user to a create form and back
 * to the SAME form instance with its draft. That is a router property a
 * `navigationSpy` cannot see, so this suite renders the REAL Home and Accounts
 * stacks (their route registrations are what is under test) with the form
 * screens swapped for stand-ins that make the exact navigation calls their real
 * counterparts make:
 *
 * - TransactionForm: `navigate('HoldingForm', { accountId })`
 *   (transaction-form.screen.tsx, `onCreateHolding`).
 * - The loan form is HoldingForm itself: it must `push('HoldingForm', …)`,
 *   because `navigate` to the focused route's own name only updates that
 *   route's params (holding-form.screen.tsx).
 */

jest.mock('@kiko/screens/home', () => {
  const { Pressable, Text } = require('react-native');

  const HomeStub = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, p: object) => void };
  }) => (
    <Pressable
      testID="open-transaction-form"
      onPress={() => navigation.navigate('TransactionForm', {})}
    >
      <Text>Add transaction</Text>
    </Pressable>
  );

  return { __esModule: true, default: HomeStub };
});

jest.mock('@kiko/screens/accounts', () => {
  const { Pressable, Text } = require('react-native');

  const AccountsStub = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, p: object) => void };
  }) => (
    <>
      <Pressable
        testID="open-transaction-form"
        onPress={() => navigation.navigate('TransactionForm', { holdingId: 'h-1' })}
      >
        <Text>Add transaction</Text>
      </Pressable>

      <Pressable
        testID="open-loan-form"
        onPress={() =>
          navigation.navigate('HoldingForm', { accountId: 'debt-1', debtAccount: true })
        }
      >
        <Text>Add loan</Text>
      </Pressable>
    </>
  );

  return { __esModule: true, default: AccountsStub };
});

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { useState } = require('react');
  const { Pressable, Text, TextInput } = require('react-native');

  const TransactionFormStub = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, p: object) => void };
  }) => {
    const [amount, setAmount] = useState('');

    return (
      <>
        <TextInput testID="draft-amount" value={amount} onChangeText={setAmount} />

        <Pressable
          testID="add-holding"
          onPress={() => navigation.navigate('HoldingForm', { accountId: 'acc-1' })}
        >
          <Text>Add holding</Text>
        </Pressable>
      </>
    );
  };

  return { __esModule: true, default: TransactionFormStub };
});

jest.mock('@kiko/screens/forms/holding-form', () => {
  const { useState } = require('react');
  const { Pressable, Text, TextInput } = require('react-native');

  const HoldingFormStub = ({
    navigation,
    route,
  }: {
    navigation: {
      goBack: () => void;
      navigate: (name: string, p: object) => void;
      push: (name: string, p: object) => void;
    };
    route: { params: { accountId: string } };
  }) => {
    const [principal, setPrincipal] = useState('');

    return (
      <>
        <Text testID="holding-form-account">{route.params.accountId}</Text>

        <TextInput testID="draft-principal" value={principal} onChangeText={setPrincipal} />

        <Pressable testID="save-holding" onPress={() => navigation.goBack()}>
          <Text>Save</Text>
        </Pressable>

        <Pressable
          testID="push-holding-form"
          onPress={() => navigation.push('HoldingForm', { accountId: 'acc-2' })}
        >
          <Text>Add holding</Text>
        </Pressable>

        <Pressable
          testID="navigate-holding-form"
          onPress={() => navigation.navigate('HoldingForm', { accountId: 'acc-2' })}
        >
          <Text>Add holding</Text>
        </Pressable>
      </>
    );
  };

  return { __esModule: true, default: HoldingFormStub };
});

jest.mock('@kiko/screens/forms/account-form', () => {
  const { Text } = require('react-native');

  const AccountFormStub = () => <Text testID="account-form">Account form</Text>;

  return { __esModule: true, default: AccountFormStub };
});

// A bare `ParamListBase` ref: the same suite drives two different stacks.
const navigationRef = createNavigationContainerRef();

const routes = () => navigationRef.getRootState()?.routes ?? [];

const routeNames = (): string[] => routes().map((route) => route.name);

const keyOf = (name: string): string | undefined =>
  routes().find((route) => route.name === name)?.key;

const renderStack = async (stack: 'home' | 'accounts') => {
  const view = await render(
    <NavigationContainer ref={navigationRef}>
      {stack === 'home' ? <HomeStack /> : <AccountsStack />}
    </NavigationContainer>,
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return view;
};

describe.each([
  ['Home', 'home', 'Home'],
  ['Accounts', 'accounts', 'Accounts'],
] as const)('%s stack — adding a holding from the transaction form', (_name, stack, rootName) => {
  it('returns to the SAME transaction form instance with its draft, with no route left behind', async () => {
    const view = await renderStack(stack);

    await fireEvent.press(view.getByTestId('open-transaction-form'));
    await fireEvent.changeText(view.getByTestId('draft-amount'), '12.5');

    const transactionFormKey = keyOf('TransactionForm');

    await fireEvent.press(view.getByTestId('add-holding'));

    expect(routeNames()).toEqual([rootName, 'TransactionForm', 'HoldingForm']);

    await fireEvent.press(view.getByTestId('save-holding'));

    expect(routeNames()).toEqual([rootName, 'TransactionForm']);
    expect(keyOf('TransactionForm')).toBe(transactionFormKey);
    expect(view.getByTestId('draft-amount').props.value).toBe('12.5');
  });
});

describe('Home stack — the create forms the picker row can open', () => {
  it('registers the account form, which the row opens when no account can hold the holding', async () => {
    const view = await renderStack('home');

    await fireEvent.press(view.getByTestId('open-transaction-form'));
    await act(async () => navigationRef.dispatch(CommonActions.navigate('AccountForm', {})));

    expect(routeNames()).toEqual(['Home', 'TransactionForm', 'AccountForm']);
    expect(view.getByTestId('account-form')).toBeTruthy();
  });
});

describe('Accounts stack — adding a holding from the loan form', () => {
  it('pushes a second holding form and returns to the SAME loan form instance', async () => {
    const view = await renderStack('accounts');

    await fireEvent.press(view.getByTestId('open-loan-form'));
    await fireEvent.changeText(view.getByTestId('draft-principal'), '5000');

    const loanFormKey = keyOf('HoldingForm');

    await fireEvent.press(view.getByTestId('push-holding-form'));

    expect(routeNames()).toEqual(['Accounts', 'HoldingForm', 'HoldingForm']);

    await fireEvent.press(view.getAllByTestId('save-holding').at(-1) as never);

    expect(routeNames()).toEqual(['Accounts', 'HoldingForm']);
    expect(keyOf('HoldingForm')).toBe(loanFormKey);
    expect(view.getByTestId('draft-principal').props.value).toBe('5000');
  });

  it('adds no route when a holding form navigates to its own name, which is why the loan form pushes', async () => {
    const view = await renderStack('accounts');

    await fireEvent.press(view.getByTestId('open-loan-form'));

    const loanFormKey = keyOf('HoldingForm');

    await fireEvent.press(view.getByTestId('navigate-holding-form'));

    expect(routeNames()).toEqual(['Accounts', 'HoldingForm']);
    expect(keyOf('HoldingForm')).toBe(loanFormKey);
    expect(view.getByTestId('holding-form-account').props.children).toBe('acc-2');
  });
});
