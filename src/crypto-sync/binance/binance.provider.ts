import { identity } from 'fnts';
import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { logFailure } from '@kiko/diagnostics';
import { curatedCoins } from '@kiko/currency/coins';
import { decimalFromJsonNumber } from '@kiko/currency/decimal';
import { type Currency, isCrypto } from '@kiko/currency/currency';
import either, { bifold, bifoldMap, type Either, isLeft, left, right } from 'fnts/either';
import { type AmountError, exchangeMinorUnits } from '@kiko/crypto-sync/exchange/amounts';

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
  EARN_KEY,
  FUNDING_KEY,
  holdingKeyOf,
  partsOfHoldingKey,
  SPOT_KEY,
  WALLET_HOLDING_NAMES,
} from './binance.holding-keys';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
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
 * The pre-split default name of the single aggregated holding. The Spot balance
 * carries it as `renameFromDefault`, so the upsert relabels a still-default
 * legacy holding to 'Binance Spot' on the first post-split sync while leaving a
 * user-edited name untouched (see `renameFromDefault` in `../provider`).
 */
const LEGACY_HOLDING_NAME = 'Binance BTC';

type AmountFailureKey =
  | 'accountDetail.binanceNonNumericBalanceAmount'
  | 'accountDetail.binanceNonNumericFundingAmount'
  | 'accountDetail.binanceNonNumericPositionAmount';

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

/** A refused amount fails the wallet's read; the caller decides what a failed read costs. */
const unitsOrThrow = (result: Either<AmountError, number>, failure: AmountFailureKey): number => {
  if (isLeft(result)) {
    throw new Error(i18n.t(failure));
  }

  const units: number = bifold(result);

  return units;
};

type CoinBalances = ReadonlyMap<Currency, number>;

type AmountEntry = { asset: unknown; amounts: readonly unknown[] };

/** One entry per row object, with the named fields of its amounts; a non-object is no entry. */
const entriesOf = (rows: readonly unknown[], fields: readonly string[]): AmountEntry[] =>
  rows
    .filter(isRecord)
    .map((row) => ({ asset: row.asset, amounts: fields.map((field) => row[field]) }));

/**
 * Each tracked coin's balance in its own minor units. An asset that is no `Currency` (a coin the
 * app does not track) is dropped BEFORE any amount is read, so its malformed text fails nothing.
 */
const balancesOf = (entries: readonly AmountEntry[], failure: AmountFailureKey): CoinBalances => {
  const amountsByCoin = new Map<Currency, unknown[]>();

  for (const { asset, amounts } of entries) {
    if (typeof asset === 'string' && isTrackedBinanceAsset(asset)) {
      amountsByCoin.set(asset, [...(amountsByCoin.get(asset) ?? []), ...amounts]);
    }
  }

  return new Map(
    [...amountsByCoin].map(([currency, amounts]) => [
      currency,
      unitsOrThrow(sumAmounts(currency, amounts), failure),
    ]),
  );
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
const spotBalances = (account: BinanceAccount): CoinBalances => {
  if (!hasBalances(account)) {
    throw new Error(i18n.t('accountDetail.binanceMissingBalancesArray'));
  }

  return balancesOf(
    entriesOf(account.balances, ['free', 'locked']),
    'accountDetail.binanceNonNumericBalanceAmount',
  );
};

/** Funding balances: `free + locked + freeze + withdrawing` per tracked coin. */
const fundingBalances = (assets: BinanceFundingAsset[]): CoinBalances => {
  if (!Array.isArray(assets)) {
    throw new Error(i18n.t('accountDetail.binanceFundingResponseNotArray'));
  }

  return balancesOf(
    entriesOf(assets, ['free', 'locked', 'freeze', 'withdrawing']),
    'accountDetail.binanceNonNumericFundingAmount',
  );
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
 * `null` (skipped) is deliberately distinct from an empty map (a genuine empty wallet).
 * Spot is deliberately NOT wrapped: its failure must fail the sync.
 */
const walletBalances = async (
  wallet: string,
  balances: () => Promise<CoinBalances>,
): Promise<CoinBalances | null> => {
  const attempt = await either<unknown, CoinBalances>(balances);

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

// BTC keeps its pre-per-coin default names until the rename moves a stored holding with them.
const BTC_HOLDING_NAMES: Record<BinanceWallet, string> = {
  spot: WALLET_HOLDING_NAMES[SPOT_KEY],
  funding: WALLET_HOLDING_NAMES[FUNDING_KEY],
  earn: WALLET_HOLDING_NAMES[EARN_KEY],
};

const holdingNameOf = (currency: Currency, wallet: BinanceWallet): string =>
  currency === BINANCE_ASSET ? BTC_HOLDING_NAMES[wallet] : coinHoldingName(currency, wallet);

// The Spot BTC holding is the one the pre-split single holding became; it carries the old
// default name so the upsert relabels it, and only it.
const renameOf = (
  currency: Currency,
  wallet: BinanceWallet,
): Pick<ProviderBalance, 'renameFromDefault'> =>
  currency === BINANCE_ASSET && wallet === 'spot' ? { renameFromDefault: LEGACY_HOLDING_NAME } : {};

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

/**
 * Append one wallet's holdings to the batch, one per coin:
 * - read FAILED (`balances === null`): omit every holding of the wallet, leaving each at its
 *   last good balance rather than overwriting it with a fabricated 0.
 * - holding ALREADY exists: write it, a zero included, and a coin the good read does not list
 *   is a zero: a wallet the user emptied is zeroed, never left stale and never archived.
 * - no holding yet: write it only from the coin's dust threshold up, so a zero or a dust
 *   balance creates no empty holding the user cannot easily delete.
 */
const appendWallet = (
  batch: ProviderBalance[],
  wallet: BinanceWallet,
  balances: CoinBalances | null,
  existingKeys: ReadonlySet<string>,
): void => {
  if (balances === null) {
    return;
  }

  for (const currency of new Set([...balances.keys(), ...heldCoinsOf(wallet, existingKeys)])) {
    const balanceMinorUnits = balances.get(currency) ?? 0;
    const metadataKey = holdingKeyOf(currency, wallet);

    if (existingKeys.has(metadataKey) || balanceMinorUnits >= appearMinorUnitsOf(currency)) {
      batch.push({
        currency,
        balanceMinorUnits,
        metadataKey,
        name: holdingNameOf(currency, wallet),
        ...renameOf(currency, wallet),
      });
    }
  }
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
      return [];
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

    // The capital, Pay, Transfer and Earn walks import nothing while no Spot BTC holding exists,
    // so a good Spot read always writes it, a zero or dust balance included. Those walks and
    // this anchor go together.
    appendWallet(balances, 'spot', spotBalances(spotAccount), new Set([...existingKeys, SPOT_KEY]));

    // Funding: one holding per coin; a failure skips the whole wallet.
    const funding = await walletBalances('funding', async () =>
      fundingBalances(await deps.fetchFundingAsset(apiKey, secret, options)),
    );
    appendWallet(balances, 'funding', funding, existingKeys);

    // Earn: Flexible + Locked COMBINED into ONE holding per coin. A failure in EITHER read
    // skips the WHOLE Earn wallet — importing one side alone would silently
    // UNDER-COUNT the user's Earn balance — so both reads sit inside one
    // `walletBalances` guard rather than two.
    const earn = await walletBalances('earn', async () => {
      const flexible = positionEntries(
        await deps.fetchFlexiblePosition(apiKey, secret, options),
        'totalAmount',
      );
      const locked = positionEntries(
        await deps.fetchLockedPosition(apiKey, secret, options),
        'amount',
      );

      return balancesOf([...flexible, ...locked], 'accountDetail.binanceNonNumericPositionAmount');
    });
    appendWallet(balances, 'earn', earn, existingKeys);

    return balances;
  },
};
