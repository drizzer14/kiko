import { remindersNative } from '@kiko/reminders/native';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { i18n } from '../init';

import { useTimeClock } from '.';

const appStateListeners: ((state: AppStateStatus) => void)[] = [];

const uses24HourClock = jest.spyOn(remindersNative, 'uses24HourClock');

const transition = async (state: AppStateStatus): Promise<void> => {
  await act(async () => {
    for (const listener of [...appStateListeners]) {
      listener(state);
    }
  });
};

beforeEach(async () => {
  appStateListeners.length = 0;
  uses24HourClock.mockReset().mockReturnValue(true);
  jest
    .mocked(AppState.addEventListener)
    .mockImplementation((_type, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: () => appStateListeners.splice(appStateListeners.indexOf(listener), 1) };
    });
  await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('useTimeClock', () => {
  it('reads the 24-hour clock when the device uses it', async () => {
    const { result } = await renderHook(() => useTimeClock());

    expect(result.current).toEqual({ uses24Hour: true });
  });

  it('reads the 12-hour clock with the English marks', async () => {
    uses24HourClock.mockReturnValue(false);

    const { result } = await renderHook(() => useTimeClock());

    expect(result.current).toEqual({ uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' });
  });

  it('reads the 12-hour clock with the Ukrainian marks', async () => {
    uses24HourClock.mockReturnValue(false);
    await i18n.changeLanguage('uk');

    const { result } = await renderHook(() => useTimeClock());

    expect(result.current).toEqual({ uses24Hour: false, beforeNoon: 'дп', afterNoon: 'пп' });
  });

  it('follows the switch flipped while the app was away, once it is active again', async () => {
    const { result } = await renderHook(() => useTimeClock());

    uses24HourClock.mockReturnValue(false);
    await transition('background');

    expect(result.current.uses24Hour).toBe(true);

    await transition('active');

    expect(result.current.uses24Hour).toBe(false);
  });

  it('listens to the app state once for every mounted reader', async () => {
    await renderHook(() => [useTimeClock(), useTimeClock()]);
    await renderHook(() => useTimeClock());

    expect(appStateListeners).toHaveLength(1);
  });

  it('reads the device setting once for every mounted reader, and again when the app is active', async () => {
    await renderHook(() => [useTimeClock(), useTimeClock()]);
    await renderHook(() => useTimeClock());

    expect(uses24HourClock).toHaveBeenCalledTimes(1);

    await transition('active');

    expect(uses24HourClock).toHaveBeenCalledTimes(2);
  });

  it('reads the device setting afresh for a reader mounted after every reader left', async () => {
    const { unmount } = await renderHook(() => useTimeClock());

    await unmount();
    uses24HourClock.mockReturnValue(false);
    const { result } = await renderHook(() => useTimeClock());

    expect(result.current.uses24Hour).toBe(false);
  });

  it('stops listening once nothing reads the clock', async () => {
    const { unmount } = await renderHook(() => useTimeClock());

    await unmount();

    expect(appStateListeners).toHaveLength(0);
  });

  describe('when the device setting cannot be read', () => {
    beforeEach(() => {
      uses24HourClock.mockImplementation(() => {
        throw new Error('KikoReminders is not in this binary');
      });
    });

    it('reads the 12-hour clock in English', async () => {
      const { result } = await renderHook(() => useTimeClock());

      expect(result.current).toEqual({ uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' });
    });

    it('reads the 24-hour clock in Ukrainian', async () => {
      await i18n.changeLanguage('uk');

      const { result } = await renderHook(() => useTimeClock());

      expect(result.current).toEqual({ uses24Hour: true });
    });
  });
});
