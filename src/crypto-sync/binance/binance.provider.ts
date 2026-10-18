import { identity } from 'fnts';
import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { logFailure } from '@kiko/diagnostics';
import { decimalFromJsonNumber } from '@kiko/currency/decimal';
import either, { bifold, bifoldMap, type Either, isLeft, left, right } from 'fnts/either';
import { type AmountError, exchangeMinorUnits } from '@kiko/crypto-sync/exchange/amounts';

import type { BalanceProvider, ProviderBalance } from '../provider';

import {
  type BinanceAccount,
  type BinanceBalance,
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
  binanceKeyOf,
  EARN_KEY,
  FUNDING_KEY,
  SPOT_KEY,
  WALLET_HOLDING_NAMES,
} from './binance.holding-keys';
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

const amountMinorUnits = (value: unknown): Either<AmountError, number> =>
  foldMap(maybe(amountText(value)), (text) => exchangeMinorUnits(BINANCE_ASSET, text, 'balance')) ??
  left('amount-malformed');

/**
 * Sum amounts as exact integer minor units. Each is parsed on its own, so no float sits between
 * the text and the stored value, and a sum past the safe integer is refused, never truncated.
 */
const sumAmounts = (amounts: readonly unknown[]): Either<AmountError, number> => {
  let total = 0;

  for (const amount of amounts) {
    const units = amountMinorUnits(amount);

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
    throw new Error(i18n.t('accountDetail.binanceMissingBalancesArray'));
  }

  const btcBalances = account.balances.filter((balance): balance is BinanceBalance =>
    isBTCEntry(balance),
  );

  return unitsOrThrow(
    sumAmounts(btcBalances.flatMap((balance) => [balance.free, balance.locked])),
    'accountDetail.binanceNonNumericBalanceAmount',
  );
};

/** Funding BTC satoshis: `free + locked + freeze + withdrawing` per BTC row. */
const fundingSatoshis = (assets: BinanceFundingAsset[]): number => {
  if (!Array.isArray(assets)) {
    throw new Error(i18n.t('accountDetail.binanceFundingResponseNotArray'));
  }

  const btcAssets = assets.filter((asset): asset is BinanceFundingAsset => isBTCEntry(asset));

  return unitsOrThrow(
    sumAmounts(
      btcAssets.flatMap((asset) => [asset.free, asset.locked, asset.freeze, asset.withdrawing]),
    ),
    'accountDetail.binanceNonNumericFundingAmount',
  );
};

/**
 * The BTC amounts of one Simple Earn read. A flexible position holds its BTC in `totalAmount`, a
 * locked one in `amount`; the caller names which field, and sums both reads together.
 */
const positionAmounts = (
  body: { rows: unknown[] },
  amountField: 'totalAmount' | 'amount',
): unknown[] => {
  if (!hasRows(body)) {
    throw new Error(i18n.t('accountDetail.binanceMissingRowsArray'));
  }

  return body.rows
    .filter((row): row is Record<string, unknown> => isBTCEntry(row))
    .map((row) => row[amountField]);
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
  const attempt = await either<unknown, number>(satoshis);

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
  batch.push({ currency: BINANCE_ASSET, balanceMinorUnits: satoshis, metadataKey, name });
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
    // connection's proof of life and the split's anchor, so it is ALWAYS written
    // (a genuine zero included), and it reuses the legacy key so the pre-split
    // aggregated holding is updated in place into the Spot holding. A 429/418
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

    const spot = spotSatoshis(spotAccount);
    const balances: ProviderBalance[] = [
      {
        currency: BINANCE_ASSET,
        balanceMinorUnits: spot,
        metadataKey: SPOT_KEY,
        name: WALLET_HOLDING_NAMES[SPOT_KEY],
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
    appendWallet(balances, funding, FUNDING_KEY, WALLET_HOLDING_NAMES[FUNDING_KEY], existingKeys);

    // Earn: Flexible + Locked COMBINED into ONE holding. A failure in EITHER read
    // skips the WHOLE Earn holding — importing one side alone would silently
    // UNDER-COUNT the user's Earn balance — so both reads sit inside one
    // `walletSatoshis` guard rather than two.
    const earn = await walletSatoshis('earn', async () => {
      const flexible = positionAmounts(
        await deps.fetchFlexiblePosition(apiKey, secret, options),
        'totalAmount',
      );
      const locked = positionAmounts(
        await deps.fetchLockedPosition(apiKey, secret, options),
        'amount',
      );

      return unitsOrThrow(
        sumAmounts([...flexible, ...locked]),
        'accountDetail.binanceNonNumericPositionAmount',
      );
    });
    appendWallet(balances, earn, EARN_KEY, WALLET_HOLDING_NAMES[EARN_KEY], existingKeys);

    return balances;
  },
};
