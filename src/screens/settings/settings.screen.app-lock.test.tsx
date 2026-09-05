import { fireEvent, render } from '@testing-library/react-native';
import '../../design-system/unistyles';

import SettingsScreen from './settings.screen';

// APP_LOCK_ENABLED flipped ON: the App Lock card mounts. The default-off path
// (card hidden) is covered in settings.screen.test.tsx.
jest.mock('../../db/db-config', () => ({ APP_LOCK_ENABLED: true }));

const mockSetLockEnabled = jest.fn();
type SettingsRow = { baseCurrency: string; lockEnabled: boolean };
let mockLiveQueryData: SettingsRow[] = [{ baseCurrency: 'UAH', lockEnabled: false }];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: jest.fn(),
    setLockEnabled: (...args: unknown[]) => mockSetLockEnabled(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData }),
}));
// The active-tab re-tap → scroll-to-top hook reads the navigation context a
// standalone render lacks; stub it out (its own wiring is covered elsewhere).
jest.mock('../../navigation/use-scroll-to-top-on-tab-press', () => ({
  useScrollToTopOnTabPress: () => undefined,
}));

describe('SettingsScreen App Lock card (APP_LOCK_ENABLED on)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLiveQueryData = [{ baseCurrency: 'UAH', lockEnabled: false }];
  });

  it('renders the App Lock setting in its own card', async () => {
    const { getByTestId } = await render(<SettingsScreen />);
    expect(getByTestId('settings-card-app-lock')).toBeTruthy();
  });

  it('calls setLockEnabled when the App Lock switch is toggled', async () => {
    const { findByRole } = await render(<SettingsScreen />);

    await fireEvent(await findByRole('switch'), 'valueChange', true);

    expect(mockSetLockEnabled).toHaveBeenCalledWith(true);
  });
});
