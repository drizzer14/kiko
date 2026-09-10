import { Money } from '../../currency/money';
import type { HoldingRow } from '../../db/schema';
import type { BalanceProvider, ProviderBalance } from '../provider';

import {
  type BinanceAccount,
  type BinanceBalance,
  type BinanceFlexiblePosition,
  type BinanceFundingAsset,
  type BinanceLockedPosition,
  type FetchAccountOptions,
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';
import { type BinanceCredentials, readCredentials } from './binance.credentials';

type WalletFetch<Body> = (
  apiKey: string,
  secret: string,
  options?: FetchAccountOptions,
) => Promise<Body>;

export type BinanceDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: () => Promise<BinanceCredentials | undefined>;
  fetchAccount: WalletFetch<BinanceAccount>;
  fetchFundingAsset: WalletFetch<BinanceFundingAsset[]>;
  fetchFlexiblePosition: WalletFetch<BinanceFlexiblePosition>;
  fetchLockedPosition: WalletFetch<BinanceLockedPosition>;
};

export const defaultBinanceDeps: BinanceDeps = {
  fetchImpl: fetch,
  now: () => Date.now(),
  readCredentials,
  fetchAccount,
  fetchFundingAsset,
  fetchFlexiblePosition,
  fetchLockedPosition,
};

/** The only asset the sync reads; every other asset in every wallet is ignored. */
const BINANCE_ASSET = 'BTC';

/**
 * Match keys stored under `metadata.binanceAsset`, one holding per Binance
 * wallet. Spot REUSES the legacy 'BTC' key that the pre-split single aggregated
 * holding used, so the first post-split sync UPDATES that existing row in place
 * into the Spot holding (matched by `upsertByMetadataKey`) — no orphan, no
 * duplicate. Funding and Earn are new keys, so they are created fresh. Earn is
 * the Flexible + Locked positions COMBINED into one holding.
 */
const SPOT_KEY = BINANCE_ASSET;
const FUNDING_KEY = 'BTC:funding';
const EARN_KEY = 'BTC:earn';

/**
 * Default display names for the holdings a first sync creates. 'Binance' and its
 * wallet names are brand terms, read the same in every language (the same
 * convention as `providerDisplayName` and the prior single 'Binance BTC'
 * holding), and each name is user-editable after creation — the upsert never
 * rewrites it, so a transitioned Spot holding keeps its existing (possibly
 * user-edited) name rather than being renamed to 'Binance Spot'.
 */
const SPOT_HOLDING_NAME = 'Binance Spot';
const FUNDING_HOLDING_NAME = 'Binance Funding';
const EARN_HOLDING_NAME = 'Binance Earn';

/**
 * The pre-split default name of the single aggregated holding. The Spot balance
 * carries it as `renameFromDefault`, so the upsert relabels a still-default
 * legacy holding to 'Binance Spot' on the first post-split sync while leaving a
 * user-edited name untouched (see `renameFromDefault` in `../provider`).
 */
const LEGACY_HOLDING_NAME = 'Binance BTC';

/**
 * Sum a set of decimal-string BTC amounts into satoshis. Each string is
 * converted on its own and added as `Money`, so no float addition happens before
 * rounding — a value already validated as finite by `isFiniteAmount`.
 */
const sumSatoshis = (amounts: string[]): number =>
  amounts.reduce(
    (total, amount) => total.add(Money.fromMajor(BINANCE_ASSET, Number(amount))),
    Money.of(BINANCE_ASSET, 0),
  ).minorUnits;

/**
 * Whether one amount is a usable decimal STRING. `Number('x')` is `NaN`, which
 * would flow straight into a `notNull` integer column, so a non-finite value is
 * rejected before it is summed.
 */
const isFiniteAmount = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Number(value));

const isBTCEntry = (entry: unknown): boolean =>
  typeof entry === 'object' &&
  entry !== null &&
  (entry as { asset?: unknown }).asset === BINANCE_ASSET;

/**
 * Whether the parsed `/api/v3/account` body carries a usable balances array.
 *
 * `fetchAccount` returns the parsed 200 body with no runtime shape check, and a
 * missing/`(?? [])` balances array turned a malformed payload into a 0-satoshi
 * balance WRITTEN OVER the stored BTC holding — a fabricated number
 * indistinguishable from a real zero. Binance answers a throttled or
 * misconfigured request with a 200-plus-error-object often enough that this is a
 * real path, not a hypothetical one.
 */
const hasBalances = (body: unknown): body is { balances: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'balances' in body &&
  Array.isArray((body as { balances: unknown }).balances);

/** Whether a Simple Earn body carries a usable rows array (same guard rationale). */
const hasRows = (body: unknown): body is { rows: unknown[] } =>
  typeof body === 'object' &&
  body !== null &&
  'rows' in body &&
  Array.isArray((body as { rows: unknown }).rows);

/** Spot BTC satoshis: `free + locked` per BTC balance. Throws on a malformed body. */
const spotSatoshis = (account: BinanceAccount): number => {
  if (!hasBalances(account)) {
    throw new Error('Binance account response did not contain a balances array');
  }

  const btcBalances = account.balances.filter((balance): balance is BinanceBalance =>
    isBTCEntry(balance),
  );

  for (const balance of btcBalances) {
    if (!isFiniteAmount(balance.free) || !isFiniteAmount(balance.locked)) {
      throw new Error('Binance balance contained a non-numeric free/locked amount');
    }
  }

  return btcBalances.reduce((sum, balance) => sum + sumSatoshis([balance.free, balance.locked]), 0);
};

/** Funding BTC satoshis: `free + locked + freeze + withdrawing` per BTC row. */
const fundingSatoshis = (assets: BinanceFundingAsset[]): number => {
  if (!Array.isArray(assets)) {
    throw new Error('Binance funding response was not an array');
  }

  const btcAssets = assets.filter((asset): asset is BinanceFundingAsset => isBTCEntry(asset));

  for (const asset of btcAssets) {
    const fields = [asset.free, asset.locked, asset.freeze, asset.withdrawing];
    if (fields.some((field) => !isFiniteAmount(field))) {
      throw new Error('Binance funding balance contained a non-numeric amount');
    }
  }

  return btcAssets.reduce(
    (sum, asset) => sum + sumSatoshis([asset.free, asset.locked, asset.freeze, asset.withdrawing]),
    0,
  );
};

/**
 * Simple Earn BTC satoshis. A flexible position holds its BTC in `totalAmount`, a
 * locked one in `amount`; the caller names which field, the parse is otherwise
 * identical.
 */
const positionSatoshis = (
  body: { rows: unknown[] },
  amountField: 'totalAmount' | 'amount',
): number => {
  if (!hasRows(body)) {
    throw new Error('Binance simple-earn response did not contain a rows array');
  }

  const btcRows = body.rows.filter((row): row is Record<string, unknown> => isBTCEntry(row));

  for (const row of btcRows) {
    if (!isFiniteAmount(row[amountField])) {
      throw new Error('Binance simple-earn position contained a non-numeric amount');
    }
  }

  // `isFiniteAmount` above already proved each value is a finite decimal string,
  // so the cast is safe and no runtime `String()` conversion is needed.
  return btcRows.reduce((sum, row) => sum + sumSatoshis([row[amountField] as string]), 0);
};

/**
 * Run one non-Spot wallet's read and parse. Any failure — a missing API-key
 * permission, a throttle, a malformed body — SKIPS that wallet only (logging
 * which one) and returns `null`, so a single wallet never breaks the whole sync
 * AND its holding is left untouched rather than clobbered with a fabricated 0.
 * `null` (skipped) is deliberately distinct from `0` (a genuine empty wallet).
 * Spot is deliberately NOT wrapped: its failure must fail the sync.
 */
const walletSatoshis = async (
  wallet: string,
  satoshis: () => Promise<number>,
): Promise<number | null> => {
  try {
    return await satoshis();
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) one wallet's failure (a missing API-key permission, a throttle) must skip only that wallet, not break the whole Binance sync; log which one so a device log shows what was dropped.
    console.warn(`[binance sync] skipped the ${wallet} wallet`, error);

    return null;
  }
};

/** The `binanceAsset` match keys already present among a target's holdings. */
const existingBinanceKeys = (holdings: HoldingRow[]): Set<string> => {
  const keys = new Set<string>();
  for (const holding of holdings) {
    const key = (holding.metadata as { binanceAsset?: unknown } | null)?.binanceAsset;
    if (typeof key === 'string') {
      keys.add(key);
    }
  }
  return keys;
};

/**
 * Append one non-Spot wallet's holding to the batch, applying the skip/zero
 * rules that keep the split correct without cluttering the grid:
 * - read FAILED (`satoshis === null`): omit — leave any existing holding at its
 *   last-good balance (never overwrite it with a fabricated 0).
 * - read succeeded, > 0: write (the upsert creates or updates the holding).
 * - read succeeded, 0, holding ALREADY exists: write 0 — a wallet the user
 *   emptied must be zeroed, not left stale at its previous balance.
 * - read succeeded, 0, no holding yet: omit — a never-used wallet creates no
 *   empty holding the user cannot easily delete.
 */
const appendWallet = (
  batch: ProviderBalance[],
  satoshis: number | null,
  metadataKey: string,
  name: string,
  existingKeys: Set<string>,
): void => {
  if (satoshis === null) {
    return;
  }
  if (satoshis === 0 && !existingKeys.has(metadataKey)) {
    return;
  }
  batch.push({ currency: 'BTC', balanceMinorUnits: satoshis, metadataKey, name });
};

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  kind: 'exchange',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps, target) => {
    const credentials = await deps.readCredentials();

    if (credentials === undefined) {
      throw new Error('No Binance credentials stored; connect Binance before syncing');
    }

    const { apiKey, secret } = credentials;
    const options: FetchAccountOptions = { fetchImpl: deps.fetchImpl, now: deps.now };

    // Spot MUST succeed — its failure fails the whole Binance sync. It is the
    // connection's proof of life and the split's anchor, so it is ALWAYS written
    // (a genuine zero included), and it reuses the legacy key so the pre-split
    // aggregated holding is updated in place into the Spot holding.
    const spot = spotSatoshis(await deps.fetchAccount(apiKey, secret, options));
    const balances: ProviderBalance[] = [
      {
        currency: 'BTC',
        balanceMinorUnits: spot,
        metadataKey: SPOT_KEY,
        name: SPOT_HOLDING_NAME,
        // Relabel a legacy aggregated holding still named 'Binance BTC' to
        // 'Binance Spot' on the first post-split sync; a user rename is preserved.
        renameFromDefault: LEGACY_HOLDING_NAME,
      },
    ];

    const existingKeys = existingBinanceKeys(target.holdings);

    // Funding: its own holding; a failure skips only it.
    const funding = await walletSatoshis('funding', async () =>
      fundingSatoshis(await deps.fetchFundingAsset(apiKey, secret, options)),
    );
    appendWallet(balances, funding, FUNDING_KEY, FUNDING_HOLDING_NAME, existingKeys);

    // Earn: Flexible + Locked COMBINED into ONE holding. A failure in EITHER read
    // skips the WHOLE Earn holding — importing one side alone would silently
    // UNDER-COUNT the user's Earn balance — so both reads sit inside one
    // `walletSatoshis` guard rather than two.
    const earn = await walletSatoshis('earn', async () => {
      const flexible = positionSatoshis(
        await deps.fetchFlexiblePosition(apiKey, secret, options),
        'totalAmount',
      );
      const locked = positionSatoshis(
        await deps.fetchLockedPosition(apiKey, secret, options),
        'amount',
      );
      return flexible + locked;
    });
    appendWallet(balances, earn, EARN_KEY, EARN_HOLDING_NAME, existingKeys);

    return balances;
  },
};
