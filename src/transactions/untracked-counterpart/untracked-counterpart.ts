import {
  type DecimalAmountError,
  decimalToMinorUnits,
  normalizeDecimal,
  shiftDecimal,
} from '@kiko/currency/decimal';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { bifoldr, left, right, second, type Either } from 'fnts/either';
import { isCrypto, isCurrency, currencyScale } from '@kiko/currency/currency';

export const UNTRACKED_WALLETS = [
  'UMFUTURE',
  'CMFUTURE',
  'MARGIN',
  'OPTION',
  'PORTFOLIO_MARGIN',
] as const;

type UntrackedWallet = (typeof UNTRACKED_WALLETS)[number];

// Binance's own product names. They are proper nouns, so they stay out of the
// catalogue: a translation would only misname the product the user sees in the
// Binance app.
const NAME_BY_WALLET: Readonly<Record<UntrackedWallet, string>> = {
  UMFUTURE: 'USDⓈ-M Futures',
  CMFUTURE: 'COIN-M Futures',
  MARGIN: 'Margin',
  OPTION: 'Options',
  PORTFOLIO_MARGIN: 'Portfolio Margin',
};

export const untrackedWalletCode = (wallet: UntrackedWallet): `wallet:${UntrackedWallet}` =>
  `wallet:${wallet}`;

// One rule for the code a ticker builds and the code a read accepts: no ticker is empty or holds
// the separator, so no code reads as another kind or as a longer one.
const isAssetTicker = (ticker: string): boolean => ticker !== '' && !ticker.includes(':');

/** The `asset:<CODE>` of a coin the account does not track, or `undefined` for no usable ticker. */
export const untrackedAssetCode = (ticker: string): `asset:${string}` | undefined =>
  isAssetTicker(ticker) ? `asset:${ticker}` : undefined;

type FiatCounterpartKind = 'p2p' | 'card' | 'bank';

type UntrackedCounterpart =
  | { kind: 'wallet'; name: string }
  | { kind: 'asset'; code: string }
  | { kind: FiatCounterpartKind; fiat: string; totalMinorUnits: number | undefined };

const splitOnce = (text: string): [string, string | undefined] => {
  const separator = text.indexOf(':');

  return separator === -1
    ? [text, undefined]
    : [text.slice(0, separator), text.slice(separator + 1)];
};

/** The minor-unit scale of a fiat Kiko knows, or `undefined`: only a known fiat has one. */
const fiatScaleOf = (fiat: string): number | undefined =>
  isCurrency(fiat) && !isCrypto(fiat) ? currencyScale[fiat] : undefined;

// A total that is malformed, over-precise, zero or negative is dropped, never repaired, so a
// reader falls back to the label without it. Only a known fiat has a scale to read it at.
const totalMinorUnitsOf = (fiat: string, totalText: string | undefined): number | undefined => {
  const scale = fiatScaleOf(fiat);

  if (scale === undefined) {
    return undefined;
  }

  const minorUnits = foldMap(maybe(totalText), (text) =>
    bifoldr(decimalToMinorUnits(text, scale, 'exact')),
  );

  return (minorUnits ?? 0) > 0 ? minorUnits : undefined;
};

/**
 * The `p2p:`, `card:` or `bank:` code of one fiat total, or the stop code when the text cannot
 * make one that reads back. A fiat Kiko knows has its total normalized to exactly its scale
 * (trailing zeros past it drop, missing ones pad, a non-zero digit past it is `amount-precision`);
 * a fiat it does not know has no scale, so its total stays as sent after the plain-decimal check
 * and reads back as the fiat alone. Never `amount x price`: the total is Binance's own text.
 */
export const fiatTotalCode = (
  kind: FiatCounterpartKind,
  fiat: string,
  totalText: string,
): Either<DecimalAmountError, string> => {
  if (!isAssetTicker(fiat) || normalizeDecimal(totalText) !== totalText) {
    return left('amount-malformed');
  }

  const scale = fiatScaleOf(fiat);

  if (scale === undefined) {
    return right(`${kind}:${fiat}:${totalText}`);
  }

  return second(
    decimalToMinorUnits(totalText, scale, 'exact'),
    (minorUnits) => `${kind}:${fiat}:${shiftDecimal(String(minorUnits), -scale)}`,
  );
};

const walletCounterpartOf = (name: string): UntrackedCounterpart | undefined =>
  foldMap(
    maybe(UNTRACKED_WALLETS.find((wallet) => wallet === name)),
    (wallet): UntrackedCounterpart => ({ kind: 'wallet', name: NAME_BY_WALLET[wallet] }),
  );

const fiatCounterpartOf = (
  kind: FiatCounterpartKind,
  rest: string,
): UntrackedCounterpart | undefined => {
  const [fiat, totalText] = splitOnce(rest);

  return fiat === ''
    ? undefined
    : { kind, fiat, totalMinorUnits: totalMinorUnitsOf(fiat, totalText) };
};

/**
 * Reads a stored `transactions.untracked_counterpart` code into a tagged value, or `undefined`
 * for a code this build does not know (a newer build's, or a malformed one), so the caller falls
 * back to the plain label instead of printing a raw code. A fiat code (`p2p:`, `card:`, `bank:`)
 * keeps its fiat when its total cannot be trusted: the label needs only the fiat.
 */
export const parseUntrackedCounterpart = (code: string | null): UntrackedCounterpart | undefined =>
  foldMap(maybe(code), (value) => {
    const [kind, rest = ''] = splitOnce(value);

    return match(kind)
      .with('wallet', () => walletCounterpartOf(rest))
      .with('asset', (): UntrackedCounterpart | undefined =>
        isAssetTicker(rest) ? { kind: 'asset', code: rest } : undefined,
      )
      .with('p2p', 'card', 'bank', (fiatKind) => fiatCounterpartOf(fiatKind, rest))
      .otherwise(() => undefined);
  });
