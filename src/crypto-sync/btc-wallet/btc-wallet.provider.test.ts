import type { HoldingRow } from '@kiko/db';

import type { SyncTarget } from '../provider';

import {
  type BitcoinWalletDeps,
  bitcoinWalletProvider,
  defaultBitcoinWalletDeps,
} from './btc-wallet.provider';
import { fetchAddressBalance } from './btc-wallet.client';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OTHER_ADDRESS = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const THIRD_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

const holdingWith = (metadata: unknown, closedAt: number | null = null): HoldingRow => ({
  id: 'h-1',
  accountId: 'acc-1',
  name: 'BTC Wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  syncedBalanceMinorUnits: null,
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata,
  sortOrder: 0,
  closedAt,
  createdAt: 0,
});

const target = (holdings: HoldingRow[] = []): SyncTarget => ({ accountId: 'acc-1', holdings });

const makeDeps = (
  satoshis = 12_345_678,
): BitcoinWalletDeps & { fetchAddressBalance: jest.Mock } => ({
  fetchImpl: (async () => ({ ok: true })) as unknown as typeof fetch,
  fetchAddressBalance: jest.fn(async () => satoshis),
});

describe('bitcoinWalletProvider', () => {
  it('is the btc_wallet provider keyed on walletAddress', () => {
    expect(bitcoinWalletProvider.id).toBe('btc_wallet');
    expect(bitcoinWalletProvider.metadataField).toBe('walletAddress');
  });

  it('wires the real explorer client and global fetch as its default deps', () => {
    expect(defaultBitcoinWalletDeps.fetchAddressBalance).toBe(fetchAddressBalance);
    expect(defaultBitcoinWalletDeps.fetchImpl).toBe(fetch);
    expect(defaultBitcoinWalletDeps.address).toBeUndefined();
  });

  it('fetches the connect-time address and returns one BTC balance keyed on that address', async () => {
    const deps = makeDeps(12_345_678);

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: ADDRESS },
      target(),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances).toEqual([
      { balanceMinorUnits: 12_345_678, metadataKey: ADDRESS, name: 'BTC Wallet' },
    ]);
  });

  it('trims surrounding whitespace from a pasted address', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: `  ${ADDRESS}\n` },
      target(),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances[0].metadataKey).toBe(ADDRESS);
  });

  it('reads the stored walletAddress of a single open holding on a re-sync', async () => {
    const deps = makeDeps(42);

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([holdingWith({ iban: 'UA1' }), holdingWith({ walletAddress: ADDRESS, syncedAt: 1 })]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledTimes(1);
    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances).toEqual([{ balanceMinorUnits: 42, metadataKey: ADDRESS, name: 'BTC Wallet' }]);
  });

  it('re-syncs every stored address, one balance each, in holding order', async () => {
    const satoshisByAddress: Record<string, number> = { [ADDRESS]: 100, [OTHER_ADDRESS]: 200 };
    const deps = makeDeps();
    deps.fetchAddressBalance.mockImplementation(
      async (address: string) => satoshisByAddress[address],
    );

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([
        holdingWith({ walletAddress: ADDRESS }),
        holdingWith({ walletAddress: OTHER_ADDRESS }),
      ]),
    );

    expect(deps.fetchAddressBalance.mock.calls.map(([address]) => address)).toEqual([
      ADDRESS,
      OTHER_ADDRESS,
    ]);
    expect(balances).toEqual([
      { balanceMinorUnits: 100, metadataKey: ADDRESS, name: 'BTC Wallet' },
      { balanceMinorUnits: 200, metadataKey: OTHER_ADDRESS, name: 'BTC Wallet' },
    ]);
  });

  it('puts the connect-time address first, then every stored address', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: OTHER_ADDRESS },
      target([holdingWith({ walletAddress: ADDRESS })]),
    );

    expect(balances.map(({ metadataKey }) => metadataKey)).toEqual([OTHER_ADDRESS, ADDRESS]);
  });

  it('fetches an address once when the connect-time address is already stored', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: `  ${ADDRESS} ` },
      target([holdingWith({ walletAddress: ADDRESS })]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledTimes(1);
    expect(balances).toHaveLength(1);
  });

  it('fetches an address once when two holdings store it', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([holdingWith({ walletAddress: ADDRESS }), holdingWith({ walletAddress: ADDRESS })]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledTimes(1);
    expect(balances).toHaveLength(1);
  });

  it('skips a closed holding on a re-sync and sends its address nowhere', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([
        holdingWith({ walletAddress: ADDRESS }, 1_700_000_000_000),
        holdingWith({ walletAddress: OTHER_ADDRESS }),
      ]),
    );

    expect(deps.fetchAddressBalance.mock.calls.map(([address]) => address)).toEqual([
      OTHER_ADDRESS,
    ]);
    expect(balances.map(({ metadataKey }) => metadataKey)).toEqual([OTHER_ADDRESS]);
  });

  it('still fetches a connect-time address that belongs to a closed holding', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      { ...deps, address: ADDRESS },
      target([holdingWith({ walletAddress: ADDRESS }, 1_700_000_000_000)]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledTimes(1);
    expect(balances.map(({ metadataKey }) => metadataKey)).toEqual([ADDRESS]);
  });

  it('skips a holding that stores no wallet address', async () => {
    const deps = makeDeps();

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([
        holdingWith({ iban: 'UA1' }),
        holdingWith(null),
        holdingWith({ walletAddress: ADDRESS }),
      ]),
    );

    expect(balances.map(({ metadataKey }) => metadataKey)).toEqual([ADDRESS]);
  });

  it('requests one address at a time', async () => {
    const deps = makeDeps();
    let inFlight = 0;
    let highestInFlight = 0;
    deps.fetchAddressBalance.mockImplementation(async () => {
      inFlight += 1;
      highestInFlight = Math.max(highestInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;

      return 1;
    });

    await bitcoinWalletProvider.fetchBalances(
      deps,
      target([
        holdingWith({ walletAddress: ADDRESS }),
        holdingWith({ walletAddress: OTHER_ADDRESS }),
        holdingWith({ walletAddress: THIRD_ADDRESS }),
      ]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledTimes(3);
    expect(highestInFlight).toBe(1);
  });

  it('rejects when any one address fails, so the caller gets no partial list', async () => {
    const deps = makeDeps();
    deps.fetchAddressBalance.mockImplementation(async (address: string) => {
      if (address === OTHER_ADDRESS) {
        throw new Error('Block explorer request failed: 429');
      }

      return 1;
    });

    await expect(
      bitcoinWalletProvider.fetchBalances(
        deps,
        target([
          holdingWith({ walletAddress: ADDRESS }),
          holdingWith({ walletAddress: OTHER_ADDRESS }),
        ]),
      ),
    ).rejects.toThrow('Block explorer request failed: 429');
  });

  it('rejects before any fetch when a stored address is no longer valid', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances(
        deps,
        target([
          holdingWith({ walletAddress: ADDRESS }),
          holdingWith({ walletAddress: 'not valid' }),
        ]),
      ),
    ).rejects.toThrow('Invalid BTC address');
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });

  it('throws before fetching when no address is given and none is stored', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances(deps, target([holdingWith(null)])),
    ).rejects.toThrow(/connect a wallet/i);
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });

  it('returns nothing and fetches nothing when the only stored address belongs to a closed holding', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances(
        deps,
        target([holdingWith({ walletAddress: ADDRESS }, 1_700_000_000_000)]),
      ),
    ).resolves.toEqual([]);
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });

  it('rejects an obviously malformed address before any fetch', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances({ ...deps, address: 'not an address' }, target()),
    ).rejects.toThrow('Invalid BTC address');
    expect(deps.fetchAddressBalance).not.toHaveBeenCalled();
  });
});
