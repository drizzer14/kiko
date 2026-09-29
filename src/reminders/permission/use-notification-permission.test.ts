import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { type NotificationAuthorization, remindersNative } from '@kiko/reminders/native';

import { useNotificationPermission } from '.';

const appStateListeners: ((state: AppStateStatus) => void)[] = [];

let nativeStatus: NotificationAuthorization;

const authorizationStatus = jest.spyOn(remindersNative, 'authorizationStatus');
const requestAuthorization = jest.spyOn(remindersNative, 'requestAuthorization');

const transition = async (state: AppStateStatus): Promise<void> => {
  await act(async () => {
    for (const listener of appStateListeners) {
      listener(state);
    }
  });
};

// The next native read stays pending until the test settles it.
const heldRead = (): { settle: (status: NotificationAuthorization) => void } => {
  let settle: (status: NotificationAuthorization) => void = () => undefined;

  authorizationStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );

  return { settle: (status) => settle(status) };
};

beforeEach(() => {
  appStateListeners.length = 0;
  nativeStatus = 'notDetermined';
  authorizationStatus.mockReset().mockImplementation(async () => nativeStatus);
  requestAuthorization.mockReset().mockImplementation(async () => {
    nativeStatus = 'denied';

    return false;
  });
  jest
    .mocked(AppState.addEventListener)
    .mockImplementation((_type, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: () => appStateListeners.splice(appStateListeners.indexOf(listener), 1) };
    });
});

describe('useNotificationPermission', () => {
  it('reads the status on mount', async () => {
    nativeStatus = 'authorized';

    const { result } = await renderHook(() => useNotificationPermission());

    expect(result.current.status).toBe('authorized');
  });

  it('reads the status again when the app becomes active, as after a visit to iOS Settings', async () => {
    nativeStatus = 'denied';

    const { result } = await renderHook(() => useNotificationPermission());

    nativeStatus = 'authorized';
    await transition('active');

    expect(result.current.status).toBe('authorized');
  });

  it('does not read the status for the background or inactive states', async () => {
    await renderHook(() => useNotificationPermission());

    await transition('inactive');
    await transition('background');

    expect(authorizationStatus).toHaveBeenCalledTimes(1);
  });

  it('asks iOS once and returns the status the answer left', async () => {
    const { result } = await renderHook(() => useNotificationPermission());

    let answered: NotificationAuthorization | undefined;

    await act(async () => {
      answered = await result.current.request();
    });

    expect(requestAuthorization).toHaveBeenCalledTimes(1);
    expect(answered).toBe('denied');
    expect(result.current.status).toBe('denied');
  });

  it.each<[NotificationAuthorization, boolean]>([
    ['authorized', true],
    ['denied', false],
  ])(
    'a request answered %s in one instance updates every mounted instance',
    async (answer, granted) => {
      requestAuthorization.mockImplementation(async () => {
        nativeStatus = answer;

        return granted;
      });

      const first = await renderHook(() => useNotificationPermission());
      const second = await renderHook(() => useNotificationPermission());

      expect(second.result.current.status).toBe('notDetermined');

      await act(async () => {
        await first.result.current.request();
      });

      expect(second.result.current.status).toBe(answer);
    },
  );

  it('keeps the last status and never rejects when the native read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    nativeStatus = 'authorized';

    const { result } = await renderHook(() => useNotificationPermission());

    authorizationStatus.mockRejectedValue(new Error('native module missing SECRET'));
    await transition('active');

    expect(result.current.status).toBe('authorized');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[reminders] notification permission failed', {
      name: 'Error',
      code: undefined,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET');

    warn.mockRestore();
  });

  it('counts a failed request as denied, so the app never assumes it may notify', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useNotificationPermission());

    requestAuthorization.mockRejectedValue(new Error('native module missing'));

    let answered: NotificationAuthorization | undefined;

    await act(async () => {
      answered = await result.current.request();
    });

    expect(answered).toBe('denied');
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('drops a read that started before an answer and settled after it', async () => {
    const { result } = await renderHook(() => useNotificationPermission());
    const staleRead = heldRead();

    requestAuthorization.mockImplementation(async () => {
      nativeStatus = 'authorized';

      return true;
    });

    await transition('active');
    await act(async () => {
      await result.current.request();
    });
    await act(async () => {
      staleRead.settle('notDetermined');
    });

    expect(result.current.status).toBe('authorized');
  });

  it('forgets the status once no instance is mounted, so a remount never shows a stale one', async () => {
    nativeStatus = 'denied';

    const { unmount } = await renderHook(() => useNotificationPermission());

    await unmount();

    const remountRead = heldRead();
    const { result } = await renderHook(() => useNotificationPermission());

    expect(result.current.status).toBeUndefined();

    await act(async () => {
      remountRead.settle('authorized');
    });

    expect(result.current.status).toBe('authorized');
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = await renderHook(() => useNotificationPermission());

    await unmount();
    await transition('active');

    expect(authorizationStatus).toHaveBeenCalledTimes(1);
  });
});
