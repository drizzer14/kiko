import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import type { TimeClock } from '@kiko/dates';
import { useTranslation } from 'react-i18next';
import { bifoldr, eitherSync } from 'fnts/either';
import { remindersNative } from '@kiko/reminders/native';

type Listener = () => void;

const listeners = new Set<Listener>();
let appStateSubscription: { remove: () => void } | undefined;
let reading: { uses24Hour: boolean | undefined } | undefined;

// A synchronous native call, so it runs once per activation, not per render.
// `undefined` where the module is missing or the read throws; not logged, since
// a binary without the module is expected to fall back.
const readUses24Hour = (): boolean | undefined =>
  bifoldr(eitherSync<unknown, boolean>(() => remindersNative.uses24HourClock()));

const getSnapshot = (): boolean | undefined => {
  if (reading === undefined) {
    reading = { uses24Hour: readUses24Hour() };
  }

  return reading.uses24Hour;
};

// The 24-Hour Time switch is in iOS Settings, so it changes only while the
// app is away: one AppState listener, shared by every reader, re-reads it when
// the app is active again.
const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  if (appStateSubscription === undefined) {
    appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        reading = { uses24Hour: readUses24Hour() };

        for (const notify of listeners) {
          notify();
        }
      }
    });
  }

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      appStateSubscription?.remove();
      appStateSubscription = undefined;
      // Nothing re-reads the setting while no reader listens, so the next
      // reader must not start from a reading that may have gone stale.
      reading = undefined;
    }
  };
};

/**
 * The clock every shown time of day reads on (`formatTime`), as the iOS
 * 24-Hour Time setting has it, with the active language's marks on the
 * 12-hour clock. A reader re-renders when the app becomes active again, so a
 * switch flipped in iOS Settings shows without a relaunch. Without the device
 * setting, the clock most readers of each language expect.
 */
export const useTimeClock = (): TimeClock => {
  const { t, i18n } = useTranslation();
  const uses24Hour = useSyncExternalStore(subscribe, getSnapshot) ?? i18n.language === 'uk';

  if (uses24Hour) {
    return { uses24Hour: true };
  }

  return {
    uses24Hour: false,
    beforeNoon: t('calendar.dayPeriod.beforeNoon'),
    afterNoon: t('calendar.dayPeriod.afterNoon'),
  };
};
