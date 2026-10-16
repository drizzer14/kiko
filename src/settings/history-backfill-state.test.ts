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
    expect(parseHistoryBackfillState('XRP')).toEqual({ cursor: 'XRP', settledFrom: {} });
  });

  it('reads the cursor and the settled span starts from stored JSON', () => {
    const stored = JSON.stringify({ cursor: 'ETH', settledFrom: { EUR: 1_700_000_000_000 } });

    expect(parseHistoryBackfillState(stored)).toEqual({
      cursor: 'ETH',
      settledFrom: { EUR: 1_700_000_000_000 },
    });
  });

  it('drops what it cannot read: a bad JSON text, a non-currency key, a non-number day', () => {
    expect(parseHistoryBackfillState('{not json')).toEqual(EMPTY_HISTORY_BACKFILL_STATE);
    expect(
      parseHistoryBackfillState(
        JSON.stringify({ cursor: 7, settledFrom: { EUR: 'soon', XYZ: 5, USD: 6 } }),
      ),
    ).toEqual({ cursor: null, settledFrom: { USD: 6 } });
  });
});

describe('serializeHistoryBackfillState', () => {
  it('stores the empty state as null', () => {
    expect(serializeHistoryBackfillState(EMPTY_HISTORY_BACKFILL_STATE)).toBeNull();
  });

  it('round-trips a cursor with settled span starts', () => {
    const state = { cursor: 'BNB', settledFrom: { EUR: 5, USD: 9 } } as const;

    expect(parseHistoryBackfillState(serializeHistoryBackfillState(state))).toEqual(state);
  });

  it('keeps a settled span start without a cursor', () => {
    const state = { cursor: null, settledFrom: { EUR: 5 } } as const;

    expect(parseHistoryBackfillState(serializeHistoryBackfillState(state))).toEqual(state);
  });
});
