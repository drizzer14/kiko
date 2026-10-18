import type { HoldingRow } from '@kiko/db';
import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';
import type { Currency } from '@kiko/currency/currency';

import type { ProviderBalance, SyncTarget } from '../provider';

import { setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceDeps, binanceProvider } from './binance.provider';

// The credentials module imports react-native-keychain, whose native binding is
// absent under Jest; `readCredentials` is injected, so the stub only needs the
// ACCESSIBLE enum its module-scope hardened-options constant reads at load.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
}));

const NOW = 1_704_326_400_000;
const target: SyncTarget = { accountId: 'acc-lists', holdings: [] };
const OVERSIZED = '90071992.54740992';

type Row = [asset: string, amount: string];

type World = {
  spot?: Row[];
  funding?: Row[] | 'fails';
  flexible?: Row[];
  locked?: Row[] | 'fails';
  stored?: Record<string, unknown>;
};

const failedRead = async (): Promise<never> => {
  throw new Error('Binance request failed: 401');
};

// A deps set over one stored state: the patches a read returns apply to it as the repo applies
// them (the account's institution gate is pinned over a real database in
// `run-crypto-sync.first-connect.real-sqlite.test.ts`).
const worldOf = ({ spot = [], funding = [], flexible = [], locked = [], stored = {} }: World) => {
  let text: string = JSON.stringify({ version: 1, walks: {}, ...stored });

  const deps: BinanceDeps = {
    fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
    now: () => NOW,
    readCredentials: async () => ({ apiKey: 'api-key-fixture', secret: 'secret-fixture' }),
    fetchAccount: async () => ({
      balances: spot.map(([asset, free]) => ({ asset, free, locked: '0' })),
      uid: null,
    }),
    fetchFundingAsset: async () =>
      funding === 'fails'
        ? failedRead()
        : funding.map(([asset, free]) => ({
            asset,
            free,
            locked: '0',
            freeze: '0',
            withdrawing: '0',
          })),
    fetchFlexiblePosition: async () => ({
      rows: flexible.map(([asset, totalAmount]) => ({ asset, totalAmount })),
      total: flexible.length,
    }),
    fetchLockedPosition: async () =>
      locked === 'fails'
        ? failedRead()
        : { rows: locked.map(([asset, amount]) => ({ asset, amount })), total: locked.length },
  };

  const apply = (patches: readonly ExchangeStatePatch[] = []): void => {
    text = exchangeStatePatched(text, patches) ?? text;
  };

  const lists = () => {
    const state = parseExchangeState(text);

    if (state.kind === 'malformed') {
      throw new Error('the stored state should read');
    }

    return { untracked: state.untrackedCoins, oversized: state.oversizedCoins };
  };

  return { deps, lists, apply };
};

const run = async (world: World, from: SyncTarget = target) => {
  const read = worldOf(world);
  const { balances, exchangeState } = await binanceProvider.fetchBalances(read.deps, from);

  read.apply(exchangeState);

  return { balances, exchangeState, ...read };
};

const writtenKeys = (balances: ProviderBalance[]) =>
  balances.map(({ metadataKey }) => metadataKey).sort();

const heldBalance = (
  binanceAsset: string,
  currency: Currency,
  balanceMinorUnits: number,
): HoldingRow =>
  ({
    id: `h-${binanceAsset}`,
    accountId: target.accountId,
    type: 'crypto_asset',
    currency,
    balanceMinorUnits,
    metadata: { binanceAsset, syncedAt: 0 },
  }) as unknown as HoldingRow;

const holding = (...held: HoldingRow[]): SyncTarget => ({
  accountId: target.accountId,
  holdings: held,
});

// A failed wallet read logs its skip through the one console sink.
let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('binanceProvider — the not-tracked balance list', () => {
  it('lists PEPE as not tracked', async () => {
    const { lists } = await run({ spot: [['PEPE', '1000']] });

    expect(lists().untracked.balance).toEqual(['PEPE']);
  });

  it('lists each coin of every wallet once, sorted', async () => {
    const { lists } = await run({
      spot: [['PEPE', '1']],
      funding: [
        ['PEPE', '2'],
        ['ABC', '3'],
      ],
      flexible: [['XYZ', '4']],
      locked: [['XYZ', '5']],
    });

    expect(lists().untracked.balance).toEqual(['ABC', 'PEPE', 'XYZ']);
  });

  it('lists no coin whose balance is zero', async () => {
    const { lists } = await run({ spot: [['PEPE', '0.00000000']], funding: [['ABC', '0']] });

    expect(lists().untracked.balance).toEqual([]);
  });

  it('lists no tracked coin, a curated one or a fiat code Binance quotes', async () => {
    const { lists } = await run({
      spot: [
        ['BTC', '1'],
        ['USDT', '5'],
      ],
      funding: [['EUR', '5']],
    });

    expect(lists().untracked.balance).toEqual([]);
  });

  it('lists INR as not tracked, though it is a fiat code of the app', async () => {
    const { lists } = await run({ spot: [['INR', '100']], funding: [['SCR', '5']] });

    expect(lists().untracked.balance).toEqual(['INR', 'SCR']);
  });

  it('hides an LD receipt token of a tracked coin and still lists LDO', async () => {
    const { lists } = await run({
      spot: [
        ['LDBTC', '0.1'],
        ['LDUSDT', '2'],
        ['LDO', '3'],
      ],
    });

    expect(lists().untracked.balance).toEqual(['LDO']);
  });

  it('hides an LD receipt token of a coin held in Simple Earn', async () => {
    const { lists } = await run({
      spot: [
        ['LDPEPE', '7'],
        ['LDABC', '1'],
      ],
      locked: [['PEPE', '7']],
    });

    expect(lists().untracked.balance).toEqual(['LDABC', 'PEPE']);
  });

  it('never reads an amount that is no number as a balance', async () => {
    const { lists } = await run({ spot: [['PEPE', 'x']], funding: [['ABC', '1e-8']] });

    expect(lists().untracked.balance).toEqual([]);
  });
});

describe('binanceProvider — the balance lists after a read', () => {
  const stored = {
    untrackedCoins: { balance: ['PEPE'], history: ['XYZ'] },
    oversizedCoins: { balance: ['ETH'], history: ['BTC'] },
  };

  it('a good balance read replaces only the balance list', async () => {
    const { lists } = await run({ spot: [['ABC', '1']], stored });

    expect(lists().untracked).toEqual({ balance: ['ABC'], history: ['XYZ'] });
    expect(lists().oversized).toEqual({ balance: [], history: ['BTC'] });
  });

  it('a good balance read that finds nothing clears the balance list', async () => {
    const { lists } = await run({ stored });

    expect(lists().untracked.balance).toEqual([]);
  });

  it('returns both balance lists as the patches of one write', async () => {
    const { exchangeState } = await run({ spot: [['ABC', '1']] });

    expect(exchangeState).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'balance', tickers: ['ABC'] },
      { kind: 'coinList', coins: 'oversizedCoins', list: 'balance', tickers: [] },
    ]);
  });

  it.each([
    ['Funding', { funding: 'fails' as const }],
    ['Earn', { locked: 'fails' as const }],
  ])('a balance read with a failed wallet keeps both balance lists (%s)', async (_, failing) => {
    const { exchangeState, lists } = await run({ spot: [['ABC', '1']], stored, ...failing });

    expect(exchangeState).toBeUndefined();
    expect(lists().untracked.balance).toEqual(['PEPE']);
    expect(lists().oversized.balance).toEqual(['ETH']);
  });

  it('an account cooling down returns no lists', async () => {
    const cooling: SyncTarget = { accountId: 'acc-lists-cooldown', holdings: [] };
    setBinanceCooldownUntil(cooling.accountId, NOW + 60_000);

    const { exchangeState } = await run({ spot: [['ABC', '1']], stored }, cooling);

    expect(exchangeState).toBeUndefined();
  });
});

describe('binanceProvider — an amount above the safe bound or malformed', () => {
  it('an oversized Spot coin skips only that coin; the other coins still write', async () => {
    const { balances, lists } = await run({
      spot: [
        ['BTC', OVERSIZED],
        ['USDT', '10'],
      ],
    });

    expect(writtenKeys(balances)).toEqual(['USDT']);
    expect(lists().oversized.balance).toEqual(['BTC']);
  });

  it('skips the write of a coin above the safe bound and lists it as oversized', async () => {
    const { balances, lists } = await run(
      { spot: [['ETH', OVERSIZED]] },
      holding(heldBalance('ETH', 'ETH', 500)),
    );

    expect(writtenKeys(balances)).toEqual(['BTC']);
    expect(lists().oversized.balance).toEqual(['ETH']);
  });

  it('lists a coin whose amounts add beyond the safe bound', async () => {
    const { balances, lists } = await run({
      spot: [['USDT', '10']],
      flexible: [['ETH', '90071992.54740991']],
      locked: [['ETH', '0.00000001']],
    });

    expect(writtenKeys(balances)).toEqual(['BTC', 'USDT']);
    expect(lists().oversized.balance).toEqual(['ETH']);
  });

  it('skips a coin whose amount is no number and lists it, the others still write', async () => {
    const { balances, lists } = await run({
      spot: [
        ['USDT', 'x'],
        ['ETH', '1'],
      ],
    });

    expect(writtenKeys(balances)).toEqual(['BTC', 'ETH']);
    expect(lists().oversized.balance).toEqual(['USDT']);
  });

  it.each([
    [
      'Funding',
      { funding: [['USDT', OVERSIZED] as Row, ['ETH', '1'] as Row] },
      ['BTC', 'ETH:funding'],
    ],
    ['Earn', { flexible: [['USDT', OVERSIZED] as Row, ['ETH', '1'] as Row] }, ['BTC', 'ETH:earn']],
  ])('skips only the oversized coin of the %s wallet', async (_, wallet, expected) => {
    const { balances, lists } = await run(wallet);

    expect(writtenKeys(balances)).toEqual(expected);
    expect(lists().oversized.balance).toEqual(['USDT']);
  });

  it('never zeroes a held coin it refused, in any wallet', async () => {
    const { balances } = await run(
      {
        spot: [['USDT', OVERSIZED]],
        funding: [['USDT', 'x']],
        flexible: [['USDT', OVERSIZED]],
      },
      holding(
        heldBalance('USDT', 'USDT', 1_000_000),
        heldBalance('USDT:funding', 'USDT', 1_000_000),
        heldBalance('USDT:earn', 'USDT', 1_000_000),
      ),
    );

    expect(writtenKeys(balances)).toEqual(['BTC']);
  });

  it('replaces the oversized balance list on a read that refuses nothing', async () => {
    const { lists } = await run({
      spot: [['ETH', '1']],
      stored: { oversizedCoins: { balance: ['ETH'], history: [] } },
    });

    expect(lists().oversized.balance).toEqual([]);
  });
});
