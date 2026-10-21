import { match } from 'ts-pattern';
import { bifoldr } from 'fnts/either';
import maybe, { foldMap } from 'fnts/maybe';
import { decimalToMinorUnits } from '@kiko/currency/decimal';
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

type UntrackedCounterpart =
  | { kind: 'wallet'; name: string }
  | { kind: 'asset'; code: string }
  | { kind: 'p2p' | 'card' | 'bank'; fiat: string; totalMinorUnits: number | undefined };

const splitOnce = (text: string): [string, string | undefined] => {
  const separator = text.indexOf(':');

  return separator === -1
    ? [text, undefined]
    : [text.slice(0, separator), text.slice(separator + 1)];
};

// A total that is malformed, over-precise, zero or negative is dropped, never repaired, so a
// reader falls back to the label without it. Only a known fiat has a scale to read it at.
const totalMinorUnitsOf = (fiat: string, totalText: string | undefined): number | undefined => {
  if (!isCurrency(fiat) || isCrypto(fiat)) {
    return undefined;
  }

  const minorUnits = foldMap(maybe(totalText), (text) =>
    bifoldr(decimalToMinorUnits(text, currencyScale[fiat], 'exact')),
  );

  return (minorUnits ?? 0) > 0 ? minorUnits : undefined;
};

const walletCounterpartOf = (name: string): UntrackedCounterpart | undefined =>
  foldMap(
    maybe(UNTRACKED_WALLETS.find((wallet) => wallet === name)),
    (wallet): UntrackedCounterpart => ({ kind: 'wallet', name: NAME_BY_WALLET[wallet] }),
  );

const fiatCounterpartOf = (
  kind: 'p2p' | 'card' | 'bank',
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
        rest === '' || rest.includes(':') ? undefined : { kind: 'asset', code: rest },
      )
      .with('p2p', 'card', 'bank', (fiatKind) => fiatCounterpartOf(fiatKind, rest))
      .otherwise(() => undefined);
  });
