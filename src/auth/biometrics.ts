import type * as ReactNativeBiometrics from '@sbaiahmed1/react-native-biometrics';
import either, { bifold, isLeft } from 'fnts/either';

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

// A caught value from `either`'s left channel: either the native module's own
// rejection (which may carry `code` or `errorCode`) or the plain `Error` a
// missing-pod `require` throws (which carries neither). Read defensively —
// this is untyped, thrown data, not a contract the native module documents.
const thrownCode = (caught: unknown): string | undefined => {
  if (typeof caught !== 'object' || caught === null) {
    return undefined;
  }

  const record = caught as { code?: unknown; errorCode?: unknown };
  const code = record.code ?? record.errorCode;

  return typeof code === 'string' ? code : undefined;
};

/**
 * Whether the device can authenticate, as a TOTAL function — it never
 * rejects.
 *
 * The native module rethrows its own rejections, and `loadNativeBiometrics`'
 * `require` throws outright on a build whose pod is not installed. An
 * unhandled rejection here left the Settings switch permanently disabled with
 * no hint. A throw is indistinguishable from "no usable sensor" from the UI's
 * point of view, so it folds into the existing `unavailable` member rather
 * than adding a new one — every `match(...).exhaustive()` caller stays
 * unchanged and may `.then(...)` this function's result without a rejection
 * handler.
 *
 * The lambda passed to `either` is itself `async`: `loadNativeBiometrics()`
 * can throw SYNCHRONOUSLY (the missing-pod `require`), and `either` only
 * catches a REJECTED promise, not a synchronous throw from a plain callback —
 * wrapping the call in `async` converts that synchronous throw into a
 * rejection first, so `either` sees it.
 */
export const isSensorAvailable = async (): Promise<SensorStatus> => {
  const result = await either<unknown, ReactNativeBiometrics.BiometricSensorInfo>(async () =>
    loadNativeBiometrics().isSensorAvailable(),
  );

  if (isLeft(result)) {
    return { kind: 'unavailable' };
  }

  // Annotated explicitly: `bifold` on a narrowed `Right` still leaves nothing
  // for TypeScript to infer `LeftValue` from, and silently resolves to
  // `unknown` without this.
  const info: ReactNativeBiometrics.BiometricSensorInfo = bifold(result);

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
 *
 * A TOTAL function — it never rejects; see `isSensorAvailable`'s doc for why
 * the wrapped lambda is itself `async`. A rejection or a missing-pod `require`
 * throw folds into the existing `failed` member (carrying the thrown value's
 * own `code`/`errorCode` when it has one), so `LockGate`'s
 * `unlock().then(setLastResult)` may stay a bare `.then` with no `.catch`.
 */
export const authenticate = async (prompt: string): Promise<AuthResult> => {
  const result = await either<unknown, ReactNativeBiometrics.BiometricAuthResult>(async () =>
    loadNativeBiometrics().authenticateWithOptions({
      title: prompt,
      allowDeviceCredentials: true,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
    }),
  );

  if (isLeft(result)) {
    return { kind: 'failed', code: thrownCode(bifold(result)) };
  }

  // Same annotation gotcha as `isSensorAvailable`'s `info`.
  const authResult: ReactNativeBiometrics.BiometricAuthResult = bifold(result);

  if (authResult.success) {
    return { kind: 'success' };
  }

  if (hasCode(CANCEL_CODES, authResult.errorCode)) {
    return { kind: 'cancelled' };
  }

  if (hasCode(LOCKOUT_CODES, authResult.errorCode)) {
    return { kind: 'lockout' };
  }

  if (authResult.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  return { kind: 'failed', code: authResult.errorCode };
};
