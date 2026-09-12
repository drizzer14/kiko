import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { match } from 'ts-pattern';

import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { isScreenshotMode } from '../../screenshot/screenshot-mode';
import type { AuthResult } from '../biometrics';
import { useAppLock } from '../use-app-lock';

import { styles } from './lock-gate.styles';

const LOCK_ICON_SIZE = 56;

const unlockHint = (
  result: AuthResult | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string =>
  match(result?.kind)
    .with(undefined, () => t('auth.hint.default'))
    .with('success', () => '')
    .with('cancelled', () => t('auth.hint.cancelled'))
    .with('lockout', () => t('auth.hint.lockout'))
    .with('passcodeNotSet', () => t('auth.hint.passcodeNotSet'))
    .with('failed', () => t('auth.hint.failed'))
    .exhaustive();

// With `allowDeviceCredentials` the same system sheet falls back to the passcode
// once biometry is locked out, so the retry action is the same call; only the
// label changes to tell the user what to expect.
const unlockLabel = (
  result: AuthResult | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string => (result?.kind === 'lockout' ? t('auth.usePasscode') : t('auth.unlock'));

/**
 * Mounted inside `MigrationsGate` (settings must be readable) and around the
 * navigator: while locked it replaces the whole app with a full-screen prompt
 * and runs the biometric/passcode sheet on mount and on every retry tap.
 * `Screen` is not used here on purpose — it reads the bottom tab bar height,
 * which only exists inside the tab navigator this gate wraps.
 *
 * SAFETY: the gate leans entirely on `useAppLock`, which is inert while
 * `APP_LOCK_ENABLED` is off (it reports `isReady: true, isLocked: false` and
 * never loads the native biometrics module). So on a build with the flag off
 * this is a pure pass-through that renders `children` and never prompts.
 */
const LockGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { isReady, isLocked, unlock } = useAppLock();
  const [lastResult, setLastResult] = useState<AuthResult | undefined>(undefined);

  const attemptUnlock = useCallback((): void => {
    unlock().then(setLastResult);
  }, [unlock]);

  useEffect(() => {
    if (!isLocked) {
      setLastResult(undefined);

      return;
    }

    // Screenshot mode ONLY: render the locked screen but do NOT auto-invoke the
    // biometric sheet on mount. The screenshot simulator has no enrolled
    // biometrics, so the system dialog would block Maestro from capturing the
    // lock screen (and a biometric Keychain read can SIGABRT there). The manual
    // Unlock button still calls `attemptUnlock`. `isScreenshotMode()` is inlined
    // `false` in every real build, so the production cold-launch prompt is
    // unchanged.
    if (isScreenshotMode()) {
      return;
    }

    attemptUnlock();
  }, [isLocked, attemptUnlock]);

  if (!isReady) {
    return <Box style={styles.fill} />;
  }

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView testID="lock-gate" style={styles.fill}>
      <Box padding={6} gap={4} style={styles.content}>
        <SymbolIcon name="faceid" size={LOCK_ICON_SIZE} tone="textSecondary" />

        <Text variant="title">{t('auth.locked')}</Text>

        <Text variant="body" tone="textSecondary" style={styles.hint}>
          {unlockHint(lastResult, t)}
        </Text>

        <Button onPress={attemptUnlock} fullWidth={false}>
          {unlockLabel(lastResult, t)}
        </Button>
      </Box>
    </SafeAreaView>
  );
};

export default LockGate;
