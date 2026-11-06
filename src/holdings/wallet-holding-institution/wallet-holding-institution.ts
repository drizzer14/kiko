import type { BalanceProviderId } from '@kiko/crypto-sync/provider';

/**
 * Every `accounts.institution` whose holdings are exchange wallets a walk may create on demand.
 * `btc_wallet` is a balance provider too, but its holdings are an address, not a wallet.
 */
const walletHoldingInstitutions = ['binance'] as const satisfies readonly BalanceProviderId[];

export const isWalletHoldingInstitution = (institution: string | null | undefined): boolean =>
  (walletHoldingInstitutions as readonly (string | null | undefined)[]).includes(institution);
