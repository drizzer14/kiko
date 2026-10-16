import { defaultDateRange } from '@kiko/dates';
import { act, renderHook } from '@testing-library/react-native';

import { useDateRangeSelection } from './use-date-range-selection';

const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe('useDateRangeSelection', () => {
  it('starts on the default last-30-days range', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));

    const range = defaultDateRange(NOW);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);
  });

  it('holds a picked range exactly as given', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));
    const from = new Date(2026, 0, 2);
    const to = new Date(2026, 0, 9);

    await act(async () => {
      result.current.applyDateRange(from, to);
    });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBe(to);
  });

  it('keeps an open-ended side null instead of falling back to the default', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));
    const from = new Date(2026, 0, 2);

    await act(async () => {
      result.current.applyDateRange(from, null);
    });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBeNull();

    await act(async () => {
      result.current.applyDateRange(null, null);
    });

    expect(result.current.dateFrom).toBeNull();
    expect(result.current.dateTo).toBeNull();
  });

  it('returns to the default range when cleared', async () => {
    const { result } = await renderHook(() => useDateRangeSelection(NOW));

    await act(async () => {
      result.current.applyDateRange(new Date(2026, 0, 2), new Date(2026, 0, 9));
    });
    await act(async () => {
      result.current.clearDateRange();
    });

    const range = defaultDateRange(NOW);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);
  });

  it('derives the default range fresh from a later now, but keeps a pick as given', async () => {
    const later = new Date(2026, 5, 20, 12, 0, 0).getTime();
    const { result, rerender } = await renderHook(
      ({ now }: { now: number }) => useDateRangeSelection(now),
      { initialProps: { now: NOW } },
    );

    await rerender({ now: later });

    const range = defaultDateRange(later);

    expect(result.current.dateFrom).toEqual(range.from);
    expect(result.current.dateTo).toEqual(range.to);

    const from = new Date(2026, 0, 2);
    const to = new Date(2026, 0, 9);

    await act(async () => {
      result.current.applyDateRange(from, to);
    });
    await rerender({ now: NOW });

    expect(result.current.dateFrom).toBe(from);
    expect(result.current.dateTo).toBe(to);
  });

  describe('shared between readers', () => {
    const PICKED_FROM = new Date(2026, 0, 2);
    const PICKED_TO = new Date(2026, 0, 9);

    type Reader = Awaited<ReturnType<typeof renderOneReader>>;

    const NEXT_DAY = new Date(2026, 5, 16, 9, 0, 0).getTime();
    const SAME_DAY_LATER = new Date(2026, 5, 15, 18, 0, 0).getTime();

    const renderOneReader = (onRender?: () => void) =>
      renderHook(
        ({ now }: { now: number }) => {
          onRender?.();

          return useDateRangeSelection(now);
        },
        { initialProps: { now: NOW } },
      );

    const renderTwoReaders = async (onRender?: () => void): Promise<[Reader, Reader]> => [
      await renderOneReader(),
      await renderOneReader(onRender),
    ];

    const expectDefaultOf = (reader: Reader, now: number): void => {
      const range = defaultDateRange(now);

      expect(reader.result.current.dateFrom).toEqual(range.from);
      expect(reader.result.current.dateTo).toEqual(range.to);
    };

    const pickIn = async (reader: Reader): Promise<void> => {
      await act(async () => {
        reader.result.current.applyDateRange(PICKED_FROM, PICKED_TO);
      });
    };

    const expectPick = (reader: Reader): void => {
      expect(reader.result.current.dateFrom).toBe(PICKED_FROM);
      expect(reader.result.current.dateTo).toBe(PICKED_TO);
    };

    const expectDefault = (reader: Reader): void => expectDefaultOf(reader, NOW);

    it('shows a pick made in one reader in every mounted reader', async () => {
      const [first, second] = await renderTwoReaders();

      await pickIn(first);

      expectPick(second);
    });

    it('clears the pick for every mounted reader', async () => {
      const [first, second] = await renderTwoReaders();

      await pickIn(first);
      await act(async () => {
        second.result.current.clearDateRange();
      });

      expectDefault(first);
    });

    it('moves every reader to the new day when any reader passes a later-day now', async () => {
      const [first, second] = await renderTwoReaders();

      await first.rerender({ now: NEXT_DAY });

      expectDefaultOf(first, NEXT_DAY);
      expectDefaultOf(second, NEXT_DAY);
    });

    it('keeps the newer day when a reader passes an older now', async () => {
      const [first, second] = await renderTwoReaders();

      await first.rerender({ now: NEXT_DAY });
      await second.rerender({ now: NOW });

      expectDefaultOf(first, NEXT_DAY);
      expectDefaultOf(second, NEXT_DAY);
    });

    it('does not re-render other readers when a later now falls on the same day', async () => {
      let secondRenders = 0;
      const [first] = await renderTwoReaders(() => {
        secondRenders += 1;
      });
      const rendersBefore = secondRenders;

      await first.rerender({ now: SAME_DAY_LATER });

      expect(secondRenders).toBe(rendersBefore);
    });

    it('keeps the pick while one reader unmounts and another stays mounted', async () => {
      const [first, second] = await renderTwoReaders();

      await pickIn(first);
      await first.unmount();

      expectPick(second);
    });

    it('starts on the default range again after every reader unmounts', async () => {
      const [first, second] = await renderTwoReaders();

      await pickIn(first);
      await first.unmount();
      await second.unmount();

      expectDefault(await renderOneReader());
    });
  });
});
