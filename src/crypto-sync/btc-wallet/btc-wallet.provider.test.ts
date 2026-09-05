import type { HoldingRow } from '../../db/schema';
import type { SyncTarget } from '../provider';

import { fetchAddressBalance } from './btc-wallet.client';
import {
  type BitcoinWalletDeps,
  bitcoinWalletProvider,
  defaultBitcoinWalletDeps,
} from './btc-wallet.provider';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const holdingWith = (metadata: unknown): HoldingRow => ({
  id: 'h-1',
  accountId: 'acc-1',
  name: 'BTC Wallet',
  type: 'crypto_asset',
  currency: 'BTC',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  metadata,
  sortOrder: 0,
  closedAt: null,
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
    expect(bitcoinWalletProvider.kind).toBe('wallet');
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
      { currency: 'BTC', balanceMinorUnits: 12_345_678, metadataKey: ADDRESS, name: 'BTC Wallet' },
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

  it('falls back to the stored walletAddress of the target holdings on a re-sync', async () => {
    const deps = makeDeps(42);

    const balances = await bitcoinWalletProvider.fetchBalances(
      deps,
      target([holdingWith({ iban: 'UA1' }), holdingWith({ walletAddress: ADDRESS, syncedAt: 1 })]),
    );

    expect(deps.fetchAddressBalance).toHaveBeenCalledWith(ADDRESS, deps.fetchImpl);
    expect(balances[0].balanceMinorUnits).toBe(42);
  });

  it('throws before fetching when no address is given and none is stored', async () => {
    const deps = makeDeps();

    await expect(
      bitcoinWalletProvider.fetchBalances(deps, target([holdingWith(null)])),
    ).rejects.toThrow(/connect a wallet/i);
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
