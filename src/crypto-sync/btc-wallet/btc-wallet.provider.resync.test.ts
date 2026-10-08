// A wallet that reconnected under a second address must keep syncing BOTH. Only a real
// engine runs the repo's address-keyed upsert and the disconnect that keeps each
// holding's address, so the whole Connect, Disconnect, Connect, re-sync path is
// exercised here with a fake explorer in place of the network.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { accountsRepo } from '@kiko/accounts';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { runBalanceSync } from '../sync';

import { bitcoinWalletProvider } from './btc-wallet.provider';

const FIRST_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const SECOND_ADDRESS = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';

type StoredBalance = { address: string; balance: number; closed: boolean };

const storedBalances = (): StoredBalance[] =>
  (
    mockDatabase
      .prepare(
        `SELECT json_extract(metadata, '$.walletAddress') AS address,
                balance_minor_units AS balance,
                closed_at IS NOT NULL AS closed
         FROM holdings ORDER BY created_at, id`,
      )
      .all() as { address: string; balance: number; closed: number }[]
  )
    .map(({ address, balance, closed }) => ({ address, balance, closed: closed === 1 }))
    .sort((left, right) => left.address.localeCompare(right.address));

const explorer = (balances: Record<string, number | Error>) => {
  const requested: string[] = [];

  return {
    requested,
    fetchImpl: fetch,
    fetchAddressBalance: async (address: string): Promise<number> => {
      requested.push(address);
      const balance = balances[address];

      if (balance instanceof Error) {
        throw balance;
      }

      return balance;
    },
  };
};

const syncWallet = (deps: ReturnType<typeof explorer>, address?: string) =>
  runBalanceSync(
    bitcoinWalletProvider,
    { ...deps, address },
    { targetAccountId: 'wallet-account' },
  );

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('wallet-account', 'Wallet', 'crypto')")
    .run();
});

describe('a wallet account that reconnected under a second address', () => {
  it('moves both balances on the next re-sync', async () => {
    await syncWallet(explorer({ [FIRST_ADDRESS]: 100_000 }), FIRST_ADDRESS);
    await accountsRepo.disconnect('wallet-account');
    await syncWallet(
      explorer({ [FIRST_ADDRESS]: 100_000, [SECOND_ADDRESS]: 500_000 }),
      SECOND_ADDRESS,
    );

    await syncWallet(explorer({ [FIRST_ADDRESS]: 111_000, [SECOND_ADDRESS]: 777_000 }));

    expect(storedBalances()).toEqual([
      { address: FIRST_ADDRESS, balance: 111_000, closed: false },
      { address: SECOND_ADDRESS, balance: 777_000, closed: false },
    ]);
  });

  it('leaves a holding the user closed untouched and never requests its address', async () => {
    await syncWallet(explorer({ [FIRST_ADDRESS]: 100_000 }), FIRST_ADDRESS);
    await accountsRepo.disconnect('wallet-account');
    mockDatabase.prepare('UPDATE holdings SET closed_at = 1700000000000').run();
    const reconnect = explorer({ [SECOND_ADDRESS]: 500_000 });
    await syncWallet(reconnect, SECOND_ADDRESS);

    const resync = explorer({ [SECOND_ADDRESS]: 777_000 });
    await syncWallet(resync);

    expect(resync.requested).toEqual([SECOND_ADDRESS]);
    expect(storedBalances()).toEqual([
      { address: FIRST_ADDRESS, balance: 100_000, closed: true },
      { address: SECOND_ADDRESS, balance: 777_000, closed: false },
    ]);
  });

  // The closed holding is the only one that stores an address, so a re-sync has
  // nothing to track and must finish quietly, not fail with "no address stored".
  it('re-syncs nothing when its only stored address was closed and reconnected', async () => {
    await syncWallet(explorer({ [FIRST_ADDRESS]: 100_000 }), FIRST_ADDRESS);
    await accountsRepo.disconnect('wallet-account');
    mockDatabase.prepare('UPDATE holdings SET closed_at = 1700000000000').run();
    await syncWallet(explorer({ [FIRST_ADDRESS]: 100_000 }), FIRST_ADDRESS);

    const resync = explorer({ [FIRST_ADDRESS]: 777_000 });

    await expect(syncWallet(resync)).resolves.toEqual({ syncedHoldings: 0 });
    expect(resync.requested).toEqual([]);
    expect(storedBalances()).toEqual([{ address: FIRST_ADDRESS, balance: 100_000, closed: true }]);
  });

  it('writes nothing when one of the addresses fails to fetch', async () => {
    await syncWallet(explorer({ [FIRST_ADDRESS]: 100_000 }), FIRST_ADDRESS);
    await accountsRepo.disconnect('wallet-account');
    await syncWallet(
      explorer({ [FIRST_ADDRESS]: 100_000, [SECOND_ADDRESS]: 500_000 }),
      SECOND_ADDRESS,
    );

    await expect(
      syncWallet(
        explorer({
          [FIRST_ADDRESS]: 111_000,
          [SECOND_ADDRESS]: new Error('Block explorer request failed: 429'),
        }),
      ),
    ).rejects.toThrow('Block explorer request failed: 429');

    expect(storedBalances()).toEqual([
      { address: FIRST_ADDRESS, balance: 100_000, closed: false },
      { address: SECOND_ADDRESS, balance: 500_000, closed: false },
    ]);
  });
});
