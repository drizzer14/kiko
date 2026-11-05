import { notImportedEntry, parseExchangeState } from '../walk-state';

import {
  balanceNotesOf,
  balanceSyncedAtOf,
  keyExpiryOf,
  notImportedCountsOf,
  oversizedCoinsOf,
  untrackedCoinsOf,
} from './history-status';

const stateWith = (lists: Record<string, unknown>) =>
  parseExchangeState(JSON.stringify({ version: 1, walks: {}, ...lists }));

const tracksNothingButCurated = (ticker: string): boolean =>
  ['USDC', 'DAI', 'BTC'].includes(ticker);

describe('untrackedCoinsOf', () => {
  it('shows the sorted union of the balance and history lists without duplicates', () => {
    const state = stateWith({
      untrackedCoins: { balance: ['PEPE', 'ABC'], history: ['PEPE', 'XYZ'] },
    });

    expect(untrackedCoinsOf(state, () => false)).toEqual(['ABC', 'PEPE', 'XYZ']);
  });

  it('leaves out a ticker that is a curated code now', () => {
    const state = stateWith({
      untrackedCoins: { balance: ['PEPE', 'USDC'], history: ['XYZ', 'DAI'] },
    });

    expect(untrackedCoinsOf(state, tracksNothingButCurated)).toEqual(['PEPE', 'XYZ']);
  });

  it('lists a ticker the exchange does not track, whatever else the app knows it as', () => {
    const state = stateWith({ untrackedCoins: { balance: ['INR'], history: [] } });

    expect(untrackedCoinsOf(state, tracksNothingButCurated)).toEqual(['INR']);
  });

  it('lists nothing for a state with no list, and for one that cannot be read', () => {
    expect(untrackedCoinsOf(stateWith({}), () => false)).toEqual([]);
    expect(untrackedCoinsOf(parseExchangeState('not json'), () => false)).toEqual([]);
  });

  it('reads the other list when one of the two is malformed', () => {
    const state = stateWith({ untrackedCoins: { balance: 'PEPE', history: ['XYZ'] } });

    expect(untrackedCoinsOf(state, () => false)).toEqual(['XYZ']);
  });
});

describe('oversizedCoinsOf', () => {
  it('shows the sorted union of the balance and history lists without duplicates', () => {
    const state = stateWith({
      oversizedCoins: { balance: ['ETH', 'BTC'], history: ['BTC', 'USDT'] },
    });

    expect(oversizedCoinsOf(state)).toEqual(['BTC', 'ETH', 'USDT']);
  });

  it('keeps a curated code, which every oversized ticker is', () => {
    const state = stateWith({ oversizedCoins: { balance: ['BTC'], history: [] } });

    expect(oversizedCoinsOf(state)).toEqual(['BTC']);
  });

  it('lists nothing for a state that cannot be read', () => {
    expect(oversizedCoinsOf(parseExchangeState('not json'))).toEqual([]);
  });

  it('never reads the not-tracked lists', () => {
    const state = stateWith({ untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] } });

    expect(oversizedCoinsOf(state)).toEqual([]);
  });
});

describe('balanceSyncedAtOf', () => {
  it('reads the stamp of the last good balance read', () => {
    expect(balanceSyncedAtOf(stateWith({ balanceSyncedAt: 1_700_000_000_000 }))).toBe(
      1_700_000_000_000,
    );
  });

  it('reads nothing for a state with no stamp, an unreadable stamp or a state that is lost', () => {
    expect(balanceSyncedAtOf(stateWith({}))).toBeUndefined();
    expect(balanceSyncedAtOf(stateWith({ balanceSyncedAt: 'x' }))).toBeUndefined();
    expect(balanceSyncedAtOf(parseExchangeState('not json'))).toBeUndefined();
  });
});

describe('keyExpiryOf', () => {
  it('reads the end of the key the last good key read stored', () => {
    const keyExpiry = {
      expiredAtMs: 1_800_000_000_000,
      deadlineDay: 90,
      readAtMs: 1_700_000_000_000,
    };

    expect(keyExpiryOf(stateWith({ keyExpiry }))).toEqual(keyExpiry);
  });

  it('reads nothing for a state with no entry, an unreadable entry or a state that is lost', () => {
    expect(keyExpiryOf(stateWith({}))).toBeUndefined();
    expect(keyExpiryOf(stateWith({ keyExpiry: 'x' }))).toBeUndefined();
    expect(keyExpiryOf(parseExchangeState('not json'))).toBeUndefined();
  });
});

describe('balanceNotesOf', () => {
  it('lists the borrowed coins of every wallet once, sorted', () => {
    const state = stateWith({
      balanceNotes: {
        unified: { borrowed: ['USDT', 'BTC'] },
        fund: { borrowed: ['BTC', 'ETH'] },
      },
    });

    expect(balanceNotesOf(state)).toEqual({
      borrowed: ['BTC', 'ETH', 'USDT'],
      openOrder: [],
      refusedCoins: [],
      refusedWallets: [],
      notReadWallets: [],
    });
  });

  it('lists the open-order coins of every wallet once, sorted, apart from the borrowed coins', () => {
    const state = stateWith({
      balanceNotes: {
        unified: { borrowed: ['LTC'], openOrder: ['USDT', 'BTC'] },
        fund: { openOrder: ['BTC', 'ETH'] },
      },
    });

    expect(balanceNotesOf(state)).toEqual({
      borrowed: ['LTC'],
      openOrder: ['BTC', 'ETH', 'USDT'],
      refusedCoins: [],
      refusedWallets: [],
      notReadWallets: [],
    });
  });

  it('lists the refused coins of every wallet once, sorted, apart from the other coins', () => {
    const state = stateWith({
      balanceNotes: {
        unified: { borrowed: ['LTC'], refusedCoins: ['USDT', 'BTC'] },
        fund: { refusedCoins: ['BTC', 'ETH'], openOrder: ['SOL'] },
      },
    });

    expect(balanceNotesOf(state)).toEqual({
      borrowed: ['LTC'],
      openOrder: ['SOL'],
      refusedCoins: ['BTC', 'ETH', 'USDT'],
      refusedWallets: [],
      notReadWallets: [],
    });
  });

  it('names each wallet the key was refused for, in the order of the wallet keys', () => {
    const state = stateWith({
      balanceNotes: { unified: { refused: true }, fund: { refused: true }, earn: {} },
    });

    expect(balanceNotesOf(state).refusedWallets).toEqual(['fund', 'unified']);
  });

  it('names each wallet that was not read, apart from the refused ones, in the order of the wallet keys', () => {
    const state = stateWith({
      balanceNotes: {
        unified: { notRead: true },
        fund: { refused: true, notRead: true },
        other: { notRead: true },
        quiet: {},
      },
    });

    expect(balanceNotesOf(state).notReadWallets).toEqual(['fund', 'other', 'unified']);
    expect(balanceNotesOf(state).refusedWallets).toEqual(['fund']);
  });

  it('reads no note for a state with none, an unreadable entry or a state that is lost', () => {
    const none = {
      borrowed: [],
      openOrder: [],
      refusedCoins: [],
      refusedWallets: [],
      notReadWallets: [],
    };

    expect(balanceNotesOf(stateWith({}))).toEqual(none);
    expect(balanceNotesOf(stateWith({ balanceNotes: 'x' }))).toEqual(none);
    expect(balanceNotesOf(parseExchangeState('not json'))).toEqual(none);
  });
});

describe('notImportedCountsOf', () => {
  it('counts the entries per kind in the order of the kind list, leaving out a kind with none', () => {
    const state = stateWith({
      notImported: [
        notImportedEntry('fiat-unrecognized', 'f1', 5),
        notImportedEntry('convert-unrecognized', 'c1', 1),
        notImportedEntry('p2p-sale', 's1', 2),
        notImportedEntry('convert-unrecognized', 'c2', 3),
        notImportedEntry('convert-unrecognized', 'c3', 4),
      ],
    });

    expect(notImportedCountsOf(state)).toEqual([
      { kind: 'p2p-sale', count: 1 },
      { kind: 'convert-unrecognized', count: 3 },
      { kind: 'fiat-unrecognized', count: 1 },
    ]);
  });

  it('counts a known kind and leaves out an entry of a kind this build does not know', () => {
    const state = stateWith({ notImported: ['bybit-x:1:2', 'p2p-sale:1:2'] });

    expect(notImportedCountsOf(state)).toEqual([{ kind: 'p2p-sale', count: 1 }]);
  });

  it('counts nothing for a state with no entry', () => {
    expect(notImportedCountsOf(stateWith({}))).toEqual([]);
    expect(notImportedCountsOf(stateWith({ notImported: [] }))).toEqual([]);
  });

  it('counts nothing for a state that cannot be read', () => {
    expect(notImportedCountsOf(parseExchangeState('not json'))).toEqual([]);
  });

  it('counts nothing for a list that is no list', () => {
    expect(notImportedCountsOf(stateWith({ notImported: 'p2p-sale:1:2' }))).toEqual([]);
  });
});
