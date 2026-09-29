import { AppState } from 'react-native';
import { logFailure } from '@kiko/diagnostics';
import either, { bifoldMap } from 'fnts/either';
import { useEffect, useSyncExternalStore } from 'react';
import { type NotificationAuthorization, remindersNative } from '@kiko/reminders/native';

type NotificationPermission = {
  status: NotificationAuthorization | undefined;
  request: () => Promise<NotificationAuthorization>;
};

type Listener = () => void;

// One status for the whole app: an answer given in one screen (the reminder
// form's prompt) must reach every other mounted screen (a list's notice).
let sharedStatus: NotificationAuthorization | undefined;
const listeners = new Set<Listener>();

const publishStatus = (next: NotificationAuthorization): void => {
  if (sharedStatus === next) {
    return;
  }

  sharedStatus = next;

  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): NotificationAuthorization | undefined => sharedStatus;

const warnPermissionFailure = (reason: unknown): void => {
  logFailure('[reminders] notification permission failed', reason);
};

const refresh = async (): Promise<void> => {
  const result = await either<unknown, NotificationAuthorization>(() =>
    remindersNative.authorizationStatus(),
  );

  bifoldMap(result, warnPermissionFailure, publishStatus);
};

const request = async (): Promise<NotificationAuthorization> => {
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
      publishStatus(answered);

      return answered;
    },
  );
};

/**
 * The notification permission as iOS reports it, one status shared by every
 * mounted instance. `status` is `undefined` until the first read settles. It
 * is read on mount and again whenever the app becomes active, since the user
 * may have changed it in iOS Settings. Neither the read nor `request` rejects:
 * a failed read keeps the last status, and a failed request counts as denied.
 */
export const useNotificationPermission = (): NotificationPermission => {
  const status = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) refresh captures every rejection with either()
    refresh();
  }, []);

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
  }, []);

  return { status, request };
};
