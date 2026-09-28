import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { type FC, useEffect, useState } from 'react';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Switch from '@kiko/design-system/components/switch';
import SettingsRow from '@kiko/screens/settings/settings-row';
import { isSensorAvailable, type SensorStatus } from '@kiko/auth';

import type { AppLockSettingProps } from './app-lock-setting.props';

// A pure helper (no hook access), so the translator function is threaded in
// from the component's own `useTranslation()` rather than called globally.
// Matches on the WHOLE status, not just `kind` — `passcodeOnly` carries a
// `reason` that picks between two different hint strings.
const sensorHint = (status: SensorStatus | undefined, t: TFunction): string | undefined =>
  match(status)
    .with(undefined, () => undefined)
    .with({ kind: 'available' }, () => undefined)
    .with({ kind: 'passcodeOnly', reason: 'notEnrolled' }, () =>
      t('settings.appLock.hint.passcodeOnly'),
    )
    .with({ kind: 'passcodeOnly', reason: 'biometryUnavailable' }, () =>
      t('settings.appLock.hint.biometryUnavailable'),
    )
    .with({ kind: 'passcodeNotSet' }, () => t('settings.appLock.hint.passcodeNotSet'))
    .with({ kind: 'unavailable' }, () => t('settings.appLock.hint.unavailable'))
    .exhaustive();

// The lock can be offered whenever the system sheet has something to ask for:
// biometrics, or (passcodeOnly) the device passcode. A device with no passcode
// gets a disabled switch and a hint instead of a lock that would fail at runtime.
const canOfferLock = (status: SensorStatus | undefined): boolean =>
  match(status)
    .with({ kind: 'available' }, { kind: 'passcodeOnly' }, () => true)
    .with(undefined, { kind: 'passcodeNotSet' }, { kind: 'unavailable' }, () => false)
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
  // An ON switch stays operable regardless of sensor status, so a denied-Face-ID
  // device (`unavailable` while `lockEnabled`) can still reach the toggle to
  // turn the lock off — see `canOfferLock`'s own doc comment for the OFF case.
  const disabled = !lockEnabled && !canOfferLock(sensorStatus);

  return (
    <Card testID="settings-card-app-lock" padding={3}>
      <SettingsRow testID="settings-row-app-lock" icon="faceid" label={t('settings.appLock.label')}>
        <Switch
          testID="settings-switch-app-lock"
          value={lockEnabled}
          onValueChange={onToggle}
          disabled={disabled}
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
