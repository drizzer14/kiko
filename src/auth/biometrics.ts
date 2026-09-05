import type * as ReactNativeBiometrics from '@sbaiahmed1/react-native-biometrics';

/**
 * Lazily resolves the native biometrics module. `@sbaiahmed1/react-native-biometrics`
 * resolves its TurboModule with `TurboModuleRegistry.getEnforcing('ReactNativeBiometrics')`
 * at module load, which THROWS (and crashes the app) on a build where its pod is
 * not installed. Requiring it here — only from inside the two functions below,
 * which run solely when the app lock is enabled — keeps that off the launch and
 * import path, so merely importing this wrapper never loads the native module.
 */
const loadNativeBiometrics = (): typeof ReactNativeBiometrics =>
  require('@sbaiahmed1/react-native-biometrics');

// Consumed by the settings App Lock card (`AppLockSetting`), which maps each
// kind to a switch-availability decision and a hint string.
export type SensorStatus =
  | { kind: 'available'; biometryType: string | undefined }
  // A passcode is set but no biometry is enrolled: the lock still works, through
  // the passcode sheet (`allowDeviceCredentials`).
  | { kind: 'passcodeOnly' }
  | { kind: 'passcodeNotSet' }
  | { kind: 'unavailable' };

export type AuthResult =
  | { kind: 'success' }
  | { kind: 'cancelled' }
  | { kind: 'lockout' }
  | { kind: 'passcodeNotSet' }
  | { kind: 'failed'; code: string | undefined };

// iOS LAError codes as surfaced by @sbaiahmed1/react-native-biometrics, grouped
// by how the gate reacts.
const CANCEL_CODES = ['USER_CANCEL', 'SYSTEM_CANCEL', 'USER_FALLBACK'] as const;
const LOCKOUT_CODES = [
  'BIOMETRY_LOCKOUT',
  'BIOMETRY_LOCKOUT_PERMANENT',
  'FACE_ID_LOCKOUT',
  'TOUCH_ID_LOCKOUT',
] as const;
const NOT_ENROLLED_CODES = [
  'BIOMETRY_NOT_ENROLLED',
  'FACE_ID_NOT_ENROLLED',
  'TOUCH_ID_NOT_ENROLLED',
] as const;
const PASSCODE_NOT_SET_CODE = 'PASSCODE_NOT_SET';

const hasCode = (codes: readonly string[], code: string | undefined): boolean =>
  code !== undefined && codes.includes(code);

export const isSensorAvailable = async (): Promise<SensorStatus> => {
  const info = await loadNativeBiometrics().isSensorAvailable();

  if (info.available) {
    return { kind: 'available', biometryType: info.biometryType };
  }

  if (info.isDeviceSecure === false || info.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  if (hasCode(NOT_ENROLLED_CODES, info.errorCode)) {
    return { kind: 'passcodeOnly' };
  }

  return { kind: 'unavailable' };
};

/**
 * One system authentication sheet: biometrics first, device passcode as the
 * fallback (`allowDeviceCredentials`), so a biometry lockout or an unenrolled
 * device degrades to the passcode instead of a dead end.
 */
export const authenticate = async (prompt: string): Promise<AuthResult> => {
  const result = await loadNativeBiometrics().authenticateWithOptions({
    title: prompt,
    allowDeviceCredentials: true,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
  });

  if (result.success) {
    return { kind: 'success' };
  }

  if (hasCode(CANCEL_CODES, result.errorCode)) {
    return { kind: 'cancelled' };
  }

  if (hasCode(LOCKOUT_CODES, result.errorCode)) {
    return { kind: 'lockout' };
  }

  if (result.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  return { kind: 'failed', code: result.errorCode };
};
