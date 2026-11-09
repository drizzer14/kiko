import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';

const FLOOR = 1_000;

const logKinds = (...kinds: string[]): ExchangeStatePatch => ({ kind: 'logKinds', kinds });

const denseSpan = (series: 'log' | 'fundingLedger', start: number | null): ExchangeStatePatch => ({
  kind: 'denseSpans',
  series,
  start,
});

const textOf = (rest: Record<string, unknown>): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest });

const storedOf = (text: string | undefined): unknown => JSON.parse(text ?? 'null');

describe('the log kinds patch', () => {
  it('adds kinds as a sorted union, with no duplicates', () => {
    const text = textOf({ logKinds: ['transfer'] });

    expect(
      storedOf(
        exchangeStatePatched(text, [
          logKinds('settlement', 'transfer'),
          logKinds('interest', 'settlement'),
        ]),
      ),
    ).toEqual({ version: 1, walks: {}, logKinds: ['interest', 'settlement', 'transfer'] });
  });

  it('starts the list in a state that has none, and in a column nothing wrote yet', () => {
    expect(storedOf(exchangeStatePatched(textOf({}), [logKinds('transfer')]))).toEqual({
      version: 1,
      walks: {},
      logKinds: ['transfer'],
    });
    expect(storedOf(exchangeStatePatched(null, [logKinds('transfer')]))).toEqual({
      version: 1,
      walks: {},
      logKinds: ['transfer'],
    });
  });

  it('starts from none when the stored value is no list, and keeps every other key as stored', () => {
    const text = textOf({ logKinds: 'x', trades: { symbols: {} }, newer: [1] });

    expect(storedOf(exchangeStatePatched(text, [logKinds('transfer')]))).toEqual({
      version: 1,
      walks: {},
      logKinds: ['transfer'],
      trades: { symbols: {} },
      newer: [1],
    });
  });

  it('writes nothing in a state that is malformed', () => {
    expect(exchangeStatePatched('not json', [logKinds('transfer')])).toBeUndefined();
  });
});

describe('the dense spans patch', () => {
  it('sets the start of one series and keeps the other', () => {
    const text = textOf({ denseSpans: { fundingLedger: 9 } });

    expect(storedOf(exchangeStatePatched(text, [denseSpan('log', 5)]))).toEqual({
      version: 1,
      walks: {},
      denseSpans: { fundingLedger: 9, log: 5 },
    });
  });

  it('replaces the start of a series that already has one', () => {
    const text = textOf({ denseSpans: { log: 5 } });

    expect(storedOf(exchangeStatePatched(text, [denseSpan('log', 8)]))).toEqual({
      version: 1,
      walks: {},
      denseSpans: { log: 8 },
    });
  });

  it('drops the entry of a series with a null start, and the other stays', () => {
    const text = textOf({ denseSpans: { log: 5, fundingLedger: 9 } });

    expect(storedOf(exchangeStatePatched(text, [denseSpan('log', null)]))).toEqual({
      version: 1,
      walks: {},
      denseSpans: { fundingLedger: 9 },
    });
  });

  it('leaves the text it was before the first entry once the last entry goes', () => {
    const text = textOf({ untrackedCoins: { balance: ['PEPE'], history: [] } });

    const marked = exchangeStatePatched(text, [denseSpan('log', 5)]);

    expect(marked).not.toBe(text);
    expect(exchangeStatePatched(marked ?? '', [denseSpan('log', null)])).toBe(text);
  });

  it('starts from none when the stored value is no record', () => {
    expect(
      storedOf(exchangeStatePatched(textOf({ denseSpans: [5] }), [denseSpan('log', 5)])),
    ).toEqual({
      version: 1,
      walks: {},
      denseSpans: { log: 5 },
    });
  });
});

describe('the convert marks in a walk patch', () => {
  it('are written to their own walk entry beside the marks it holds, and nowhere else', () => {
    const text = textOf({ walks: { convert: { cursor: 4 }, capital: { cursor: 9 } } });
    const passOwed = [{ start: 1, end: 3, kind: 'point' as const, since: 7 }];

    expect(
      storedOf(
        exchangeStatePatched(text, [
          { kind: 'walk', walkId: 'convert', field: 'pageIndex', value: 3 },
          { kind: 'walk', walkId: 'convert', field: 'passOwed', value: passOwed },
        ]),
      ),
    ).toEqual({
      version: 1,
      walks: { convert: { cursor: 4, pageIndex: 3, passOwed }, capital: { cursor: 9 } },
    });
  });
});

describe('a disconnect', () => {
  it('drops the log kinds, the dense spans and both convert marks, and keeps the floor cursors', () => {
    const text = textOf({
      walks: {
        convert: { cursor: 4_000, pageIndex: 3, passOwed: [{ start: 1, end: 3 }], pending: [] },
        log: { cursor: 5_000, pending: [{ start: 1, end: 3 }], spanHints: { forward: [] } },
      },
      logKinds: ['transfer'],
      denseSpans: { log: 5 },
    });

    expect(storedOf(exchangeStateReset(text, FLOOR))).toEqual({
      version: 1,
      walks: {
        convert: { cursor: FLOOR, pending: [] },
        log: { cursor: FLOOR, pending: [] },
      },
    });
  });
});
