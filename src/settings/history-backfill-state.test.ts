import {
  EMPTY_HISTORY_BACKFILL_STATE,
  parseHistoryBackfillState,
  serializeHistoryBackfillState,
} from './history-backfill-state';

describe('parseHistoryBackfillState', () => {
  it('reads nothing as the empty state', () => {
    expect(parseHistoryBackfillState(null)).toEqual(EMPTY_HISTORY_BACKFILL_STATE);
  });

  it('reads a plain coin code as the cursor', () => {
    expect(parseHistoryBackfillState('XRP')).toEqual({ cursor: 'XRP', settled: {} });
  });

  it('reads the cursor and the settled marks from stored JSON', () => {
    const stored = JSON.stringify({
      cursor: 'ETH',
      settled: { EUR: { start: 10, firstDay: 20 }, XRP: { start: 10, firstDay: null } },
    });

    expect(parseHistoryBackfillState(stored)).toEqual({
      cursor: 'ETH',
      settled: { EUR: { start: 10, firstDay: 20 }, XRP: { start: 10, firstDay: null } },
    });
  });

  it('reads the check day of an empty mark and leaves it out when it is not a number', () => {
    const stored = JSON.stringify({
      cursor: null,
      settled: {
        EUR: { start: 10, firstDay: null, checkedOn: 30 },
        USD: { start: 10, firstDay: null, checkedOn: 'x' },
      },
    });

    expect(parseHistoryBackfillState(stored).settled).toEqual({
      EUR: { start: 10, firstDay: null, checkedOn: 30 },
      USD: { start: 10, firstDay: null },
    });
  });

  it('reads a mark with no first day as an empty answer', () => {
    const stored = JSON.stringify({ cursor: null, settled: { EUR: { start: 10 } } });

    expect(parseHistoryBackfillState(stored).settled).toEqual({
      EUR: { start: 10, firstDay: null },
    });
  });

  it('drops what it cannot read: bad JSON, a non-currency key, a mark that is not a record', () => {
    expect(parseHistoryBackfillState('{not json')).toEqual(EMPTY_HISTORY_BACKFILL_STATE);
    expect(
      parseHistoryBackfillState(
        JSON.stringify({
          cursor: 7,
          settled: {
            EUR: 'soon',
            XYZ: { start: 5, firstDay: 6 },
            GBP: { start: 'x', firstDay: 1 },
            USD: { start: 6, firstDay: 7 },
          },
        }),
      ),
    ).toEqual({ cursor: null, settled: { USD: { start: 6, firstDay: 7 } } });
  });
});

describe('serializeHistoryBackfillState', () => {
  it('stores the empty state as null', () => {
    expect(serializeHistoryBackfillState(EMPTY_HISTORY_BACKFILL_STATE)).toBeNull();
  });

  it('round-trips a cursor with settled marks', () => {
    const state = {
      cursor: 'BNB',
      settled: { EUR: { start: 5, firstDay: 8 }, USD: { start: 9, firstDay: null } },
    } as const;

    expect(parseHistoryBackfillState(serializeHistoryBackfillState(state))).toEqual(state);
  });

  it('keeps a settled mark without a cursor', () => {
    const state = { cursor: null, settled: { EUR: { start: 5, firstDay: 6 } } } as const;

    expect(parseHistoryBackfillState(serializeHistoryBackfillState(state))).toEqual(state);
  });
});
