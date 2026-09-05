import { type FC, useEffect, useState } from 'react';
import { match } from 'ts-pattern';

import { isSensorAvailable, type SensorStatus } from '../../../auth/biometrics';
import GlassSurface from '../../../design-system/components/glass-surface';
import Switch from '../../../design-system/components/switch';
import Text from '../../../design-system/components/text';
import SettingsRow from '../settings-row';

import type { AppLockSettingProps } from './app-lock-setting.props';

const sensorHint = (status: SensorStatus | undefined): string | undefined =>
  match(status?.kind)
    .with(undefined, () => undefined)
    .with('available', () => undefined)
    .with('passcodeOnly', () => 'No Face ID enrolled — your device passcode will be used.')
    .with('passcodeNotSet', () => 'Set a device passcode in iOS Settings to use App Lock.')
    .with('unavailable', () => 'Biometric hardware is unavailable on this device.')
    .exhaustive();

// The lock can be offered whenever the system sheet has something to ask for:
// biometrics, or (passcodeOnly) the device passcode. A device with no passcode
// gets a disabled switch and a hint instead of a lock that would fail at runtime.
const canOfferLock = (status: SensorStatus | undefined): boolean =>
  status?.kind === 'available' || status?.kind === 'passcodeOnly';

/**
 * The Settings App Lock card: a labeled switch that enables/disables the
 * biometric lock, plus a sensor-status hint. The lock is asked for only on a
 * fresh app open, so there is nothing else to configure. The screen mounts this
 * card only when `APP_LOCK_ENABLED` is on, so a safe build with the flag off
 * shows no non-functional toggle.
 */
const AppLockSetting: FC<AppLockSettingProps> = ({ lockEnabled, onToggle }) => {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    isSensorAvailable().then((status) => {
      if (alive) {
        setSensorStatus(status);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const hint = sensorHint(sensorStatus);
  const lockAvailable = canOfferLock(sensorStatus);

  return (
    <GlassSurface testID="settings-card-app-lock" padding={3}>
      <SettingsRow testID="settings-row-app-lock" icon="lock.fill" label="App Lock">
        <Switch
          value={lockEnabled}
          onValueChange={onToggle}
          disabled={!lockAvailable}
          label="Require Face ID or Passcode"
        />

        {hint !== undefined && (
          <Text variant="caption" tone="textSecondary">
            {hint}
          </Text>
        )}
      </SettingsRow>
    </GlassSurface>
  );
};

export default AppLockSetting;
