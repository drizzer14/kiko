import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  exchangeStateReset,
} from './exchange-state-patch';
import { parseExchangeState } from './walk-state';

type Notes = { borrowed: string[]; earnLeftOut?: number };

const notesPatch = (
  wallets: Record<string, Notes>,
  refused: string[] = [],
): ExchangeStatePatch => ({ kind: 'balanceNotes', wallets, refused });

const stateWith = (balanceNotes?: unknown, rest: Record<string, unknown> = {}): string =>
  JSON.stringify({ version: 1, walks: {}, ...rest, balanceNotes });

const storedOf = (text: string | undefined): Record<string, unknown> => JSON.parse(text ?? 'null');

const notesOf = (text: string | undefined): unknown => storedOf(text).balanceNotes;

const patched = (seed: unknown, ...patches: ExchangeStatePatch[]): unknown =>
  notesOf(exchangeStatePatched(stateWith(seed), patches));

describe('the balance notes patch', () => {
  it('writes the notes of a wallet that read into a state that has none', () => {
    const text = JSON.stringify({ version: 1, walks: {} });

    expect(
      notesOf(
        exchangeStatePatched(text, [
          notesPatch({ unified: { borrowed: ['USDT', 'BTC'], earnLeftOut: 2 } }),
        ]),
      ),
    ).toEqual({ unified: { borrowed: ['BTC', 'USDT'], earnLeftOut: 2 } });
  });

  it('writes into a column nothing wrote yet', () => {
    expect(
      notesOf(exchangeStatePatched(null, [notesPatch({ fund: { borrowed: ['ETH'] } })])),
    ).toEqual({ fund: { borrowed: ['ETH'] } });
  });

  it('writes each coin of a wallet once', () => {
    expect(patched(undefined, notesPatch({ unified: { borrowed: ['ETH', 'ETH'] } }))).toEqual({
      unified: { borrowed: ['ETH'] },
    });
  });

  it('replaces the stored notes of a wallet that read, its refused mark too', () => {
    const seed = { unified: { borrowed: ['ETH'], earnLeftOut: 3, refused: true } };

    expect(patched(seed, notesPatch({ unified: { borrowed: ['BTC'] } }))).toEqual({
      unified: { borrowed: ['BTC'] },
    });
  });

  it('writes an empty entry for a wallet that read with nothing to note', () => {
    const seed = { unified: { borrowed: ['ETH'] }, fund: { borrowed: ['BTC'] } };

    expect(patched(seed, notesPatch({ unified: { borrowed: [], earnLeftOut: 0 } }))).toEqual({
      unified: {},
      fund: { borrowed: ['BTC'] },
    });
  });

  it('keeps the stored notes of a wallet the read did not reach', () => {
    const seed = {
      unified: { borrowed: ['ETH'] },
      fund: { borrowed: ['BTC'], earnLeftOut: 1 },
    };

    expect(patched(seed, notesPatch({ unified: { borrowed: [] } }))).toEqual({
      unified: {},
      fund: { borrowed: ['BTC'], earnLeftOut: 1 },
    });
  });

  it('marks a wallet whose read was refused and keeps its other notes', () => {
    const seed = { fund: { borrowed: ['BTC'], earnLeftOut: 1 } };

    expect(patched(seed, notesPatch({ unified: { borrowed: [] } }, ['fund']))).toEqual({
      unified: {},
      fund: { borrowed: ['BTC'], earnLeftOut: 1, refused: true },
    });
  });

  it('marks a refused wallet that has no stored notes', () => {
    expect(patched(undefined, notesPatch({}, ['fund']))).toEqual({ fund: { refused: true } });
  });

  it('keeps the refused mark of a wallet that failed again, whatever the failure', () => {
    const seed = { fund: { borrowed: ['BTC'], refused: true } };

    expect(patched(seed, notesPatch({ unified: { borrowed: [] } }))).toEqual({
      unified: {},
      fund: { borrowed: ['BTC'], refused: true },
    });
  });

  it('keeps the notes under a wallet this build never names', () => {
    const seed = { margin: { borrowed: ['LTC'] } };

    expect(patched(seed, notesPatch({ unified: { borrowed: [] } }))).toEqual({
      margin: { borrowed: ['LTC'] },
      unified: {},
    });
  });

  it.each([
    ['a list', ['x']],
    ['a number', 7],
    ['text', 'x'],
    ['null', null],
  ])('starts from nothing when the stored notes are %s', (_title, seed) => {
    expect(patched(seed, notesPatch({ fund: { borrowed: ['ETH'] } }))).toEqual({
      fund: { borrowed: ['ETH'] },
    });
  });

  it('starts a refused wallet from nothing when its stored entry is no record', () => {
    expect(patched({ fund: 'x' }, notesPatch({}, ['fund']))).toEqual({ fund: { refused: true } });
  });

  it('leaves every other part of the state as stored', () => {
    const rest = {
      walks: { pay: { cursor: 7 } },
      untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
      oversizedCoins: { balance: ['SHIB'], history: [], balanceByWallet: { unified: ['SHIB'] } },
      balanceSyncedAt: 1_000,
      notImported: ['p2p-sale:1:2'],
      laterBuildKey: { kept: true },
    };
    const before = JSON.parse(stateWith(undefined, rest));
    const after = storedOf(
      exchangeStatePatched(stateWith(undefined, rest), [
        notesPatch({ unified: { borrowed: ['ETH'] } }),
      ]),
    );

    expect(after).toEqual({ ...before, balanceNotes: { unified: { borrowed: ['ETH'] } } });
  });

  it('writes nothing into a state whose top level is malformed', () => {
    expect(
      exchangeStatePatched('{"version":2,"walks":{}}', [notesPatch({ fund: { borrowed: [] } })]),
    ).toBeUndefined();
  });

  // The parse names only the keys it reads, so a build that reads none of the notes (every build
  // before this key existed) reads a state that holds them as one without them. A key no build
  // names shows the mechanism.
  describe('a build that does not name a key', () => {
    const withLaterKey = stateWith(undefined, { laterBuildKey: { fund: { refused: true } } });

    it('reads the state as it reads one without the key, with nothing unreadable', () => {
      expect(parseExchangeState(withLaterKey)).toEqual(parseExchangeState(stateWith()));
      expect(parseExchangeState(withLaterKey)).toMatchObject({ kind: 'parsed', unreadable: [] });
    });

    it('writes another patch with the notes still in the column', () => {
      const withNotes = stateWith({ fund: { refused: true } });
      const text = exchangeStatePatched(withNotes, [{ kind: 'balanceSyncedAt', value: 5 }]);

      expect(storedOf(text)).toEqual({
        version: 1,
        walks: {},
        balanceNotes: { fund: { refused: true } },
        balanceSyncedAt: 5,
      });
    });
  });

  it('is dropped by a disconnect, which keeps the walks only', () => {
    const text = stateWith({ fund: { refused: true } }, { walks: { capital: { cursor: 9 } } });

    expect(storedOf(exchangeStateReset(text, 1_000))).toEqual({
      version: 1,
      walks: { capital: { cursor: 1_000 } },
    });
  });
});
