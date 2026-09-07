import { isSensorAvailable } from '@sbaiahmed1/react-native-biometrics';
import { render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import '../../../i18n';

import AppLockSetting from './app-lock-setting.component';

// T-15 regression: proves the fix end to end, through the REAL
// `../../../auth/biometrics.isSensorAvailable` (only the native module itself
// is mocked, unlike `app-lock-setting.component.test.tsx`, which mocks the
// wrapper directly). `AppLockSetting`'s `isSensorAvailable().then(...)`
// (app-lock-setting.component.tsx) has no `.catch` by design — the wrapper is
// a TOTAL function that folds a native rejection into `{ kind: 'unavailable' }`
// rather than rejecting, so the switch must stay disabled WITH a hint instead
// of silently disabled with none.
const mockIsSensorAvailable = isSensorAvailable as jest.Mock;

const renderSetting = () => render(<AppLockSetting lockEnabled={false} onToggle={jest.fn()} />);

describe('AppLockSetting with a rejecting native module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables the switch with the unavailable hint instead of staying silently disabled', async () => {
    mockIsSensorAvailable.mockRejectedValueOnce(new Error('boom'));

    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeDisabled();
    expect(await findByText('Biometric hardware is unavailable on this device.')).toBeTruthy();
  });
});
