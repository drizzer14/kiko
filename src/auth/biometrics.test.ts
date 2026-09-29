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

  it('maps a secured device with no enrolled biometry to passcodeOnly/notEnrolled', async () => {
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: true,
      errorCode: 'BIOMETRY_NOT_ENROLLED',
    });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeOnly', reason: 'notEnrolled' });
  });

  it.each(['BIOMETRY_NOT_AVAILABLE', 'BIOMETRY_LOCKOUT'])(
    'maps %s on a secure device to passcodeOnly/biometryUnavailable, never a greyed-out switch',
    async (errorCode) => {
      mockSensor.mockResolvedValue({ available: false, isDeviceSecure: true, errorCode });

      expect(await isSensorAvailable()).toEqual({
        kind: 'passcodeOnly',
        reason: 'biometryUnavailable',
      });
    },
  );

  it('maps an unrecognized code with no confirmed device security to unavailable', async () => {
    mockSensor.mockResolvedValue({ available: false, errorCode: 'BIOMETRY_NOT_AVAILABLE' });

    expect(await isSensorAvailable()).toEqual({ kind: 'unavailable' });
  });

  it('resolves to unavailable when the native module rejects, instead of rejecting itself', async () => {
    mockSensor.mockRejectedValueOnce(new Error('boom'));

    expect(await isSensorAvailable()).toEqual({ kind: 'unavailable' });
  });

  it('resolves to unavailable instead of throwing when the native module resolves a non-object value', async () => {
    mockSensor.mockResolvedValueOnce(undefined);

    expect(await isSensorAvailable()).toEqual({ kind: 'unavailable' });
  });
});

describe('authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // A `failed`-classified rejection falls through to a sensor query (see
    // `authenticate`'s own doc comment) — give it a default so a test run in
    // isolation (`-t`) never depends on a resolved value some earlier test in
    // this file happened to leave on the mock.
    mockSensor.mockResolvedValue({ available: true, biometryType: 'FaceID', isDeviceSecure: true });
  });

  it('always allows the device passcode as a fallback and titles the sheet with the prompt', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });

    await authenticate('Unlock Kiko');

    expect(mockAuthenticate).toHaveBeenCalledWith({
      title: 'Unlock Kiko',
      allowDeviceCredentials: true,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use passcode',
    });
  });

  it('maps success', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'success' });
  });

  it.each([
    ['USER_CANCEL', 'cancelled'],
    ['SYSTEM_CANCEL', 'cancelled'],
    ['USER_FALLBACK', 'cancelled'],
    ['BIOMETRY_LOCKOUT', 'lockout'],
    ['FACE_ID_LOCKOUT', 'lockout'],
    ['PASSCODE_NOT_SET', 'passcodeNotSet'],
  ])('classifies a native rejection with code %s as %s', async (code, kind) => {
    mockAuthenticate.mockRejectedValue(Object.assign(new Error(code), { code }));

    expect((await authenticate('Unlock Kiko')).kind).toBe(kind);
  });

  it('reports passcodeNotSet when the passcode was removed (BIOMETRY_NOT_AVAILABLE + insecure device)', async () => {
    mockAuthenticate.mockRejectedValue(
      Object.assign(new Error(), { code: 'BIOMETRY_NOT_AVAILABLE' }),
    );
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: false,
      errorCode: 'BIOMETRY_NOT_AVAILABLE',
    });

    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'passcodeNotSet' });
  });

  it('keeps failed for BIOMETRY_NOT_AVAILABLE on a secure device', async () => {
    mockAuthenticate.mockRejectedValue(
      Object.assign(new Error(), { code: 'BIOMETRY_NOT_AVAILABLE' }),
    );
    mockSensor.mockResolvedValue({
      available: false,
      isDeviceSecure: true,
      errorCode: 'BIOMETRY_NOT_AVAILABLE',
    });

    expect(await authenticate('Unlock Kiko')).toEqual({
      kind: 'failed',
      code: 'BIOMETRY_NOT_AVAILABLE',
    });
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

  it('resolves to failed with the thrown error code when the native module rejects, instead of rejecting itself', async () => {
    mockAuthenticate.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'SYSTEM_ERROR' }),
    );

    await expect(authenticate('Unlock Kiko')).resolves.toEqual({
      kind: 'failed',
      code: 'SYSTEM_ERROR',
    });
  });

  it('resolves to failed with an undefined code when the thrown error carries none', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('boom'));

    await expect(authenticate('Unlock Kiko')).resolves.toEqual({
      kind: 'failed',
      code: undefined,
    });
  });
});

describe('authenticate when the native module fails to load entirely', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('resolves to failed instead of throwing when require() itself throws (missing pod)', async () => {
    // `./biometrics` and its native dependency are already cached from this
    // file's top-level static import, so `jest.doMock` alone would not affect
    // a `require` below — reset the module registry first to force a fresh
    // evaluation that actually picks up the throwing factory.
    jest.resetModules();
    jest.doMock('@sbaiahmed1/react-native-biometrics', () => {
      throw new Error("Cannot find module '@sbaiahmed1/react-native-biometrics'");
    });

    const { authenticate: freshAuthenticate } = require('./biometrics');

    await expect(freshAuthenticate('Unlock Kiko')).resolves.toEqual({
      kind: 'failed',
      code: undefined,
    });
  });
});
