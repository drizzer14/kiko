import { useIsLargeWindow } from '@kiko/display-regions';
import { act, renderHook } from '@testing-library/react-native';
import { reportWindow, resizeWindow } from '@kiko/test-support/window-size';

import '@kiko/design-system/unistyles';

import { SETTLE_DELAY_MS } from '../pane-stack';

import { useIsMergedHome } from '.';

const elapse = async (milliseconds: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
};

const expectTrueOnlyOnceTheDelayEnds = async (result: { current: boolean }): Promise<void> => {
  expect(result.current).toBe(false);

  await elapse(1);

  expect(result.current).toBe(true);
};

describe('useIsMergedHome', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    reportWindow('compact', 390, 844);
  });

  it.each([
    ['an iPad mini in portrait', 744, 1133],
    ['an 11-inch iPad in landscape', 1180, 820],
    ['a 13-inch iPad in landscape', 1376, 1032],
  ] as const)('is true at once for %s at launch', async (_name, width, height) => {
    reportWindow('regular', width, height);
    const { result } = await renderHook(() => useIsMergedHome());

    expect(result.current).toBe(true);
  });

  it.each([
    ['the Duo inner window in landscape', 'regular', 951, 669],
    ['the Duo inner window in portrait', 'regular', 669, 951],
    ['a split-view window in landscape', 'regular', 1032, 683],
    ['a compact iPhone', 'compact', 390, 844],
  ] as const)('is false for %s, however long it lasts', async (_name, sizeClass, width, height) => {
    reportWindow(sizeClass, width, height);
    const { result } = await renderHook(() => useIsMergedHome());

    await elapse(SETTLE_DELAY_MS * 4);

    expect(result.current).toBe(false);
  });

  it('keeps no timer pending while the window does not change', async () => {
    reportWindow('regular', 1376, 1032);
    const timersAddedBy = async (useHook: () => unknown): Promise<number> => {
      const before = jest.getTimerCount();

      await renderHook(useHook);

      return jest.getTimerCount() - before;
    };
    const addedByMountingAnyHook = await timersAddedBy(() => useIsLargeWindow());

    expect(await timersAddedBy(() => useIsMergedHome())).toBe(addedByMountingAnyHook);
  });

  it('turns true only after the large window has lasted the settle delay', async () => {
    reportWindow('regular', 1032, 683);
    const { result } = await renderHook(() => useIsMergedHome());

    await resizeWindow(1376, 1032);
    await elapse(SETTLE_DELAY_MS - 1);
    await expectTrueOnlyOnceTheDelayEnds(result);
  });

  it('turns false only after a window that is no longer large has lasted the settle delay', async () => {
    reportWindow('regular', 1376, 1032);
    const { result } = await renderHook(() => useIsMergedHome());

    await resizeWindow(1032, 683);
    await elapse(SETTLE_DELAY_MS - 1);

    expect(result.current).toBe(true);

    await elapse(1);

    expect(result.current).toBe(false);
  });

  it('never reports true for a large window that is gone within the settle delay', async () => {
    reportWindow('regular', 1032, 683);
    const { result } = await renderHook(() => useIsMergedHome());
    const reported: boolean[] = [];

    await resizeWindow(1376, 1032);
    await elapse(SETTLE_DELAY_MS - 1);
    reported.push(result.current);
    await resizeWindow(1032, 683);
    reported.push(result.current);
    await elapse(SETTLE_DELAY_MS * 2);
    reported.push(result.current);

    expect(reported).toEqual([false, false, false]);
  });

  it('starts the delay again when the window flips back and forth', async () => {
    reportWindow('regular', 1032, 683);
    const { result } = await renderHook(() => useIsMergedHome());

    await resizeWindow(1376, 1032);
    await elapse(SETTLE_DELAY_MS - 1);
    await resizeWindow(1032, 683);
    await resizeWindow(1376, 1032);
    await elapse(SETTLE_DELAY_MS - 1);
    await expectTrueOnlyOnceTheDelayEnds(result);
  });
});
