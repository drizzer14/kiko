import { parseExchangeState } from '../walk-state';

import { oversizedCoinsOf, untrackedCoinsOf } from './history-status';

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
