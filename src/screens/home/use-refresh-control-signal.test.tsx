import { act, renderHook } from '@testing-library/react-native';

// A faithful-enough `useFocusEffect`. React Navigation runs the effect callback
// on focus, RE-RUNS it (after cleanup) whenever the callback identity changes
// WHILE the screen is focused, and runs cleanup on blur/unmount. Model it with a
// real `useEffect` keyed on the callback plus a shared focus flag the test
// drives, so a test reproduces the on-device timing — in particular the
// re-run-on-change that makes an isSyncing-DEPENDENT callback blip the flag
// false on a manual pull. A capture-only mock cannot catch that class of bug
// (the 663f2e5 regression), so this mock intentionally does the re-run.
const mockNav = { focused: false, focusListeners: new Set<() => void>() };

jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (callback: () => undefined | (() => void)) => {
      useEffect(() => {
        let cleanup: undefined | (() => void);
        const run = (): void => {
          cleanup = callback() ?? undefined;
        };
        // Re-run on (re)subscribe if focused: this is what fires when the
        // callback identity changes while the screen is focused.
        if (mockNav.focused) {
          run();
        }
        const onFocus = (): void => {
          cleanup?.();
          run();
        };
        mockNav.focusListeners.add(onFocus);
        return () => {
          mockNav.focusListeners.delete(onFocus);
          cleanup?.();
        };
      }, [callback]);
    },
  };
});

import { useRefreshControlSignal } from './use-refresh-control-signal';

// Capture the deferred `requestAnimationFrame` callbacks and flush them
// explicitly, so a test can observe the leading (false) edge before the trailing
// (true) edge lands on the next frame.
const frameCallbacks: Array<() => void> = [];
const flushFrames = (): void => {
  const pending = frameCallbacks.splice(0);
  for (const callback of pending) {
    callback();
  }
};

beforeEach(() => {
  mockNav.focused = false;
  mockNav.focusListeners.clear();
  frameCallbacks.length = 0;
  jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frameCallbacks.push(() => callback(0));
    return frameCallbacks.length as unknown as number;
  });
  jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Fire a focus event the way React Navigation does when the screen becomes
// focused. `renderHook`/`rerender` are async in RNTL 14, so every state-changing
// step is awaited.
const fireFocus = async (): Promise<void> => {
  await act(async () => {
    mockNav.focused = true;
    for (const listener of [...mockNav.focusListeners]) {
      listener();
    }
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    flushFrames();
  });
};

const renderSignal = (syncing: boolean) =>
  renderHook(({ isSyncing }: { isSyncing: boolean }) => useRefreshControlSignal(isSyncing), {
    initialProps: { isSyncing: syncing },
  });

describe('useRefreshControlSignal', () => {
  it('re-issues a false->true edge on refocus while a sync is still running', async () => {
    const { result } = await renderSignal(true);

    // Focused with a sync running: the spinner settles on.
    await fireFocus();
    await flush();
    expect(result.current).toBe(true);

    // Refocus while the sync is STILL running. The prop is already true, so only
    // a fresh false->true edge makes RN re-call the native beginRefreshing().
    await fireFocus();
    // The leading edge: the flag drops to false immediately on refocus...
    expect(result.current).toBe(false);
    // ...and rises to true on the next frame.
    await flush();
    expect(result.current).toBe(true);
  });

  it('stays idle on focus when no sync is running and schedules no frame', async () => {
    const { result } = await renderSignal(false);

    await fireFocus();
    await flush();

    expect(result.current).toBe(false);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('starts the spinner when a sync begins while the screen stays focused', async () => {
    const { result, rerender } = await renderSignal(false);
    await fireFocus();
    expect(result.current).toBe(false);

    await rerender({ isSyncing: true });

    expect(result.current).toBe(true);
  });

  // BUG B (regression of 663f2e5): a manual pull-to-refresh flips isSyncing
  // false->true WHILE the screen is already focused (no blur). The re-drive must
  // NOT fire here — its leading `false` edge would retract the native spinner the
  // user just pulled. The flag must go straight to true with no intervening false
  // and no scheduled frame. With the earlier `[isSyncing]` focus-effect dep, an
  // in-place change re-ran the focus callback and blipped the flag false.
  it('does not blip false on an in-place isSyncing change while focused (manual pull)', async () => {
    const { result, rerender } = await renderSignal(false);
    await fireFocus();
    expect(result.current).toBe(false);

    // The manual pull: isSyncing rises while focused, without a refocus.
    await rerender({ isSyncing: true });

    // Straight to true — the re-drive path (which drops to false first) never ran.
    expect(result.current).toBe(true);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('clears the spinner when the sync ends while the screen stays focused', async () => {
    const { result, rerender } = await renderSignal(true);
    await fireFocus();
    await flush();
    expect(result.current).toBe(true);

    await rerender({ isSyncing: false });

    expect(result.current).toBe(false);
  });
});
