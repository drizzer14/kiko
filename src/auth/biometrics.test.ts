import {
  authenticateWithOptions,
  isSensorAvailable as nativeIsSensorAvailable,
} from '@sbaiahmed1/react-native-biometrics';

import { authenticate, isSensorAvailable } from './biometrics';

jest.mock('@sbaiahmed1/react-native-biometrics', () => ({
  isSensorAvailable: jest.fn(),
  authenticateWithOptions: jest.fn(),
}));

const mockSensor = nativeIsSensorAvailable as jest.Mock;
const mockAuthenticate = authenticateWithOptions as jest.Mock;

describe('isSensorAvailable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps an available sensor with its biometry type', async () => {
    mockSensor.mockResolvedValue({ available: true, biometryType: 'FaceID', isDeviceSecure: true });

    expect(await isSensorAvailable()).toEqual({ kind: 'available', biometryType: 'FaceID' });
  });

  it('maps a device with no passcode to passcodeNotSet', async () => {
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: false,
      errorCode: 'PASSCODE_NOT_SET',
    });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeNotSet' });
  });

  it('treats a missing isDeviceSecure flag with PASSCODE_NOT_SET as passcodeNotSet', async () => {
    mockSensor.mockResolvedValue({ available: false, errorCode: 'PASSCODE_NOT_SET' });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeNotSet' });
  });

  it('maps a secured device with no enrolled biometry to passcodeOnly', async () => {
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: true,
      errorCode: 'BIOMETRY_NOT_ENROLLED',
    });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeOnly' });
  });

  it('maps missing biometric hardware to unavailable', async () => {
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: true,
      errorCode: 'BIOMETRY_NOT_AVAILABLE',
    });

    expect(await isSensorAvailable()).toEqual({ kind: 'unavailable' });
  });
});

describe('authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('always allows the device passcode as a fallback and titles the sheet with the prompt', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });

    await authenticate('Unlock Kiko');

    expect(mockAuthenticate).toHaveBeenCalledWith({
      title: 'Unlock Kiko',
      allowDeviceCredentials: true,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
    });
  });

  it('maps success', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'success' });
  });

  it.each(['USER_CANCEL', 'SYSTEM_CANCEL', 'USER_FALLBACK'])(
    'maps %s to cancelled',
    async (errorCode) => {
      mockAuthenticate.mockResolvedValue({ success: false, errorCode });

      expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'cancelled' });
    },
  );

  it.each([
    'BIOMETRY_LOCKOUT',
    'BIOMETRY_LOCKOUT_PERMANENT',
    'FACE_ID_LOCKOUT',
    'TOUCH_ID_LOCKOUT',
  ])('maps %s to lockout', async (errorCode) => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'lockout' });
  });

  it('maps PASSCODE_NOT_SET', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode: 'PASSCODE_NOT_SET' });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'passcodeNotSet' });
  });

  it('maps any other failure to failed with its code', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode: 'AUTHENTICATION_FAILED' });

    expect(await authenticate('Unlock Kiko')).toEqual({
      kind: 'failed',
      code: 'AUTHENTICATION_FAILED',
    });
  });

  it('maps a failure without a code to failed with undefined', async () => {
    mockAuthenticate.mockResolvedValue({ success: false });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'failed', code: undefined });
  });
});
