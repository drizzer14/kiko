import { identity } from 'fnts';
import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { logFailure } from '@kiko/diagnostics';
import { curatedCoins } from '@kiko/currency/coins';
import { type Currency, isCrypto } from '@kiko/currency/currency';
import type { ExchangeStatePatch } from '@kiko/crypto-sync/exchange/walk-state';
import either, { bifold, bifoldMap, type Either, isLeft, left, right } from 'fnts/either';
import { type AmountError, exchangeMinorUnits } from '@kiko/crypto-sync/exchange/amounts';
import { compareDecimal, decimalFromJsonNumber, normalizeDecimal } from '@kiko/currency/decimal';

import type { BalanceProvider, ProviderBalance } from '../provider';

import {
  type BinanceAccount,
  BINANCE_ASSET,
  BinanceRateLimitError,
  type BinanceFlexiblePosition,
  type BinanceFundingAsset,
  type BinanceLockedPosition,
  type FetchAccountOptions,
  fetchAccount,
  fetchFlexiblePosition,
  fetchFundingAsset,
  fetchLockedPosition,
} from './binance.client';
import {
  type BinanceWallet,
  binanceKeyOf,
  coinHoldingName,
  holdingKeyOf,
  partsOfHoldingKey,
  PREVIOUS_BTC_HOLDING_NAMES,
} from './binance.holding-keys';
import { binanceTickerOf, isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

type WalletFetch<Body> = (
  apiKey: string,
  secret: string,
  options?: FetchAccountOptions,
) => Promise<Body>;

export type BinanceDeps = {
  fetchImpl: typeof fetch;
  now: () => number;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
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

/**
 * An amount as exact decimal text: the string as Binance sent it, or a JSON number expanded
 * without a float re-parse. Anything else is no amount.
 */
const amountText = (value: unknown): string | undefined =>
  match(value)
    .with(P.string, identity)
    .with(P.number, (number) => decimalFromJsonNumber(number) ?? undefined)
    .otherwise(() => undefined);

const amountMinorUnits = (currency: Currency, value: unknown): Either<AmountError, number> =>
  foldMap(maybe(amountText(value)), (text) => exchangeMinorUnits(currency, text, 'balance')) ??
  left('amount-malformed');

/**
 * Sum amounts as exact integer minor units of `currency`. Each is parsed on its own, so no float
 * sits between the text and the stored value, and a sum past the safe integer is refused, never
 * truncated.
 */
const sumAmounts = (
  currency: Currency,
  amounts: readonly unknown[],
): Either<AmountError, number> => {
  let total = 0;

  for (const amount of amounts) {
    const units = amountMinorUnits(currency, amount);

    if (isLeft(units)) {
      return units;
    }

    const exact: number = bifold(units);
    total += exact;

    if (!Number.isSafeInteger(total)) {
      return left('amount-too-large');
    }
  }

  return right(total);
};

type CoinBalances = ReadonlyMap<Currency, number>;

/**
 * What one wallet's read found. `refused` holds a tracked coin whose amounts are malformed or
 * add past the safe integer: such a coin is never written, and never zeroed either.
 * `untracked` holds each asset the app does not track that has a balance. `assets` holds every
 * asset the read named, whatever its amount.
 */
type WalletRead = {
  balances: CoinBalances;
  refused: ReadonlySet<Currency>;
  untracked: readonly string[];
  assets: ReadonlySet<string>;
};

type AmountEntry = { asset: unknown; amounts: readonly unknown[] };

/** One entry per row object, with the named fields of its amounts; a non-object is no entry. */
const entriesOf = (rows: readonly unknown[], fields: readonly string[]): AmountEntry[] =>
  rows
    .filter(isRecord)
    .map((row) => ({ asset: row.asset, amounts: fields.map((field) => row[field]) }));

const amountsByAsset = (entries: readonly AmountEntry[]): Map<string, unknown[]> => {
  const amounts = new Map<string, unknown[]>();

  for (const entry of entries) {
    if (typeof entry.asset === 'string') {
      amounts.set(entry.asset, [...(amounts.get(entry.asset) ?? []), ...entry.amounts]);
    }
  }

  return amounts;
};

/** Whether an amount is a plain decimal above zero; text that is no number is not a balance. */
const isPositiveAmount = (value: unknown): boolean =>
  foldMap(maybe(amountText(value)), (text) =>
    foldMap(maybe(normalizeDecimal(text)), (plain) => compareDecimal(plain, '0') === 1),
  ) ?? false;

/**
 * Each tracked coin's balance in its own minor units. An asset that is not tracked has no scale,
 * so its amounts are never converted: it is listed when one of them is above zero, and a
 * malformed text of it fails nothing. A tracked coin whose amounts are refused is skipped alone.
 */
const readOf = (entries: readonly AmountEntry[]): WalletRead => {
  const amounts = amountsByAsset(entries);
  const balances = new Map<Currency, number>();
  const refused = new Set<Currency>();
  const untracked: string[] = [];

  for (const [asset, assetAmounts] of amounts) {
    if (!isTrackedBinanceAsset(asset)) {
      if (assetAmounts.some(isPositiveAmount)) {
        untracked.push(asset);
      }

      continue;
    }

    const units = sumAmounts(asset, assetAmounts);

    if (isLeft(units)) {
      refused.add(asset);

      continue;
    }

    const exact: number = bifold(units);
    balances.set(asset, exact);
  }

  return { balances, refused, untracked, assets: new Set(amounts.keys()) };
};

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

/** Spot balances: `free + locked` per tracked coin. Throws on a malformed body. */
const spotRead = (account: BinanceAccount): WalletRead => {
  if (!hasBalances(account)) {
    throw new Error(i18n.t('accountDetail.binanceMissingBalancesArray'));
  }

  return readOf(entriesOf(account.balances, ['free', 'locked']));
};

/**
 * `${free}/${locked}` as Binance sent it, per ticker of the Spot body. An entry with a field that
 * is no text is left out, so the trade read sees its coin as `0/0` and counts it as changed.
 */
const spotBalanceTextsOf = (account: BinanceAccount): Record<string, string> =>
  Object.fromEntries(
    (account.balances as readonly unknown[])
      .filter(isRecord)
      .flatMap(({ asset, free, locked }) =>
        typeof asset === 'string' && typeof free === 'string' && typeof locked === 'string'
          ? [[binanceTickerOf(asset), `${free}/${locked}`]]
          : [],
      ),
  );

/** Funding balances: `free + locked + freeze + withdrawing` per tracked coin. */
const fundingRead = (assets: BinanceFundingAsset[]): WalletRead => {
  if (!Array.isArray(assets)) {
    throw new Error(i18n.t('accountDetail.binanceFundingResponseNotArray'));
  }

  return readOf(entriesOf(assets, ['free', 'locked', 'freeze', 'withdrawing']));
};

/**
 * The amount entries of one Simple Earn read. A flexible position holds its amount in
 * `totalAmount`, a locked one in `amount`; the caller names which field, and sums both reads
 * together per coin.
 */
const positionEntries = (
  body: { rows: unknown[] },
  amountField: 'totalAmount' | 'amount',
): AmountEntry[] => {
  if (!hasRows(body)) {
    throw new Error(i18n.t('accountDetail.binanceMissingRowsArray'));
  }

  return entriesOf(body.rows, [amountField]);
};

/**
 * Run one non-Spot wallet's read and parse. Any failure — a missing API-key
 * permission, a throttle, a malformed body — SKIPS that wallet only (logging
 * which one) and returns `null`, so a single wallet never breaks the whole sync
 * AND its holdings are left untouched rather than clobbered with a fabricated 0.
 * `null` (skipped) is deliberately distinct from an empty read (a genuine empty wallet).
 * Spot is deliberately NOT wrapped: its failure must fail the sync.
 */
const walletRead = async (
  wallet: string,
  read: () => Promise<WalletRead>,
): Promise<WalletRead | null> => {
  const attempt = await either<unknown, WalletRead>(read);

  return bifoldMap(
    attempt,
    (error) => {
      logFailure(`[binance sync] skipped the ${wallet} wallet`, error);

      return null;
    },
    identity,
  );
};

/** The `binanceAsset` match keys already present among a target's holdings. */
const existingBinanceKeys = (holdings: HoldingRow[]): Set<string> => {
  const keys = new Set<string>();

  for (const holding of holdings) {
    const key = binanceKeyOf(holding);

    if (key !== undefined) {
      keys.add(key);
    }
  }

  return keys;
};

// Only a BTC holding can carry an earlier default name, so no other coin is ever renamed.
const renameOf = (
  currency: Currency,
  wallet: BinanceWallet,
): Pick<ProviderBalance, 'renameFromDefaults'> =>
  currency === BINANCE_ASSET ? { renameFromDefaults: PREVIOUS_BTC_HOLDING_NAMES[wallet] } : {};

/** The least balance that creates a holding: a coin's dust threshold, any non-zero fiat balance. */
const appearMinorUnitsOf = (currency: Currency): number =>
  isCrypto(currency)
    ? bifoldMap(
        exchangeMinorUnits(currency, curatedCoins[currency].dustBelow, 'balance'),
        () => 1,
        identity,
      )
    : 1;

/** The coins that already have a holding in `wallet`. */
const heldCoinsOf = (wallet: BinanceWallet, existingKeys: ReadonlySet<string>): Currency[] =>
  [...existingKeys].flatMap((key) => {
    const parts = partsOfHoldingKey(key);

    return parts?.wallet === wallet ? [parts.code] : [];
  });

const holdingOf = (
  currency: Currency,
  wallet: BinanceWallet,
  balanceMinorUnits: number,
): ProviderBalance => ({
  currency,
  balanceMinorUnits,
  metadataKey: holdingKeyOf(currency, wallet),
  name: coinHoldingName(currency, wallet),
  ...renameOf(currency, wallet),
});

/**
 * One line per refused coin, so a holding left at a stale balance shows in the log. It names the
 * wallet only: the coin and its amount are the user's data, which the log never carries.
 */
const logRefusal = (wallet: BinanceWallet): void => {
  // biome-ignore lint/suspicious/noConsole: OVERRIDE(diagnostic) a refused coin amount, wallet only
  console.warn('[binance sync] a coin amount was refused', { wallet });
};

/**
 * Append one wallet's holdings to the batch, one per coin:
 * - read FAILED (`read === null`): omit every holding of the wallet, leaving each at its
 *   last good balance rather than overwriting it with a fabricated 0.
 * - coin REFUSED (`read.refused`): omit that coin's holding alone, for the same reason, and log
 *   it.
 * - holding ALREADY exists: write it, a zero included, and a coin the good read does not list
 *   is a zero: a wallet the user emptied is zeroed, never left stale and never archived.
 * - no holding yet: write it only from the coin's dust threshold up, so a zero or a dust
 *   balance creates no empty holding the user cannot easily delete.
 */
const appendWallet = (
  batch: ProviderBalance[],
  wallet: BinanceWallet,
  read: WalletRead | null,
  existingKeys: ReadonlySet<string>,
): void => {
  if (read === null) {
    return;
  }

  const { balances, refused } = read;
  const coins = new Set([...balances.keys(), ...heldCoinsOf(wallet, existingKeys)]);

  refused.forEach(() => {
    logRefusal(wallet);
  });

  for (const currency of [...coins].filter((coin) => !refused.has(coin))) {
    const balanceMinorUnits = balances.get(currency) ?? 0;

    if (
      existingKeys.has(holdingKeyOf(currency, wallet)) ||
      balanceMinorUnits >= appearMinorUnitsOf(currency)
    ) {
      batch.push(holdingOf(currency, wallet, balanceMinorUnits));
    }
  }
};

const RECEIPT_TOKEN_PREFIX = 'LD';

/**
 * An Earn receipt token (`LDBTC`): `LD` and the code of a tracked coin, or of an asset in this
 * run's Simple Earn positions. A real coin that only starts with `LD` (`LDO`) is not one.
 */
const isReceiptToken = (asset: string, positionAssets: ReadonlySet<string>): boolean => {
  if (!asset.startsWith(RECEIPT_TOKEN_PREFIX)) {
    return false;
  }

  const underlying = asset.slice(RECEIPT_TOKEN_PREFIX.length);

  return isTrackedBinanceAsset(underlying) || positionAssets.has(underlying);
};

const sortedTickers = (tickers: readonly string[]): string[] => [...new Set(tickers)].sort();

/** Spot is strict, so only the other two wallets can have failed. */
type WalletReads = Record<Exclude<BinanceWallet, 'spot'>, WalletRead | null> & {
  spot: WalletRead;
};

/**
 * The refused coins of each wallet whose read succeeded; a wallet that failed is absent. The
 * patch sorts every wallet array, so it is not sorted here.
 */
const refusedByWallet = (reads: WalletReads): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(reads).flatMap(
      ([wallet, read]) =>
        foldMap(maybe(read), ({ refused }): [string, string[]][] => [[wallet, [...refused]]]) ?? [],
    ),
  );

/**
 * The balance lists after these wallet reads. The oversized list is written wallet by wallet: a
 * wallet that read replaces its own coins, and one that failed keeps its stored ones. The
 * not-tracked list is replaced only by a read in which every wallet read, since a failed wallet
 * knows nothing of its coins.
 */
const balanceListPatches = (reads: WalletReads): ExchangeStatePatch[] => {
  const { spot, funding, earn } = reads;
  const oversized: ExchangeStatePatch = {
    kind: 'oversizedBalance',
    wallets: refusedByWallet(reads),
    complete: funding !== null && earn !== null,
  };

  if (funding === null || earn === null) {
    return [oversized];
  }

  return [
    {
      kind: 'coinList',
      coins: 'untrackedCoins',
      list: 'balance',
      tickers: sortedTickers(
        [spot, funding, earn]
          .flatMap(({ untracked }) => untracked)
          .filter((ticker) => !isReceiptToken(ticker, earn.assets)),
      ),
    },
    oversized,
  ];
};

export const binanceProvider: BalanceProvider<BinanceDeps> = {
  id: 'binance',
  metadataField: 'binanceAsset',
  fetchBalances: async (deps, target) => {
    // A 429/418 cooldown is SHARED with the history walk (`binance.cooldown.ts`)
    // — either path tripping it means the same UID is over its weight budget.
    // Checked BEFORE even reading credentials, so a cooling-down account makes
    // ZERO Binance requests; returning no balances (never throwing) keeps the
    // "balance sync never fails because of the history walk" contract even
    // when the history walk is the one that set the cooldown.
    if (isBinanceCoolingDown(target.accountId, deps.now())) {
      return { balances: [] };
    }

    const credentials = await deps.readCredentials(target.accountId);

    if (credentials === undefined) {
      throw new Error(i18n.t('accountDetail.noBinanceCredentials'));
    }

    const { apiKey, secret } = credentials;
    const options: FetchAccountOptions = { fetchImpl: deps.fetchImpl, now: deps.now };

    // Spot MUST succeed — its failure fails the whole Binance sync. It is the
    // connection's proof of life, and its BTC holding reuses the legacy key so the
    // pre-split aggregated holding is updated in place into the Spot holding. A 429/418
    // sets the shared cooldown (so a subsequent history-walk request also backs
    // off) and surfaces as the LOCALIZED `binanceRequestFailed` message, never
    // the raw `BinanceRateLimitError` text `useSyncAction` would otherwise show
    // verbatim.
    let spotAccount: BinanceAccount;

    try {
      spotAccount = await deps.fetchAccount(apiKey, secret, options);
    } catch (error) {
      if (error instanceof BinanceRateLimitError) {
        setBinanceCooldownUntil(target.accountId, deps.now() + error.retryAfterMs);
        throw new Error(
          i18n.t('accountDetail.binanceRequestFailed', { status: error.status, detail: '' }),
        );
      }

      throw error;
    }

    const balances: ProviderBalance[] = [];
    const existingKeys = existingBinanceKeys(target.holdings);

    const spot = spotRead(spotAccount);
    appendWallet(balances, 'spot', spot, existingKeys);

    // Funding: one holding per coin; a failure skips the whole wallet.
    const funding = await walletRead('funding', async () =>
      fundingRead(await deps.fetchFundingAsset(apiKey, secret, options)),
    );
    appendWallet(balances, 'funding', funding, existingKeys);

    // Earn: Flexible + Locked COMBINED into ONE holding per coin. A failure in EITHER read
    // skips the WHOLE Earn wallet — importing one side alone would silently
    // UNDER-COUNT the user's Earn balance — so both reads sit inside one
    // `walletRead` guard rather than two.
    const earn = await walletRead('earn', async () => {
      const flexible = positionEntries(
        await deps.fetchFlexiblePosition(apiKey, secret, options),
        'totalAmount',
      );
      const locked = positionEntries(
        await deps.fetchLockedPosition(apiKey, secret, options),
        'amount',
      );

      return readOf([...flexible, ...locked]);
    });
    appendWallet(balances, 'earn', earn, existingKeys);

    // The lists and the stamp are returned, not written: the write needs the account marked as
    // Binance's, which a first Connect does only after this read.
    return {
      balances,
      exchangeState: [
        ...balanceListPatches({ spot, funding, earn }),
        { kind: 'balanceSyncedAt', value: deps.now() },
      ],
      spotBalanceTexts: spotBalanceTextsOf(spotAccount),
    };
  },
};
