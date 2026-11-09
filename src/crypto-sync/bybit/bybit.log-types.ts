/**
 * What a Unified log entry is, by its `type` (and its `category`, for a `TRADE`). The kind is all
 * the app keeps of an entry it does not import, so the stored state holds kinds and never rows.
 *
 * - `spotTrade`: imports.
 * - `coveredElsewhere`: the transfer series reads the same moves, so the log stays silent.
 * - every other kind: named in the line as not imported.
 */
export type BybitLogKind =
  | 'spotTrade'
  | 'coveredElsewhere'
  | 'derivatives'
  | 'convertEntries'
  | 'interestAndLoans'
  | 'bonuses'
  | 'earn'
  | 'stocks'
  | 'custody'
  | 'other';

type ListedKind = Exclude<BybitLogKind, 'spotTrade' | 'other'>;

/**
 * The 68 words of the enum page's "type(uta-translog)" (read 2026-11-06), each once. `TRADE` is
 * not here: its kind follows its category. The page's spelling stays, typos included
 * (`PREMIMUM`, the page's own).
 */
const LISTED_WORDS: readonly { kind: ListedKind; words: readonly string[] }[] = [
  { kind: 'derivatives', words: ['SETTLEMENT', 'DELIVERY', 'LIQUIDATION', 'ADL'] },
  { kind: 'coveredElsewhere', words: ['TRANSFER_IN', 'TRANSFER_OUT'] },
  { kind: 'convertEntries', words: ['CURRENCY_BUY', 'CURRENCY_SELL', 'CONVERT'] },
  {
    kind: 'interestAndLoans',
    words: [
      'INTEREST',
      'BORROW',
      'REPAY',
      'SPOT_REPAYMENT_SELL',
      'SPOT_REPAYMENT_BUY',
      'EARNING_REDEMPTION_SELL',
      'EARNING_REDEMPTION_BUY',
      'FLOATING_TO_FIXED_BORROW',
      'FLOATING_TO_FIXED_REPAY',
      'LOANS_BORROW_FUNDS',
      'LOANS_PLEDGE_ASSET',
      'PRINCIPAL_REPAYMENT_INS_LOAN',
      'INSTITUTION_LOAN_TRANSFER_OUT',
      'INSTITUTION_LOAN_WITHOUT_WITHDRAW',
    ],
  },
  {
    kind: 'bonuses',
    words: [
      'AIRDROP',
      'BONUS',
      'BONUS_RECOLLECT',
      'BONUS_TRANSFER_IN',
      'BONUS_TRANSFER_OUT',
      'FEE_REFUND',
    ],
  },
  {
    kind: 'earn',
    words: [
      'FIXED_SAVING_PRINCIPAL_REDEMPTION',
      'FLEXIBLE_STAKING_SUBSCRIPTION',
      'FLEXIBLE_STAKING_REDEMPTION',
      'FIXED_STAKING_SUBSCRIPTION',
      'FLEXIBLE_STAKING_REFUND',
      'FIXED_STAKING_REFUND',
      'PEF_TRANSFER_IN',
      'PEF_TRANSFER_OUT',
      'PEF_PROFIT_SHARE',
      'ONCHAINEARN_SUBSCRIPTION',
      'ONCHAINEARN_REDEMPTION',
      'ONCHAINEARN_REFUND',
      'STRUCTURE_PRODUCT_SUBSCRIPTION',
      'STRUCTURE_PRODUCT_REFUND',
      'CLASSIC_WEALTH_MANAGEMENT_SUBSCRIPTION',
      'PREMIMUM_WEALTH_MANAGEMENT_SUBSCRIPTION',
      'PREMIMUM_WEALTH_MANAGEMENT_REFUND',
      'LIQUIDITY_MINING_SUBSCRIPTION',
      'LIQUIDITY_MINING_REFUND',
      'PWM_SUBSCRIPTION',
      'PWM_REFUND',
      'BYUSDT_MINT',
      'BYUSDT_REDEMPTION',
      'BYUSDT_INTEREST',
    ],
  },
  {
    kind: 'stocks',
    words: [
      'STOCK_TRADE_BUY',
      'STOCK_TRADE_REFUND',
      'STOCK_TRADE_SELL',
      'STOCK_CORPORATE_ACTION_DIVIDEND',
      'STOCK_ADR_FEE',
      'FORWARD_SPLIT_SETTLE',
      'FORWARD_SPLIT_OPEN',
      'REVERSE_SPLIT_SETTLE',
      'REVERSE_SPLIT_OPEN',
    ],
  },
  {
    kind: 'custody',
    words: [
      'CUSTODY_NETWORK_FEE',
      'CUSTODY_SETTLE_FEE',
      'CUSTODY_LOCK',
      'CUSTODY_UNLOCK',
      'CUSTODY_UNLOCK_REFUND',
    ],
  },
];

/** A `Map`, so a word such as `constructor` is no key of the list. */
const KIND_OF_WORD: ReadonlyMap<string, BybitLogKind> = new Map(
  LISTED_WORDS.flatMap(({ kind, words }) =>
    words.map((word): [string, BybitLogKind] => [word, kind]),
  ),
);

const TRADE_WORD = 'TRADE';

/** The categories the page names. A `TRADE` of one of them but spot is a fee, never a leg. */
const DERIVATIVE_CATEGORIES: readonly string[] = ['linear', 'option', 'inverse', 'event'];

/** Every `type` of the closed list: `TRADE`, which no kind owns alone, and the rest. */
export const BYBIT_LOG_TYPES: readonly string[] = [TRADE_WORD, ...KIND_OF_WORD.keys()];

/**
 * The kind of one log entry. A `type` that is not on the closed list, or is no text, is `other`,
 * and so is a `TRADE` whose category is not one the page names: the entry is never parsed or
 * guessed into a trade.
 */
export const kindOfLogRow = (type: unknown, category: unknown): BybitLogKind => {
  if (typeof type !== 'string') {
    return 'other';
  }

  if (type === TRADE_WORD) {
    if (category === 'spot') {
      return 'spotTrade';
    }

    return typeof category === 'string' && DERIVATIVE_CATEGORIES.includes(category)
      ? 'derivatives'
      : 'other';
  }

  return KIND_OF_WORD.get(type) ?? 'other';
};
