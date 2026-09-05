import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { match } from 'ts-pattern';

import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import type { AuthResult } from '../biometrics';
import { useAppLock } from '../use-app-lock';

import { styles } from './lock-gate.styles';

const LOCK_ICON_SIZE = 56;

const unlockHint = (result: AuthResult | undefined): string =>
  match(result?.kind)
    .with(undefined, () => 'Unlock with Face ID or your device passcode.')
    .with('success', () => '')
    .with('cancelled', () => 'Authentication was cancelled.')
    .with('lockout', () => 'Face ID is locked. Use your device passcode instead.')
    .with('passcodeNotSet', () => 'Set a device passcode to unlock Kiko.')
    .with('failed', () => 'Authentication failed. Try again.')
    .exhaustive();

// With `allowDeviceCredentials` the same system sheet falls back to the passcode
// once biometry is locked out, so the retry action is the same call; only the
// label changes to tell the user what to expect.
const unlockLabel = (result: AuthResult | undefined): string =>
  result?.kind === 'lockout' ? 'Use Passcode' : 'Unlock';

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
        <SymbolIcon name="lock.fill" size={LOCK_ICON_SIZE} tone="textSecondary" />

        <Text variant="title">Locked</Text>

        <Text variant="body" tone="textSecondary" style={styles.hint}>
          {unlockHint(lastResult)}
        </Text>

        <Button onPress={attemptUnlock} fullWidth={false}>
          {unlockLabel(lastResult)}
        </Button>
      </Box>
    </SafeAreaView>
  );
};

export default LockGate;
