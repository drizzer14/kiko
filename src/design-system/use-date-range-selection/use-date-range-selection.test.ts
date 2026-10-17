import { defaultDateRange } from '@kiko/dates';
import { createElement, Fragment } from 'react';
import { act, render, renderHook } from '@testing-library/react-native';

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
    // Differs from NOW so the re-render really changes the [now] dependency.
    const OLDER_THAN_NEXT_DAY = NOW + 3_600_000;
    const NEXT_DAY_LATER = new Date(2026, 5, 16, 10, 0, 0).getTime();

    type SwapProps = { generation: number; firstNow: number; secondNow: number };

    const latest: Record<string, ReturnType<typeof useDateRangeSelection>> = {};

    const SwapReader = ({ name, now }: { name: string; now: number }): null => {
      latest[name] = useDateRangeSelection(now);

      return null;
    };

    // A new key replaces both readers in one commit, like a fold/unfold that rebuilds the tree.
    const SwapPair = ({ generation, firstNow, secondNow }: SwapProps) =>
      createElement(
        Fragment,
        { key: generation },
        createElement(SwapReader, { name: 'first', now: firstNow }),
        createElement(SwapReader, { name: 'second', now: secondNow }),
      );

    const renderSwappable = (): ReturnType<typeof render> =>
      render(createElement(SwapPair, { generation: 0, firstNow: NOW, secondNow: NOW }));

    const expectLatestDefault = (name: string, now: number): void => {
      const range = defaultDateRange(now);

      expect(latest[name].dateFrom).toEqual(range.from);
      expect(latest[name].dateTo).toEqual(range.to);
    };

    const renderOneReader = (
      onRender?: (selection: ReturnType<typeof useDateRangeSelection>) => void,
      initialNow: number = NOW,
    ) =>
      renderHook(
        ({ now }: { now: number }) => {
          const selection = useDateRangeSelection(now);

          onRender?.(selection);

          return selection;
        },
        { initialProps: { now: initialNow } },
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
      await second.rerender({ now: OLDER_THAN_NEXT_DAY });

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

    it('never renders a shared default older than its own day in a reader mounted after a day crossing', async () => {
      const dayAfterNextDay = new Date(2026, 5, 17, 9, 0, 0).getTime();
      const staleRange = defaultDateRange(NEXT_DAY);
      const ownRange = defaultDateRange(dayAfterNextDay);
      const rendered: Array<{ dateFrom: Date | null; dateTo: Date | null }> = [];
      const first = await renderOneReader();

      await first.rerender({ now: NEXT_DAY });

      await renderOneReader(
        ({ dateFrom, dateTo }) => rendered.push({ dateFrom, dateTo }),
        dayAfterNextDay,
      );

      expect(rendered.length).toBeGreaterThan(0);
      expect(
        rendered.filter(({ dateTo }) => dateTo?.getTime() === staleRange.to.getTime()),
      ).toEqual([]);
      expect(rendered).toEqual(
        rendered.map(() => ({ dateFrom: ownRange.from, dateTo: ownRange.to })),
      );
      expectDefaultOf(first, dayAfterNextDay);
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

    it('forgets the clock after every reader unmounts', async () => {
      const [first, second] = await renderTwoReaders();

      await first.rerender({ now: NEXT_DAY });
      await first.unmount();
      await second.unmount();

      const [third, fourth] = await renderTwoReaders();

      await third.rerender({ now: NEXT_DAY_LATER });

      expectDefaultOf(third, NEXT_DAY_LATER);
      expectDefaultOf(fourth, NEXT_DAY_LATER);
    });

    it('keeps the pick when every reader is replaced in one commit', async () => {
      const rendered = await renderSwappable();

      await act(async () => {
        latest.first.applyDateRange(PICKED_FROM, PICKED_TO);
      });
      await rendered.rerender(
        createElement(SwapPair, { generation: 1, firstNow: NOW, secondNow: NOW }),
      );

      expect(latest.first.dateFrom).toBe(PICKED_FROM);
      expect(latest.first.dateTo).toBe(PICKED_TO);
      expect(latest.second.dateFrom).toBe(PICKED_FROM);
      expect(latest.second.dateTo).toBe(PICKED_TO);
    });

    it('moves every reader to a later day after every reader is replaced in one commit with no pick', async () => {
      const rendered = await renderSwappable();

      await rendered.rerender(
        createElement(SwapPair, { generation: 1, firstNow: NOW, secondNow: NOW }),
      );
      await rendered.rerender(
        createElement(SwapPair, { generation: 1, firstNow: NEXT_DAY, secondNow: NOW }),
      );

      expectLatestDefault('first', NEXT_DAY);
      expectLatestDefault('second', NEXT_DAY);
    });
  });
});
