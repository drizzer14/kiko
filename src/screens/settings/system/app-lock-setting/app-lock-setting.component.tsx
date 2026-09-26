import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useState } from 'react';

import SettingsRow from '../../settings-row';
import Card from '../../../../design-system/components/card';
import Text from '../../../../design-system/components/text';
import Switch from '../../../../design-system/components/switch';
import { isSensorAvailable, type SensorStatus } from '../../../../auth/biometrics';

import type { AppLockSettingProps } from './app-lock-setting.props';

// A pure helper (no hook access), so the translator function is threaded in
// from the component's own `useTranslation()` rather than called globally.
const sensorHint = (status: SensorStatus | undefined, t: TFunction): string | undefined =>
  match(status?.kind)
    .with(undefined, () => undefined)
    .with('available', () => undefined)
    .with('passcodeOnly', () => t('settings.appLock.hint.passcodeOnly'))
    .with('passcodeNotSet', () => t('settings.appLock.hint.passcodeNotSet'))
    .with('unavailable', () => t('settings.appLock.hint.unavailable'))
    .exhaustive();

// The lock can be offered whenever the system sheet has something to ask for:
// biometrics, or (passcodeOnly) the device passcode. A device with no passcode
// gets a disabled switch and a hint instead of a lock that would fail at runtime.
const canOfferLock = (status: SensorStatus | undefined): boolean =>
  match(status?.kind)
    .with('available', 'passcodeOnly', () => true)
    .with(undefined, 'passcodeNotSet', 'unavailable', () => false)
    .exhaustive();

/**
 * The Settings App Lock card: a labeled switch that enables/disables the
 * biometric lock, plus a sensor-status hint. The lock is asked for only on a
 * fresh app open, so there is nothing else to configure.
 */
const AppLockSetting: FC<AppLockSettingProps> = ({ lockEnabled, onToggle }) => {
  const { t } = useTranslation();
  const [sensorStatus, setSensorStatus] = useState<SensorStatus | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) isSensorAvailable never rejects; a failure resolves as `unavailable`
    isSensorAvailable().then((status) => {
      if (alive) {
        setSensorStatus(status);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const hint = sensorHint(sensorStatus, t);
  const lockAvailable = canOfferLock(sensorStatus);

  return (
    <Card testID="settings-card-app-lock" padding={3}>
      <SettingsRow testID="settings-row-app-lock" icon="faceid" label={t('settings.appLock.label')}>
        <Switch
          testID="settings-switch-app-lock"
          value={lockEnabled}
          onValueChange={onToggle}
          disabled={!lockAvailable}
          label={t('settings.appLock.requireFaceIdOrPasscode')}
        />

        {hint !== undefined && (
          <Text variant="caption" tone="textSecondary">
            {hint}
          </Text>
        )}
      </SettingsRow>
    </Card>
  );
};

export default AppLockSetting;
