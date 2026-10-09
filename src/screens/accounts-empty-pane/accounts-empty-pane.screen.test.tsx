import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import AccountsEmptyPaneScreen from './accounts-empty-pane.screen';

type Props = ComponentProps<typeof AccountsEmptyPaneScreen>;

const navigation = navigationSpy();

const renderScreen = () =>
  render(
    <AccountsEmptyPaneScreen
      navigation={asNavigationProp<Props['navigation']>(navigation)}
      route={asRouteProp<Props['route']>('AccountsEmptyPane')}
    />,
  );

describe('AccountsEmptyPaneScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('says there are no accounts yet, with the shared empty state', async () => {
    const { getByTestId, getByText } = await renderScreen();

    expect(getByTestId('accounts-empty-pane')).toBeTruthy();
    expect(getByText(i18n.t('accounts.empty.title'))).toBeTruthy();
    expect(getByText(i18n.t('accounts.empty.message'))).toBeTruthy();
  });

  it('opens the account form from its Add account action', async () => {
    const { getByTestId, getByText } = await renderScreen();

    expect(getByText(i18n.t('accounts.addAccount'))).toBeTruthy();

    await fireEvent.press(getByTestId('accounts-empty-pane-action'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('AccountForm', {});
  });
});
