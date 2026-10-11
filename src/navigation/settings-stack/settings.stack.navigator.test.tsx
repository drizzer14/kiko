import {
  CommonActions,
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import SettingsStack from './settings.stack';

/**
 * A template is added or edited from Settings, and the form's empty picker offers "Add holding"
 * and "Add account". That is a router property a `navigationSpy` cannot see, so this suite renders
 * the REAL Settings stack (its route registrations are what is under test) with the screens
 * swapped for stand-ins that make the exact navigation calls their real counterparts make
 * (`navigate('HoldingForm', { accountId })`, transaction-form.screen.tsx `onCreateHolding`).
 */

jest.mock('@kiko/screens/settings/settings', () => {
  const { Pressable, Text } = require('react-native');

  const SettingsStub = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, params?: object) => void };
  }) => (
    <Pressable
      testID="open-template-form"
      onPress={() => navigation.navigate('TransactionForm', { newTemplate: true })}
    >
      <Text>Add template</Text>
    </Pressable>
  );

  return { __esModule: true, default: SettingsStub };
});

jest.mock('@kiko/screens/forms/transaction-form', () => {
  const { useState } = require('react');
  const { Pressable, Text, TextInput } = require('react-native');

  const TransactionFormStub = ({
    navigation,
  }: {
    navigation: { navigate: (name: string, params?: object) => void };
  }) => {
    const [name, setName] = useState('');

    return (
      <>
        <TextInput testID="draft-name" value={name} onChangeText={setName} />

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
  const { Pressable, Text } = require('react-native');

  const HoldingFormStub = ({ navigation }: { navigation: { goBack: () => void } }) => (
    <Pressable testID="save-holding" onPress={() => navigation.goBack()}>
      <Text>Save</Text>
    </Pressable>
  );

  return { __esModule: true, default: HoldingFormStub };
});

jest.mock('@kiko/screens/forms/account-form', () => {
  const { Text } = require('react-native');

  const AccountFormStub = () => <Text testID="account-form">Account form</Text>;

  return { __esModule: true, default: AccountFormStub };
});

const navigationRef = createNavigationContainerRef();

const routeNames = (): string[] =>
  navigationRef.getRootState()?.routes.map(({ name }) => name) ?? [];

const keyOf = (name: string): string | undefined =>
  navigationRef.getRootState()?.routes.find((route) => route.name === name)?.key;

const renderStack = async () => {
  const view = await render(
    <NavigationContainer ref={navigationRef}>
      <SettingsStack />
    </NavigationContainer>,
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return view;
};

describe('Settings stack — a template form with an empty picker', () => {
  it('opens the holding form from Add holding, and returns to the SAME form with its draft', async () => {
    const view = await renderStack();

    await fireEvent.press(view.getByTestId('open-template-form'));
    await fireEvent.changeText(view.getByTestId('draft-name'), 'Rent');

    const transactionFormKey = keyOf('TransactionForm');

    await fireEvent.press(view.getByTestId('add-holding'));

    expect(routeNames()).toEqual(['Settings', 'TransactionForm', 'HoldingForm']);

    await fireEvent.press(view.getByTestId('save-holding'));

    expect(routeNames()).toEqual(['Settings', 'TransactionForm']);
    expect(keyOf('TransactionForm')).toBe(transactionFormKey);
    expect(view.getByTestId('draft-name').props.value).toBe('Rent');
  });

  it('opens the account form when no account can hold the holding', async () => {
    const view = await renderStack();

    await fireEvent.press(view.getByTestId('open-template-form'));
    await act(async () => navigationRef.dispatch(CommonActions.navigate('AccountForm', {})));

    expect(routeNames()).toEqual(['Settings', 'TransactionForm', 'AccountForm']);
    expect(view.getByTestId('account-form')).toBeTruthy();
  });
});
