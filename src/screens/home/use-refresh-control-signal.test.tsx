import { act, renderHook } from '@testing-library/react-native';

// The hook drives the native RefreshControl off the global sync signal, but must
// re-issue a false->true edge on every refocus so iOS restarts the spin it drops
// when the list leaves the window. Control the focus lifecycle by capturing the
// `useFocusEffect` callback, so a test fires focus by hand exactly as React
// Navigation would on a tab switch — no NavigationContainer needed.
let focusCallback: (() => undefined | (() => void)) | null = null;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    focusCallback = callback;
  },
}));

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
  focusCallback = null;
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

// Fire one focus event: run the captured effect callback the way React
// Navigation runs it when the screen becomes focused. `renderHook` and its
// `rerender` are async in RNTL 14, so every state-changing step is awaited.
const fireFocus = async (): Promise<void> => {
  await act(async () => {
    focusCallback?.();
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

  it('clears the spinner when the sync ends while the screen stays focused', async () => {
    const { result, rerender } = await renderSignal(true);
    await fireFocus();
    await flush();
    expect(result.current).toBe(true);

    await rerender({ isSyncing: false });

    expect(result.current).toBe(false);
  });
});
