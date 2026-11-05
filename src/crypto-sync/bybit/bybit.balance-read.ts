import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { bifoldMap, type Either, left } from 'fnts/either';
import { compareDecimal, normalizeDecimal } from '@kiko/currency/decimal';
import { type AmountError, exchangeMinorUnits } from '@kiko/crypto-sync/exchange/amounts';

import { isTrackedBybitAsset } from './bybit.tracked-coin';
import type { BybitFundCoin, BybitUnifiedCoin } from './bybit.client';

/**
 * What one wallet's read found. `refused` holds a tracked coin whose amounts are unreadable or
 * add past the safe integer; `borrowed` holds one with a loan. Neither is ever written, and
 * neither is zeroed. `untracked` holds each coin the app does not track that has a balance above
 * zero.
 */
export type WalletRead = {
  balances: ReadonlyMap<Currency, number>;
  refused: ReadonlySet<Currency>;
  borrowed: ReadonlySet<Currency>;
  untracked: readonly string[];
};

type Loan = 'none' | 'some' | 'unreadable';

type CoinOutcome = { kind: 'balance'; units: number } | { kind: 'borrowed' } | { kind: 'refused' };

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** An amount as Bybit sends it: plain decimal text. Anything else is no amount. */
const plainAmountOf = (value: unknown): string | undefined =>
  foldMap(maybe(textOf(value)), (text) => normalizeDecimal(text) ?? undefined);

const isPositive = (value: unknown): boolean =>
  foldMap(maybe(plainAmountOf(value)), (plain) => compareDecimal(plain, '0') === 1) ?? false;

/**
 * A coin owes a loan when either loan field is above zero. A field that is no decimal text
 * (absent, empty, a number, a sign) cannot show that there is none, so it is never read as zero:
 * the coin is refused, since a balance with a hidden loan is not the balance of the coin.
 */
const loanOf = (row: BybitUnifiedCoin): Loan => {
  const fields = [row.spotBorrow, row.borrowAmount];

  if (fields.some(isPositive)) {
    return 'some';
  }

  return fields.some((field) => plainAmountOf(field) === undefined) ? 'unreadable' : 'none';
};

const noLoan = (): Loan => 'none';

const balanceUnitsOf = (currency: Currency, value: unknown): Either<AmountError, number> =>
  foldMap(maybe(textOf(value)), (text) => exchangeMinorUnits(currency, text, 'balance')) ??
  left('amount-malformed');

/** A balance below zero is no balance of a held coin, so it is refused like an unreadable one. */
const nonNegativeUnitsOf = (currency: Currency, value: unknown): number | undefined =>
  bifoldMap(
    balanceUnitsOf(currency, value),
    () => undefined,
    (units) => (units < 0 ? undefined : units),
  );

const outcomeOf = <Row extends BybitFundCoin>(
  coin: Currency,
  rows: readonly Row[],
  loanOfRow: (row: Row) => Loan,
): CoinOutcome => {
  const [row, ...repeats] = rows;

  // Two rows of one coin may be one row repeated, so neither is added to the other.
  if (row === undefined || repeats.length > 0) {
    return { kind: 'refused' };
  }

  return match(loanOfRow(row))
    .returnType<CoinOutcome>()
    .with('some', () => ({ kind: 'borrowed' }))
    .with('unreadable', () => ({ kind: 'refused' }))
    .with(
      'none',
      () =>
        foldMap(
          maybe(nonNegativeUnitsOf(coin, row.walletBalance)),
          (units): CoinOutcome => ({ kind: 'balance', units }),
        ) ?? { kind: 'refused' },
    )
    .exhaustive();
};

const rowsByCoin = <Row extends BybitFundCoin>(rows: readonly Row[]): Map<string, Row[]> => {
  const grouped = new Map<string, Row[]>();

  for (const row of rows) {
    grouped.set(row.coin, [...(grouped.get(row.coin) ?? []), row]);
  }

  return grouped;
};

/**
 * Each tracked coin's balance in its own minor units. A coin the app does not track has no scale,
 * so its amount is never converted: it is listed when its balance is above zero, and its loan
 * fields are not read. A tracked coin that is refused or borrowed is set aside alone.
 */
const readOf = <Row extends BybitFundCoin>(
  rows: readonly Row[],
  loanOfRow: (row: Row) => Loan,
): WalletRead => {
  const balances = new Map<Currency, number>();
  const refused = new Set<Currency>();
  const borrowed = new Set<Currency>();
  const untracked: string[] = [];

  for (const [coin, coinRows] of rowsByCoin(rows)) {
    if (!isTrackedBybitAsset(coin)) {
      if (coinRows.some((row) => isPositive(row.walletBalance))) {
        untracked.push(coin);
      }

      continue;
    }

    match(outcomeOf(coin, coinRows, loanOfRow))
      .with({ kind: 'balance' }, ({ units }) => balances.set(coin, units))
      .with({ kind: 'borrowed' }, () => borrowed.add(coin))
      .with({ kind: 'refused' }, () => refused.add(coin))
      .exhaustive();
  }

  return { balances, refused, borrowed, untracked };
};

/** UNIFIED: a coin with a loan is set aside, since its wallet balance is gross of the loan. */
export const unifiedReadOf = (rows: readonly BybitUnifiedCoin[]): WalletRead =>
  readOf(rows, loanOf);

/** FUND: the account has no loan fields, so a coin there is only read. */
export const fundReadOf = (rows: readonly BybitFundCoin[]): WalletRead => readOf(rows, noLoan);
