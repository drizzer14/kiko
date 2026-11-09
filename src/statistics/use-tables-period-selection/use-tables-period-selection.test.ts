import { act, renderHook } from '@testing-library/react-native';
import { resetTablesPeriodSelection } from '@kiko/test-support/tables-period-selection';

import { useTablesPeriodSelection } from './use-tables-period-selection';

describe('useTablesPeriodSelection', () => {
  afterEach(resetTablesPeriodSelection);

  it('starts with no pick', async () => {
    const { result } = await renderHook(() => useTablesPeriodSelection());

    expect(result.current.selectedPeriod).toBeUndefined();
  });

  it('holds a pick, and clears it when handed none', async () => {
    const { result } = await renderHook(() => useTablesPeriodSelection());

    await act(async () => {
      result.current.selectPeriod({ kind: 'year', year: 2024 });
    });

    expect(result.current.selectedPeriod).toEqual({ kind: 'year', year: 2024 });

    await act(async () => {
      result.current.selectPeriod(undefined);
    });

    expect(result.current.selectedPeriod).toBeUndefined();
  });

  it('shows a pick to every reader at once', async () => {
    const first = await renderHook(() => useTablesPeriodSelection());
    const second = await renderHook(() => useTablesPeriodSelection());

    await act(async () => {
      first.result.current.selectPeriod({ kind: 'year', year: 2024 });
    });

    expect(second.result.current.selectedPeriod).toEqual({ kind: 'year', year: 2024 });
  });

  // The Tables screen unmounts on Back, so a pick that went with its last reader would be lost.
  it('keeps a pick after every reader unmounted', async () => {
    const first = await renderHook(() => useTablesPeriodSelection());

    await act(async () => {
      first.result.current.selectPeriod({ kind: 'year', year: 2024 });
    });
    await first.unmount();

    const second = await renderHook(() => useTablesPeriodSelection());

    expect(second.result.current.selectedPeriod).toEqual({ kind: 'year', year: 2024 });
  });
});
