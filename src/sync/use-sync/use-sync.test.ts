import { left, right } from 'fnts/either';
import { act, renderHook } from '@testing-library/react-native';

const mockRunSync = jest.fn();
const mockRefreshMarketData = jest.fn();
const mockRunLoanAutoLink = jest.fn();

jest.mock('../../monobank/sync', () => ({
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));
jest.mock('@kiko/sync/refresh-market-data', () => ({
  refreshMarketData: (...args: unknown[]) => mockRefreshMarketData(...args),
}));
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: (...args: unknown[]) => mockRunLoanAutoLink(...args),
}));

import { useSync } from './use-sync';

describe('useSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunSync.mockResolvedValue(undefined);
    mockRefreshMarketData.mockResolvedValue(right(undefined));
    mockRunLoanAutoLink.mockResolvedValue(undefined);
  });

  it('refreshes rates-only, throttled, after a successful sync', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunSync).toHaveBeenCalled();
    expect(mockRefreshMarketData).toHaveBeenCalledWith({ throttled: true, metals: false });
  });

  it('runs the loan auto-link matcher once after a successful sync', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
  });

  it('never runs the loan auto-link matcher when the sync itself fails', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunLoanAutoLink).not.toHaveBeenCalled();
  });

  it('passes the target account id through to runSync', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync('acc-42');
    });

    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: 'acc-42' });
  });

  it('calls runSync with no target id when sync is invoked without one', async () => {
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(mockRunSync).toHaveBeenCalledWith({ targetAccountId: undefined });
  });

  it('surfaces an error message when sync fails, without throwing', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.error).toMatch(/sync boom/);
  });

  it('resolves true when the sync and rate refresh succeed', async () => {
    const { result } = await renderHook(() => useSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync('acc-42');
    });

    expect(outcome).toBe(true);
  });

  it('resolves false (and sets error) when the sync fails', async () => {
    mockRunSync.mockRejectedValue(new Error('sync boom'));
    const { result } = await renderHook(() => useSync());

    let outcome = true;
    await act(async () => {
      outcome = await result.current.sync();
    });

    expect(outcome).toBe(false);
    expect(result.current.error).toMatch(/sync boom/);
  });

  it('resolves true and surfaces no error when the sync succeeds but the rate refresh fails', async () => {
    mockRefreshMarketData.mockResolvedValue(left([{ step: 'rates', reason: 'boom' }]));
    const { result } = await renderHook(() => useSync());

    let outcome = false;
    await act(async () => {
      outcome = await result.current.sync();
    });

    expect(outcome).toBe(true);
    expect(result.current.error).toBeUndefined();
  });
});
