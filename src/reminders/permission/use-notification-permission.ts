import { AppState } from 'react-native';
import either, { bifoldMap } from 'fnts/either';
import { useCallback, useEffect, useState } from 'react';
import { type NotificationAuthorization, remindersNative } from '@kiko/reminders/native';

export type NotificationPermission = {
  status: NotificationAuthorization | undefined;
  refresh: () => Promise<void>;
  request: () => Promise<NotificationAuthorization>;
};

const warnPermissionFailure = (reason: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a failed permission read or request has no UI surface of its own; log it so a device log shows what failed
  console.warn('[reminders] notification permission failed', reason);
};

/**
 * The notification permission as iOS reports it. `status` is `undefined`
 * until the first read settles. It is read on mount and again whenever the
 * app becomes active, since the user may have changed it in iOS Settings.
 * Neither function rejects: a failed read keeps the last status, and a failed
 * request counts as denied.
 */
export const useNotificationPermission = (): NotificationPermission => {
  const [status, setStatus] = useState<NotificationAuthorization | undefined>(undefined);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await either<unknown, NotificationAuthorization>(() =>
      remindersNative.authorizationStatus(),
    );

    bifoldMap(result, warnPermissionFailure, setStatus);
  }, []);

  const request = useCallback(async (): Promise<NotificationAuthorization> => {
    const result = await either<unknown, NotificationAuthorization>(async () => {
      await remindersNative.requestAuthorization();

      return remindersNative.authorizationStatus();
    });

    return bifoldMap(
      result,
      (reason): NotificationAuthorization => {
        warnPermissionFailure(reason);

        return 'denied';
      },
      (answered) => {
        setStatus(answered);

        return answered;
      },
    );
  }, []);

  useEffect(() => {
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) refresh captures every rejection with either()
    refresh();
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) refresh captures every rejection with either()
        refresh();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refresh]);

  return { status, refresh, request };
};
