import { render } from '@testing-library/react-native';
import '../../design-system/unistyles';

import SystemScreen from './system.screen';

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
    const { queryByTestId } = await render(<SystemScreen />);
    expect(queryByTestId('settings-card-app-lock')).toBeNull();
  });

  it('still renders the Language card regardless of the App Lock flag', async () => {
    const { getByTestId } = await render(<SystemScreen />);
    expect(getByTestId('settings-card-language')).toBeTruthy();
  });
});
