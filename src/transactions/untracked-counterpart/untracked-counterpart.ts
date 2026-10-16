import maybe, { foldMap } from 'fnts/maybe';

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

/**
 * The product name a stored `transactions.untracked_counterpart` code stands
 * for, or `undefined` for a code this build does not know (a newer build's, or a
 * code of another kind), so the caller falls back to the plain label instead of
 * printing a raw code.
 */
export const untrackedCounterpartName = (code: string | null): string | undefined =>
  foldMap(
    maybe(UNTRACKED_WALLETS.find((wallet) => untrackedWalletCode(wallet) === code)),
    (wallet) => NAME_BY_WALLET[wallet],
  );
