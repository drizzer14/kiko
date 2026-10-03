import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import type { AccountsStackParamList } from '../types';

import AccountsStack from './accounts.stack';

/**
 * The swap between the account form and the implicit holding form is a router
 * property a `navigationSpy` cannot see: `replace` must keep the stack one
 * screen deep, so Back from the holding form leaves the flow instead of landing
 * on a stale account form. This suite renders the REAL stack with the REAL
 * `AccountFormScreen` and `HoldingFormScreen`, and mocks only the data layer
 * and the Accounts root (which is its own screen's concern).
 */

const mockCreateImplicitHolding = jest.fn();
const mockSetIcon = jest.fn();

jest.mock('@kiko/screens/accounts', () => {
  const { Text } = require('react-native');

  const AccountsScreenStub = () => <Text testID="accounts-screen">Accounts</Text>;

  return { __esModule: true, default: AccountsScreenStub };
});
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: () => ({ data: [], isLoading: false }),
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    createImplicitHolding: (...args: unknown[]) => mockCreateImplicitHolding(...args),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    byIdQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setIcon: (...args: unknown[]) => mockSetIcon(...args),
  },
}));
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

const routeNames = (): string[] =>
  (navigationRef.getRootState()?.routes ?? []).map((route) => route.name);

const renderStack = async () => {
  const view = await render(
    <NavigationContainer ref={navigationRef}>
      <AccountsStack />
    </NavigationContainer>,
  );

  await waitFor(() => expect(navigationRef.isReady()).toBe(true));

  return view;
};

const openAddAccount = async (): Promise<void> => {
  await act(async () => navigationRef.navigate('AccountForm', {}));
};

const goBack = async (): Promise<void> => {
  await act(async () => navigationRef.goBack());
};

type View = Awaited<ReturnType<typeof renderStack>>;

const pickKind = async (view: View, kind: string): Promise<void> => {
  await fireEvent.press(view.getByTestId('account-kind-field'));
  const sheet = view.getByTestId('account-kind-field-sheet-modal');
  await fireEvent.press(view.getByTestId(`account-kind-field-option-${kind}`));
  // The sheet's close animation ending, which is when the swap navigates.
  await act(async () => sheet.props.onDismiss());
};

describe('AccountsStack — swapping between the account form and the implicit holding form', () => {
  beforeEach(() => {
    mockCreateImplicitHolding.mockResolvedValue({
      accountId: 'implicit-account-id',
      holdingId: 'new-holding-id',
    });
    mockSetIcon.mockResolvedValue(undefined);
  });

  it('opens the account form above the Accounts root', async () => {
    const view = await renderStack();

    await openAddAccount();

    expect(view.getByTestId('account-form')).toBeTruthy();
    expect(routeNames()).toEqual(['Accounts', 'AccountForm']);
  });

  it('replaces the account form with the property form, so the stack stays two deep', async () => {
    const view = await renderStack();

    await openAddAccount();
    await pickKind(view, 'property');

    expect(view.getByTestId('holding-form')).toBeTruthy();
    expect(view.queryByTestId('account-form')).toBeNull();
    expect(routeNames()).toEqual(['Accounts', 'HoldingForm']);
  });

  it('leaves the flow on Back from the swapped form, not landing on a stale account form', async () => {
    const view = await renderStack();

    await openAddAccount();
    await pickKind(view, 'property');
    await goBack();

    expect(routeNames()).toEqual(['Accounts']);
    expect(view.getByTestId('accounts-screen')).toBeTruthy();
    expect(view.queryByTestId('account-form')).toBeNull();
    expect(view.queryByTestId('holding-form')).toBeNull();
  });

  // native-stack pops a screen with the animation that screen carries when it is
  // popped (react-native-screens `RNSScreenStack animationControllerForOperation`
  // reads `fromVC.screenView.stackAnimation`), so a route that swapped in with
  // 'none' would also leave with none.
  describe('the animation of a swapped-in screen', () => {
    // The native screens that carry an animation, in stack order: the Accounts
    // root sets none, so these are the form screens.
    const stackAnimations = (view: View): unknown[] =>
      view.container
        .queryAll((node) => node.props.stackAnimation !== undefined)
        .map((node) => node.props.stackAnimation);

    // The native stack reports a screen as shown with its `onAppear`, which it
    // calls whatever the animation was.
    const appear = async (view: View): Promise<void> => {
      const screens = view.container.queryAll((node) => node.props.stackAnimation !== undefined);

      await act(async () => screens.at(-1)?.props.onAppear());
    };

    it('swaps in the holding form with no animation, then restores the default so Back animates', async () => {
      const view = await renderStack();

      await openAddAccount();
      await pickKind(view, 'property');

      expect(stackAnimations(view)).toEqual(['none']);

      await appear(view);

      expect(stackAnimations(view)).toEqual(['default']);
    });

    it('swaps back to the account form with no animation, then restores the default', async () => {
      const view = await renderStack();

      await openAddAccount();
      await pickKind(view, 'property');
      await appear(view);
      await pickKind(view, 'cash');

      expect(stackAnimations(view)).toEqual(['none']);

      await appear(view);

      expect(stackAnimations(view)).toEqual(['default']);
    });

    it('keeps a form opened from the Accounts screen on the default animation', async () => {
      const view = await renderStack();

      await openAddAccount();
      await appear(view);

      expect(stackAnimations(view)).toEqual(['default']);
    });
  });

  it('leaves the flow on Back after swapping there and back again', async () => {
    const view = await renderStack();

    await openAddAccount();
    await pickKind(view, 'debt');
    await pickKind(view, 'cash');

    expect(view.getByTestId('account-form')).toBeTruthy();
    expect(routeNames()).toEqual(['Accounts', 'AccountForm']);

    await goBack();

    expect(routeNames()).toEqual(['Accounts']);
  });

  it('carries the typed name across the swap in both directions', async () => {
    const view = await renderStack();

    await openAddAccount();
    await fireEvent.changeText(view.getByLabelText('Name'), 'Family flat');
    await pickKind(view, 'property');

    expect(view.getByLabelText('Name').props.value).toBe('Family flat');
    expect(view.getByTestId('account-kind-field')).toHaveTextContent('Property');

    await pickKind(view, 'crypto');

    expect(view.getByTestId('account-form')).toBeTruthy();
    expect(view.getByLabelText('Name').props.value).toBe('Family flat');
    expect(view.getByTestId('account-kind-field')).toHaveTextContent('Crypto');
  });

  it('carries the picked icon across the swap', async () => {
    const view = await renderStack();

    await openAddAccount();
    await fireEvent.press(view.getByLabelText('Change Icon'));
    await fireEvent.press(view.getByLabelText('Choose icon giftcard'));
    await pickKind(view, 'debt');

    expect(view.getByLabelText('Icon giftcard')).toBeTruthy();
  });

  it('turns the property form into the loan form in place', async () => {
    const view = await renderStack();

    await openAddAccount();
    await pickKind(view, 'property');
    await pickKind(view, 'debt');

    expect(routeNames()).toEqual(['Accounts', 'HoldingForm']);
    expect(view.getByTestId('account-kind-field')).toHaveTextContent('Debt');
    expect(view.getByLabelText('Principal')).toBeTruthy();
    expect(view.queryByTestId('property-category-field')).toBeNull();
  });

  it('saves the property through the one implicit write and returns to the Accounts root', async () => {
    const view = await renderStack();

    await openAddAccount();
    await fireEvent.changeText(view.getByLabelText('Name'), 'Family flat');
    await pickKind(view, 'property');
    await fireEvent.changeText(view.getByLabelText('Cost'), '5000');
    await fireEvent.press(view.getByText('Save'));

    expect(mockCreateImplicitHolding).toHaveBeenCalledTimes(1);
    expect(mockCreateImplicitHolding).toHaveBeenCalledWith(
      'property',
      expect.objectContaining({ name: 'Family flat', type: 'property_item' }),
    );
    await waitFor(() => expect(routeNames()).toEqual(['Accounts']));
    expect(view.getByTestId('accounts-screen')).toBeTruthy();
  });
});
