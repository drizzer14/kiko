import type { BybitFundCoin, BybitUnifiedCoin } from './bybit.client';

/**
 * A coin of the UNIFIED account as the client hands it on: the page's sample shape with a decimal
 * string for each amount and no loan, which a test overrides one field at a time.
 */
export const unifiedCoin = (
  coin: string,
  walletBalance: unknown,
  overrides: Partial<Omit<BybitUnifiedCoin, 'coin' | 'walletBalance'>> = {},
): BybitUnifiedCoin => ({ coin, walletBalance, spotBorrow: '0', borrowAmount: '0', ...overrides });

export const fundCoin = (coin: string, walletBalance: unknown): BybitFundCoin => ({
  coin,
  walletBalance,
});

/** The result of a UNIFIED answer: the page's `list[].coin[]`, with fields Kiko never reads. */
export const unifiedResult = (coins: readonly BybitUnifiedCoin[]) => ({
  list: [
    {
      accountType: 'UNIFIED',
      totalEquity: '1',
      coin: coins.map(({ coin, walletBalance, spotBorrow, borrowAmount }) => ({
        coin,
        walletBalance,
        spotBorrow,
        borrowAmount,
        equity: '1',
        usdValue: '1',
        locked: '0',
      })),
    },
  ],
});

/** The result of a FUND answer: the page's `balance[]`, with a field Kiko never reads. */
export const fundResult = (coins: readonly BybitFundCoin[]) => ({
  accountType: 'FUND',
  balance: coins.map(({ coin, walletBalance }) => ({
    coin,
    walletBalance,
    transferBalance: walletBalance,
  })),
});
