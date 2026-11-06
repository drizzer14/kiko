import { DAY_MS } from '@kiko/dates';
import { createElement, Fragment, type ReactElement } from 'react';
import type { BackfillStatus } from '@kiko/rates/history-backfill';
import { act, render, renderHook } from '@testing-library/react-native';
import { useDateRangeSelection } from '@kiko/design-system/use-date-range-selection';

import { useRateHistoryBackfill } from './use-rate-history-backfill';

// The backfill reaches the network: `runBackfill` is a promise each test settles by hand.
const mockRunBackfill = jest.fn(
  (..._args: unknown[]): Promise<BackfillStatus> => new Promise<never>(() => {}),
);

jest.mock('@kiko/rates/history-backfill', () => {
  const actual = jest.requireActual('@kiko/rates/history-backfill');

  return { ...actual, runBackfill: (...args: unknown[]) => mockRunBackfill(...args) };
});

type Input = Parameters<typeof useRateHistoryBackfill>[0];

const SPAN_START = 10 * DAY_MS;
const WIDER_SPAN_START = 5 * DAY_MS;
const NOW = 20 * DAY_MS;
const LATER = 21 * DAY_MS;
const STORED_DAY = 8 * DAY_MS;

const COMPLETE: BackfillStatus = { state: 'complete', lastDay: NOW };
const FAILED: BackfillStatus = { state: 'failed', lastDay: null };

const inputOf = (override: Partial<Input> = {}): Input => ({
  transactions: [{ id: 'transaction-1' }],
  holdings: [{ currency: 'USD' }],
  historyRows: [{ base: 'USD', day: STORED_DAY, source: 'nbu' }],
  transactionsFresh: true,
  historyFresh: true,
  baseCurrency: 'UAH',
  spanStart: SPAN_START,
  now: NOW,
  ...override,
});

type Run = { resolve: (status: BackfillStatus) => void; reject: (error: Error) => void };

// Queues the promise the NEXT `runBackfill` call returns; the calls take them in order.
const queueRun = (): Run => {
  let resolve: Run['resolve'] = () => {};
  let reject: Run['reject'] = () => {};
  const promise = new Promise<BackfillStatus>((resolveRun, rejectRun) => {
    resolve = resolveRun;
    reject = rejectRun;
  });

  mockRunBackfill.mockReturnValueOnce(promise);

  return { resolve, reject };
};

const settle = (action: () => void) =>
  act(async () => {
    action();
  });

const mountReader = (override: Partial<Input> = {}) =>
  renderHook((input: Input) => useRateHistoryBackfill(input), {
    initialProps: inputOf(override),
  });

const argumentOfCall = (index: number): Record<string, unknown> =>
  mockRunBackfill.mock.calls[index]?.[0] as Record<string, unknown>;

// A reader that reports what it shows, mounted under a key so a test can swap it for another
// reader in one commit, the way a layout switch replaces the whole tree.
let shown: BackfillStatus | undefined;

const Reader = ({ input }: { input: Input }): null => {
  shown = useRateHistoryBackfill(input);

  return null;
};

const readerOf = (key: string, override: Partial<Input> = {}): ReactElement =>
  createElement(Reader, { key, input: inputOf(override) });

const TWO_CURRENCIES = [{ currency: 'USD' }, { currency: 'EUR' }] as const;

describe('useRateHistoryBackfill', () => {
  beforeEach(async () => {
    shown = undefined;
    // The store resets a microtask after its last reader unmounts; the previous test's cleanup
    // has unmounted its readers by now, so wait that microtask out before this test mounts.
    await act(async () => {});
  });

  describe('one run for every reader', () => {
    it('starts one run for two readers on the same span and currencies, and settles both', async () => {
      const run = queueRun();
      const first = await mountReader();
      const second = await mountReader();

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
      expect(first.result.current).toEqual({ state: 'loading', lastDay: STORED_DAY });
      expect(second.result.current).toEqual({ state: 'loading', lastDay: STORED_DAY });

      await settle(() => run.resolve(COMPLETE));

      expect(first.result.current).toEqual(COMPLETE);
      expect(second.result.current).toEqual(COMPLETE);
    });

    it('starts nothing for a reader that mounts while the run is pending', async () => {
      queueRun();
      await mountReader();

      const joiner = await mountReader();

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
      expect(joiner.result.current.state).toBe('loading');
    });

    it('starts no run for a mount after a settled run, and shows the settled status at once', async () => {
      const run = queueRun();

      await mountReader();
      await settle(() => run.resolve(COMPLETE));

      const seen: BackfillStatus[] = [];

      await renderHook(() => {
        const status = useRateHistoryBackfill(inputOf());

        seen.push(status);

        return status;
      });

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((status) => status.state === 'complete')).toBe(true);
    });

    it('still settles the reader that stays when the one that started the run unmounts', async () => {
      const run = queueRun();
      const starter = await mountReader();
      const stayer = await mountReader();

      await starter.unmount();
      await settle(() => run.resolve(COMPLETE));

      expect(stayer.result.current).toEqual(COMPLETE);
    });
  });

  describe('a span or a currency set that moves while a run is pending', () => {
    it('starts run B from the whole span for a wider span, and drops the resolve of run A', async () => {
      const runA = queueRun();
      const runB = queueRun();
      const first = await mountReader();
      const second = await mountReader({ spanStart: WIDER_SPAN_START });

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);
      expect(argumentOfCall(0)).toMatchObject({
        earliestDay: SPAN_START,
        lastBackfilledDay: STORED_DAY,
      });
      expect(argumentOfCall(1)).toMatchObject({
        earliestDay: WIDER_SPAN_START,
        lastBackfilledDay: null,
      });

      await settle(() => runA.resolve(COMPLETE));

      expect(first.result.current.state).toBe('loading');
      expect(second.result.current.state).toBe('loading');

      await settle(() => runB.resolve({ state: 'complete', lastDay: LATER }));

      expect(first.result.current).toEqual({ state: 'complete', lastDay: LATER });
      expect(second.result.current).toEqual({ state: 'complete', lastDay: LATER });
    });

    it('drops the rejection of run A once run B started, and applies the settle of run B', async () => {
      const runA = queueRun();
      const runB = queueRun();

      const first = await mountReader();
      const second = await mountReader({ spanStart: WIDER_SPAN_START });

      await settle(() => runA.reject(new Error('network down')));

      expect(first.result.current.state).toBe('loading');
      expect(second.result.current.state).toBe('loading');

      await settle(() => runB.resolve(COMPLETE));

      expect(first.result.current).toEqual(COMPLETE);
      expect(second.result.current).toEqual(COMPLETE);
    });

    it('starts nothing for a later now once run B has the wider span', async () => {
      queueRun();
      queueRun();
      await mountReader();

      const second = await mountReader({ spanStart: WIDER_SPAN_START });

      await second.rerender(inputOf({ spanStart: WIDER_SPAN_START, now: LATER }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    });

    it('starts run B for another set of currencies, and drops the settle of run A', async () => {
      const runA = queueRun();
      const runB = queueRun();
      const first = await mountReader();
      const second = await mountReader({ holdings: [{ currency: 'EUR' }] });

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);

      await settle(() => runA.resolve(COMPLETE));

      expect(first.result.current.state).toBe('loading');
      expect(second.result.current.state).toBe('loading');

      await settle(() => runB.resolve({ state: 'complete', lastDay: LATER }));

      expect(first.result.current).toEqual({ state: 'complete', lastDay: LATER });
    });

    it('starts nothing for a narrower span on the same currencies, and keeps the status', async () => {
      queueRun();
      await mountReader();

      const narrower = await mountReader({ spanStart: 12 * DAY_MS });

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
      expect(narrower.result.current.state).toBe('loading');
    });

    it('stops running once two readers that held different currencies hold one set', async () => {
      queueRun();
      queueRun();
      queueRun();
      const fresh = await mountReader({ holdings: [...TWO_CURRENCIES] });
      const older = await mountReader({ holdings: [{ currency: 'USD' }] });

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);

      await older.rerender(inputOf({ holdings: [...TWO_CURRENCIES] }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(3);

      await older.rerender(inputOf({ holdings: [...TWO_CURRENCIES], now: LATER }));
      await fresh.rerender(inputOf({ holdings: [...TWO_CURRENCIES], now: LATER }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(3);
    });
  });

  describe('a run that fails', () => {
    it.each([
      ['rejects', (run: Run) => run.reject(new Error('network down'))],
      ['resolves failed', (run: Run) => run.resolve(FAILED)],
    ])('retries the span for a later now once a run %s', async (_title, fail) => {
      const run = queueRun();
      const reader = await mountReader();

      await settle(() => fail(run));

      expect(reader.result.current.state).toBe('failed');
      expect(mockRunBackfill).toHaveBeenCalledTimes(1);

      await reader.rerender(inputOf({ now: LATER }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    });

    it('retries a failed wider span from the whole span', async () => {
      const first = queueRun();
      const second = queueRun();
      const reader = await mountReader();

      await settle(() => first.resolve(COMPLETE));
      await reader.rerender(inputOf({ spanStart: WIDER_SPAN_START }));
      await settle(() => second.resolve(FAILED));

      await reader.rerender(inputOf({ spanStart: WIDER_SPAN_START, now: LATER }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(3);
      expect(argumentOfCall(2)).toMatchObject({
        earliestDay: WIDER_SPAN_START,
        lastBackfilledDay: null,
      });
    });

    it('retries a failed change of currencies', async () => {
      const first = queueRun();
      const second = queueRun();
      const reader = await mountReader();

      await settle(() => first.resolve(COMPLETE));
      await reader.rerender(inputOf({ holdings: [{ currency: 'EUR' }] }));
      await settle(() => second.resolve(FAILED));

      await reader.rerender(inputOf({ holdings: [{ currency: 'EUR' }], now: LATER }));

      expect(mockRunBackfill).toHaveBeenCalledTimes(3);
    });
  });

  describe('when the readers leave', () => {
    it('forgets the run once every reader is gone, drops its settle, and starts a run for a new mount', async () => {
      const run = queueRun();
      const reader = await mountReader();

      await reader.unmount();
      await act(async () => {});
      await settle(() => run.resolve(COMPLETE));

      // A reader that waits for fresh data starts no run, so what it shows is the store's own.
      const waiting = await mountReader({ transactionsFresh: false });

      expect(waiting.result.current).toEqual({ state: 'idle', lastDay: null });

      await waiting.unmount();
      await act(async () => {});
      await mountReader();

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    });

    it('keeps its state when one reader leaves and another mounts in one commit', async () => {
      const run = queueRun();
      const screen = await render(readerOf('first'));

      await screen.rerender(readerOf('second'));

      expect(mockRunBackfill).toHaveBeenCalledTimes(1);
      expect(shown?.state).toBe('loading');

      await settle(() => run.resolve(COMPLETE));

      expect(shown).toEqual(COMPLETE);
    });

    it('starts exactly one run for the next mount after a layout switch emptied the tree', async () => {
      const run = queueRun();
      const screen = await render(readerOf('first'));

      await settle(() => run.resolve(COMPLETE));
      await screen.rerender(createElement(Fragment));
      await act(async () => {});
      await screen.rerender(readerOf('second'));

      expect(mockRunBackfill).toHaveBeenCalledTimes(2);
    });
  });

  it('runs from the span start whatever shared date range is picked', async () => {
    const { result } = await renderHook(() => ({
      range: useDateRangeSelection(NOW),
      status: useRateHistoryBackfill(inputOf()),
    }));

    await act(async () => {
      result.current.range.applyDateRange(new Date(DAY_MS), new Date(2 * DAY_MS));
    });

    expect(mockRunBackfill).toHaveBeenCalledTimes(1);
    expect(argumentOfCall(0)).toMatchObject({ earliestDay: SPAN_START, today: NOW });
  });
});
