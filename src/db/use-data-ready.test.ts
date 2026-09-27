import { renderHook } from '@testing-library/react-native';

import { useDataReady } from './use-data-ready';

describe('useDataReady', () => {
  it('is not ready while any given flag is still loading', async () => {
    const { result } = await renderHook(() => useDataReady(false, true, false));

    expect(result.current).toBe(false);
  });

  it('is ready once every given flag has settled', async () => {
    const { result } = await renderHook(() => useDataReady(false, false));

    expect(result.current).toBe(true);
  });

  it('is ready with no flags at all', async () => {
    const { result } = await renderHook(() => useDataReady());

    expect(result.current).toBe(true);
  });

  it('re-opens the gate whenever a flag reports loading again (no latch)', async () => {
    // No latch: `useLiveQuery`'s own `isLoading` is per-key (true again only
    // on a genuine sql/paramsKey change, never on a same-key reactive
    // re-run — see use-live-query.ts), so this gate simply follows its
    // inputs rather than pinning itself open once every flag has settled
    // once.
    const { result, rerender } = await renderHook(
      (props: { isLoading: boolean }) => useDataReady(props.isLoading),
      { initialProps: { isLoading: false } },
    );

    expect(result.current).toBe(true);

    await rerender({ isLoading: true });

    expect(result.current).toBe(false);
  });

  it('stays not-ready across a re-render until every flag has settled at least once', async () => {
    const { result, rerender } = await renderHook(
      (props: { isLoading: boolean }) => useDataReady(props.isLoading),
      { initialProps: { isLoading: true } },
    );

    expect(result.current).toBe(false);

    await rerender({ isLoading: true });

    expect(result.current).toBe(false);

    await rerender({ isLoading: false });

    expect(result.current).toBe(true);
  });
});
