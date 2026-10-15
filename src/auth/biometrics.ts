import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import either, { bifold, isLeft } from 'fnts/either';
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
  // A passcode is set but biometry isn't usable: the lock still works, through
  // the passcode sheet (`allowDeviceCredentials`). `notEnrolled` means the
  // user never set up biometry; `biometryUnavailable` means a secure device
  // whose biometry is off/locked out for another reason (denied permission,
  // a temporary lockout) — different hint copy, same fallback.
  | { kind: 'passcodeOnly'; reason: 'notEnrolled' | 'biometryUnavailable' }
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

// Shared between a native REJECTION (the real iOS shape) and a resolved
// `success: false` result, so both classify identically off the same code.
const classifyCode = (code: string | undefined): AuthResult => {
  if (hasCode(CANCEL_CODES, code)) {
    return { kind: 'cancelled' };
  }

  if (hasCode(LOCKOUT_CODES, code)) {
    return { kind: 'lockout' };
  }

  if (code === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  return { kind: 'failed', code };
};

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

  // Left `unknown`, not the native `BiometricSensorInfo` type: LockGate's
  // caller depends on this function never throwing, and the type only
  // describes what the native module PROMISES to resolve, not what a
  // malformed build actually hands back — the same defensive stance as
  // `thrownCode` below takes for a caught rejection.
  const info: unknown = bifold(result);

  if (typeof info !== 'object' || info === null) {
    return { kind: 'unavailable' };
  }

  const sensor = info as ReactNativeBiometrics.BiometricSensorInfo;

  if (sensor.available) {
    return { kind: 'available', biometryType: sensor.biometryType };
  }

  if (sensor.isDeviceSecure === false || sensor.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  if (hasCode(NOT_ENROLLED_CODES, sensor.errorCode)) {
    return { kind: 'passcodeOnly', reason: 'notEnrolled' };
  }

  if (sensor.isDeviceSecure === true) {
    return { kind: 'passcodeOnly', reason: 'biometryUnavailable' };
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
      cancelLabel: i18n.t('common.cancel'),
      fallbackLabel: i18n.t('auth.usePasscode'),
    }),
  );

  if (isLeft(result)) {
    const classified = classifyCode(thrownCode(bifold(result)));

    if (classified.kind !== 'failed') {
      return classified;
    }

    // A native rejection classified as an unspecific `failed` may really mean
    // the passcode was just removed — the sensor query disambiguates the two,
    // since a plain "authentication failed" carries no such distinction of
    // its own.
    const sensorStatus = await isSensorAvailable();

    return match(sensorStatus)
      .returnType<AuthResult>()
      .with({ kind: 'passcodeNotSet' }, () => ({ kind: 'passcodeNotSet' }))
      .with({ kind: P.union('available', 'passcodeOnly', 'unavailable') }, () => classified)
      .exhaustive();
  }

  // Same annotation gotcha as `isSensorAvailable`'s `info`.
  const authResult: ReactNativeBiometrics.BiometricAuthResult = bifold(result);

  if (authResult.success) {
    return { kind: 'success' };
  }

  return classifyCode(authResult.errorCode);
};
