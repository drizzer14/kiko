import type { LayoutMode } from '@kiko/display-regions';
import { act, renderHook } from '@testing-library/react-native';

import { SETTLE_DELAY_MS, useSettledLayoutMode } from '.';

const mockModeStore = {
  mode: 'columns' as LayoutMode,
  listeners: new Set<() => void>(),
};

const emit = async (mode: LayoutMode): Promise<void> => {
  await act(async () => {
    mockModeStore.mode = mode;

    for (const listener of mockModeStore.listeners) {
      listener();
    }
  });
};

const elapse = async (milliseconds: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
};

jest.mock('@kiko/display-regions', () => {
  const { useSyncExternalStore } = require('react');

  return {
    useLayoutMode: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          mockModeStore.listeners.add(listener);

          return () => mockModeStore.listeners.delete(listener);
        },
        () => mockModeStore.mode,
      ),
  };
});

// A pose change reports two or three snapshots within about 150 ms, and the first can be a frame
// of a mode the window never settles in: the outer display shows one frame of a regular size
// class ('rows'), and the inner display one frame of a compact one ('single').
describe('useSettledLayoutMode', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockModeStore.mode = 'columns';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts at the mode the window has, with no delay', async () => {
    mockModeStore.mode = 'rows';
    const { result } = await renderHook(() => useSettledLayoutMode());

    expect(result.current).toBe('rows');
  });

  it('keeps the split mode until a change to single has lasted the settle delay', async () => {
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('single');
    await elapse(SETTLE_DELAY_MS - 1);

    expect(result.current).toBe('columns');

    await elapse(1);

    expect(result.current).toBe('single');
  });

  it('keeps single until a change to a split mode has lasted the settle delay', async () => {
    mockModeStore.mode = 'single';
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('rows');
    await elapse(SETTLE_DELAY_MS - 1);

    expect(result.current).toBe('single');

    await elapse(1);

    expect(result.current).toBe('rows');
  });

  it('never reports the transient single frame of an inner display', async () => {
    const { result } = await renderHook(() => useSettledLayoutMode());
    const reported: LayoutMode[] = [];

    await emit('single');
    reported.push(result.current);
    await elapse(60);
    await emit('columns');
    reported.push(result.current);
    await elapse(SETTLE_DELAY_MS * 2);
    reported.push(result.current);

    expect(reported).toEqual(['columns', 'columns', 'columns']);
  });

  it('settles on single after the transient rows frame of an outer display', async () => {
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('rows');
    await elapse(40);
    await emit('single');
    await elapse(SETTLE_DELAY_MS - 1);

    expect(result.current).not.toBe('single');

    await elapse(1);

    expect(result.current).toBe('single');
  });

  it('restarts the delay when the mode moves again before it ends', async () => {
    mockModeStore.mode = 'single';
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('columns');
    await elapse(100);
    await emit('single');
    await emit('columns');
    await elapse(100);

    expect(result.current).toBe('single');

    await elapse(SETTLE_DELAY_MS);

    expect(result.current).toBe('columns');
  });

  it('follows a rotation between the two split modes at once', async () => {
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('rows');

    expect(result.current).toBe('rows');

    await emit('columns');

    expect(result.current).toBe('columns');
  });

  it('remembers the split mode a rotation reached before a transient single frame', async () => {
    const { result } = await renderHook(() => useSettledLayoutMode());

    await emit('rows');
    await elapse(10);
    await emit('single');

    expect(result.current).toBe('rows');
  });
});
