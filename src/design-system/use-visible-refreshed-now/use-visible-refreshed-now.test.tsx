import { act, renderHook } from '@testing-library/react-native';

import { useVisibleRefreshedNow } from './use-visible-refreshed-now';

describe('useVisibleRefreshedNow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds now at mount', async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => 1_000);

    const { result } = await renderHook(() => useVisibleRefreshedNow(true));

    expect(result.current).toBe(1_000);
  });

  it('re-reads the clock every time the screen becomes visible', async () => {
    let clock = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    const { result, rerender } = await renderHook(
      ({ isVisible }: { isVisible: boolean }) => useVisibleRefreshedNow(isVisible),
      { initialProps: { isVisible: true } },
    );

    clock = 5_000;
    await act(async () => {
      await rerender({ isVisible: false });
    });

    expect(result.current).toBe(1_000);

    await act(async () => {
      await rerender({ isVisible: true });
    });

    expect(result.current).toBe(5_000);
  });

  it('keeps the same value across an ordinary re-render', async () => {
    let clock = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    const { result, rerender } = await renderHook(() => useVisibleRefreshedNow(true));

    clock = 9_000;
    await act(async () => {
      await rerender({});
    });

    expect(result.current).toBe(1_000);
  });

  it('does not refresh while it stays hidden', async () => {
    let clock = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    const { result, rerender } = await renderHook(() => useVisibleRefreshedNow(false));

    clock = 9_000;
    await act(async () => {
      await rerender({});
    });

    expect(result.current).toBe(1_000);
  });
});
