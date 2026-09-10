import { act, renderHook } from '@testing-library/react-native';

import { setFastPhaseDone } from '../../monobank/sync-status';

import { useRefreshControlSignal } from './use-refresh-control-signal';

// The fast-phase-done store is a module-level singleton; reset it before each
// test so one test's balance-commit never leaks into the next.
beforeEach(() => {
  setFastPhaseDone(false);
});

const renderSignal = (onRefresh: () => Promise<void>) =>
  renderHook(() => useRefreshControlSignal(onRefresh));

describe('useRefreshControlSignal', () => {
  // The native RefreshControl is now driven by the LOCAL pull flag ALONE: a
  // pull sets it true synchronously (before any await), so `refreshing` is
  // already true in the commit right after `onRefresh` and iOS never retracts
  // the native spinner on finger-release.
  it('turns refreshing on synchronously when the pull starts', async () => {
    const onRefresh = jest.fn(() => new Promise<void>(() => undefined));
    const { result } = await renderSignal(onRefresh);

    await act(async () => {
      result.current.onRefresh();
    });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);
  });

  // The core decouple: the pull spinner ends when the FAST balance phase
  // resolves, NOT when the whole run settles minutes later. Here the run
  // promise never settles, yet the fast-phase-done signal clears the spinner.
  it('clears refreshing when the fast phase resolves, before the whole run settles', async () => {
    const onRefresh = jest.fn(() => new Promise<void>(() => undefined));
    const { result } = await renderSignal(onRefresh);

    await act(async () => {
      result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);

    // The fast phase resolves (balances committed) while the run is still in
    // flight. The spinner ends now — the progress bar carries the rest.
    await act(async () => {
      setFastPhaseDone(true);
    });

    expect(result.current.refreshing).toBe(false);
  });

  // A pull that JOINS an already-in-flight run whose fast phase already
  // committed: balances are already loaded, so the spinner clears immediately
  // rather than hanging.
  it('clears immediately when a pull joins a run whose fast phase already committed', async () => {
    setFastPhaseDone(true);
    const onRefresh = jest.fn(() => new Promise<void>(() => undefined));
    const { result } = await renderSignal(onRefresh);

    await act(async () => {
      result.current.onRefresh();
    });

    expect(result.current.refreshing).toBe(false);
  });

  // A fan-out with no Monobank job (a crypto-only account, or no syncable
  // account) fires no fast-phase signal, so the spinner must still clear when
  // the whole run settles — it can never hang.
  it('clears when the run settles even if no fast-phase signal fires', async () => {
    let settle: () => void = () => undefined;
    const onRefresh = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = await renderSignal(onRefresh);

    await act(async () => {
      result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      settle();
      await Promise.resolve();
    });

    expect(result.current.refreshing).toBe(false);
  });

  // The fast-phase-done signal is consumed by the PULL path only. An
  // auto-sync-on-open fires the same signal with NO pull; the pull spinner must
  // not react to it (that spinner belongs to the pull gesture alone; the
  // progress bar shows the auto-sync).
  it('ignores a fast-phase signal when no pull is active', async () => {
    const onRefresh = jest.fn(() => Promise.resolve());
    const { result } = await renderSignal(onRefresh);

    await act(async () => {
      setFastPhaseDone(true);
    });

    expect(result.current.refreshing).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
