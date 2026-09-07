import { render } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import '../../design-system/unistyles';
import { asNavigationProp, asRouteProp, navigationSpy } from '../../test-support/navigation-props';

import SystemScreen from './system.screen';

type SystemProps = ComponentProps<typeof SystemScreen>;

// SystemScreen is a pushed screen; it reads neither navigation nor route, but
// both props are required by its type, so present the standard test spies.
const renderScreen = () =>
  render(
    <SystemScreen
      navigation={asNavigationProp<SystemProps['navigation']>(navigationSpy())}
      route={asRouteProp<SystemProps['route']>('System')}
    />,
  );

// APP_LOCK_ENABLED pinned OFF: the Face ID (App Lock) card is hidden, so a safe
// build without the biometrics pod shows no non-functional toggle. The
// visible-card path is covered in system.screen.test.tsx.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: false }));

const mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: false }];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setLanguage: jest.fn(),
    setLockEnabled: jest.fn(),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));

describe('SystemScreen App Lock gate (APP_LOCK_ENABLED off)', () => {
  it('hides the App Lock card while APP_LOCK_ENABLED is off', async () => {
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId('settings-card-app-lock')).toBeNull();
  });

  it('still renders the Language card regardless of the App Lock flag', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('settings-card-language')).toBeTruthy();
  });
});
