import { BYBIT_LOG_TYPES, type BybitLogKind, kindOfLogRow } from './bybit.log-types';

// The 68 words of the enum page's "type(uta-translog)", read from the live page on 2026-11-06 and
// listed here by the kind each belongs to, so a word moved to another kind fails this table.
const WORDS_OF_KIND: Record<Exclude<BybitLogKind, 'spotTrade' | 'other'>, readonly string[]> = {
  derivatives: ['SETTLEMENT', 'DELIVERY', 'LIQUIDATION', 'ADL'],
  coveredElsewhere: ['TRANSFER_IN', 'TRANSFER_OUT'],
  convertEntries: ['CURRENCY_BUY', 'CURRENCY_SELL', 'CONVERT'],
  interestAndLoans: [
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
  bonuses: [
    'AIRDROP',
    'BONUS',
    'BONUS_RECOLLECT',
    'BONUS_TRANSFER_IN',
    'BONUS_TRANSFER_OUT',
    'FEE_REFUND',
  ],
  earn: [
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
  stocks: [
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
  custody: [
    'CUSTODY_NETWORK_FEE',
    'CUSTODY_SETTLE_FEE',
    'CUSTODY_LOCK',
    'CUSTODY_UNLOCK',
    'CUSTODY_UNLOCK_REFUND',
  ],
};

const MAPPED_WORDS = Object.entries(WORDS_OF_KIND).flatMap(([kind, words]) =>
  words.map((word): [string, string] => [word, kind]),
);

describe('the closed list of log types', () => {
  it('each of the 68 words maps to one kind, and any other word goes to other and is never parsed', () => {
    expect(MAPPED_WORDS).toHaveLength(67);
    expect(new Set(MAPPED_WORDS.map(([word]) => word)).size).toBe(67);

    for (const [word, kind] of MAPPED_WORDS) {
      expect(kindOfLogRow(word, 'spot')).toBe(kind);
      expect(kindOfLogRow(word, undefined)).toBe(kind);
    }

    expect(kindOfLogRow('TRADE', 'spot')).toBe('spotTrade');
    expect([...BYBIT_LOG_TYPES].sort()).toEqual(
      [...MAPPED_WORDS.map(([word]) => word), 'TRADE'].sort(),
    );
    expect(BYBIT_LOG_TYPES).toHaveLength(68);
  });

  it.each([
    ['a word that is not on the page', 'SOMETHING_NEW'],
    ['a word of another case', 'trade'],
    ['a word with a space around it', ' TRADE '],
    ['an empty word', ''],
    ['a word that names a property of an object', 'constructor'],
    ['no word', undefined],
    ['a number', 1],
    ['null', null],
  ])('reads %s as the kind other', (_title, type) => {
    expect(kindOfLogRow(type, 'spot')).toBe('other');
  });

  it('reads a TRADE as a spot trade only with the category spot', () => {
    expect(kindOfLogRow('TRADE', 'spot')).toBe('spotTrade');
  });

  it.each(['linear', 'option', 'inverse', 'event'])(
    'reads a TRADE of the category %s as derivatives, never a spot trade',
    (category) => {
      expect(kindOfLogRow('TRADE', category)).toBe('derivatives');
    },
  );

  it.each([
    ['a category that is not on the page', 'futures'],
    ['a category of another case', 'SPOT'],
    ['no category', undefined],
    ['a category that is no text', 7],
  ])('reads a TRADE with %s as other, so no trade is guessed', (_title, category) => {
    expect(kindOfLogRow('TRADE', category)).toBe('other');
  });

  it('reads a word that is not TRADE by its word, whatever the category says', () => {
    expect(kindOfLogRow('SETTLEMENT', 'spot')).toBe('derivatives');
    expect(kindOfLogRow('STOCK_TRADE_BUY', 'spot')).toBe('stocks');
  });
});
