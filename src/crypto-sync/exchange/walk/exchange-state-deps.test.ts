const mockRows = jest.fn(
  async (_accountId: string): Promise<{ exchangeState: string | null }[]> => [],
);
const mockPatch = jest.fn(
  async (_accountId: string, _exchangeId: string, _patches: readonly unknown[]) => undefined,
);

jest.mock('@kiko/sync-state/sync-state.repo', () => ({
  syncStateRepo: {
    getQuery: (accountId: string) => mockRows(accountId),
    patchExchangeState: (accountId: string, exchangeId: string, patches: readonly unknown[]) =>
      mockPatch(accountId, exchangeId, patches),
  },
}));

import { exchangeStateDepsOf, readWalkMarks, walkMarkWriterOf } from './exchange-state-deps';

describe('exchangeStateDepsOf', () => {
  beforeEach(() => {
    mockRows.mockReset();
    mockPatch.mockReset();
  });

  it('reads the stored text of the account state row', async () => {
    mockRows.mockResolvedValue([{ exchangeState: '{"version":1,"walks":{}}' }]);

    expect(await exchangeStateDepsOf('binance').readExchangeState('acc-1')).toBe(
      '{"version":1,"walks":{}}',
    );
    expect(mockRows).toHaveBeenCalledWith('acc-1');
  });

  it.each([
    ['has no state row', []],
    ['never wrote the column', [{ exchangeState: null }]],
  ])('reads null when the account %s', async (_label, rows) => {
    mockRows.mockResolvedValue(rows);

    expect(await exchangeStateDepsOf('binance').readExchangeState('acc-1')).toBeNull();
  });

  it('writes the patches through the repo, gated on the exchange it was made for', async () => {
    const patches = [{ kind: 'tradesRotation', value: 3 }] as const;

    await exchangeStateDepsOf('binance').patchExchangeState('acc-1', patches);

    expect(mockPatch).toHaveBeenCalledWith('acc-1', 'binance', patches);
  });
});

describe('readWalkMarks', () => {
  const readOf = (text: string | null) => ({ readExchangeState: async () => text });

  it('reads the marks of the walk from the state', async () => {
    const text = JSON.stringify({ version: 1, walks: { pay: { cursor: 5, rescan: 3 } } });

    expect(await readWalkMarks(readOf(text), 'acc-1', 'pay')).toMatchObject({
      cursor: 5,
      rescan: 3,
    });
  });

  it('reads the empty marks of a walk the state holds no entry of', async () => {
    const text = JSON.stringify({ version: 1, walks: { pay: { cursor: 5 } } });

    expect(await readWalkMarks(readOf(text), 'acc-1', 'earn')).toMatchObject({
      cursor: null,
      rescan: null,
      pending: [],
    });
  });

  it.each([
    ['no state at all', null, { cursor: null, rescan: null }],
    ['an empty state', '{"version":1,"walks":{}}', { cursor: null, rescan: null }],
  ])('reads the empty marks for %s', async (_label, text, marks) => {
    expect(await readWalkMarks(readOf(text), 'acc-1', 'capital')).toMatchObject(marks);
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['a state of another version', '{"version":2,"walks":{}}'],
    ['a state with no walks', '{"version":1}'],
  ])('rejects for %s: the run never starts a walk on it', async (_label, text) => {
    await expect(readWalkMarks(readOf(text), 'acc-1', 'capital')).rejects.toMatchObject({
      name: 'BinanceWalkStop',
      code: 'exchange-state-malformed',
    });
  });
});

describe('walkMarkWriterOf', () => {
  it('writes the marks it is given to the entry of its own walk, in one call', async () => {
    const patchExchangeState = jest.fn(async () => undefined);

    await walkMarkWriterOf(
      { patchExchangeState },
      'acc-1',
      'transfer',
    )([
      { field: 'pending', value: [{ start: 1, end: 2 }] },
      { field: 'cursor', value: 9 },
    ]);

    expect(patchExchangeState).toHaveBeenCalledTimes(1);
    expect(patchExchangeState).toHaveBeenCalledWith('acc-1', [
      { kind: 'walk', walkId: 'transfer', field: 'pending', value: [{ start: 1, end: 2 }] },
      { kind: 'walk', walkId: 'transfer', field: 'cursor', value: 9 },
    ]);
  });
});
