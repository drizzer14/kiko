import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';
import { parseExchangeState } from './walk-state';

const FLOOR = 1_000;

const held = (count: number): ExchangeStatePatch => ({ kind: 'fundingHeld', count });

const leftOut: ExchangeStatePatch = { kind: 'fundingLeftOut' };

const textOf = (rest: Record<string, unknown>): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest });

const storedOf = (text: string | undefined): unknown => JSON.parse(text ?? 'null');

describe('the Funding held count patch', () => {
  it('sets the count in a state that has none, and replaces a stored count', () => {
    expect(storedOf(exchangeStatePatched(textOf({}), [held(2)]))).toEqual({
      version: 1,
      walks: {},
      fundingHeld: 2,
    });
    expect(storedOf(exchangeStatePatched(textOf({ fundingHeld: 5 }), [held(2)]))).toEqual({
      version: 1,
      walks: {},
      fundingHeld: 2,
    });
  });

  it('drops the key at a count of none, so the text is the one before the first count', () => {
    const text = textOf({ untrackedCoins: { balance: ['PEPE'], history: [] } });

    const counted = exchangeStatePatched(text, [held(2)]);

    expect(counted).not.toBe(text);
    expect(exchangeStatePatched(counted ?? '', [held(0)])).toBe(text);
  });

  it('keeps every other key as stored, and writes nothing in a state that is malformed', () => {
    expect(
      storedOf(exchangeStatePatched(textOf({ fundingHeld: 'x', newer: [1] }), [held(1)])),
    ).toEqual({ version: 1, walks: {}, fundingHeld: 1, newer: [1] });
    expect(exchangeStatePatched('not json', [held(1)])).toBeUndefined();
  });
});

describe('the Funding left-out patch', () => {
  it('sets the flag, and a second patch changes nothing', () => {
    const marked = exchangeStatePatched(textOf({}), [leftOut]);

    expect(storedOf(marked)).toEqual({ version: 1, walks: {}, fundingLeftOut: true });
    expect(exchangeStatePatched(marked ?? '', [leftOut])).toBe(marked);
  });

  it('repairs a stored flag that is no true, and keeps every other key as stored', () => {
    expect(
      storedOf(exchangeStatePatched(textOf({ fundingLeftOut: 'x', newer: [1] }), [leftOut])),
    ).toEqual({ version: 1, walks: {}, fundingLeftOut: true, newer: [1] });
  });

  it('writes nothing in a state that is malformed', () => {
    expect(exchangeStatePatched('not json', [leftOut])).toBeUndefined();
  });
});

describe('a Binance state text under the Funding patches', () => {
  const binanceText = JSON.stringify({
    version: 1,
    walks: { capital: { cursor: 5_000, rescan: 4_000, pending: [{ start: 10, end: 20 }] } },
    untrackedCoins: { balance: ['PEPE'], history: ['PEPE'] },
    notImported: ['p2p-sale:1:2'],
  });

  it('is written back unchanged by every write a Binance walk makes, and reads with no count or flag', () => {
    expect(
      exchangeStatePatched(binanceText, [
        { kind: 'walk', walkId: 'capital', field: 'cursor', value: 5_000 },
        { kind: 'notImported', entries: ['p2p-sale:1:2'] },
      ]),
    ).toBe(binanceText);
    expect(parseExchangeState(binanceText)).toMatchObject({
      fundingHeld: 0,
      fundingLeftOut: false,
      unreadable: [],
    });
  });
});

describe('a disconnect', () => {
  it('drops the Funding count and flag, and keeps the floor cursor of the ledger walk', () => {
    const text = textOf({
      walks: { fundingLedger: { cursor: 9_000, pending: [], cursorReadAt: 9_100 } },
      fundingHeld: 2,
      fundingLeftOut: true,
    });

    expect(storedOf(exchangeStateReset(text, FLOOR))).toEqual({
      version: 1,
      walks: { fundingLedger: { cursor: FLOOR, pending: [] } },
    });
  });
});
