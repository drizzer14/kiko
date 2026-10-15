import { match, P } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import { SafeAreaView } from 'react-native-safe-area-context';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react';

import { useAppLock } from '../use-app-lock';
import type { AuthResult } from '../biometrics';

import { styles } from './lock-gate.styles';

const LOCK_ICON_SIZE = 56;

const unlockHint = (result: AuthResult | undefined, t: TFunction): string =>
  match<AuthResult['kind'] | undefined, string>(result?.kind)
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
const unlockLabel = (result: AuthResult | undefined, t: TFunction): string =>
  match<AuthResult['kind'] | undefined, string>(result?.kind)
    .with('lockout', () => t('auth.usePasscode'))
    .with(P.union(undefined, 'success', 'cancelled', 'passcodeNotSet', 'failed'), () =>
      t('auth.unlock'),
    )
    .exhaustive();

/**
 * Mounted inside `MigrationsGate` (settings must be readable) and around the
 * navigator: while locked it renders a full-screen prompt in place of the whole
 * app and runs the biometric/passcode sheet on mount and on every retry tap.
 * `Screen` is not used here on purpose — it reads the bottom tab bar height,
 * which only exists inside the tab navigator this gate wraps.
 */
const LockGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const { isReady, isLocked, unlock } = useAppLock();
  const [lastResult, setLastResult] = useState<AuthResult | undefined>(undefined);

  const attemptUnlock = useCallback((): void => {
    // authenticate() never rejects; a failure resolves as the `failed` result.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
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
