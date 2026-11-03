import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

import type { SpendingLedgerInput } from '../spending-ledger';

export const MINUTE = 60_000;

// Inside the scheduled loan's first month, so its payment maps to its one installment.
export const BASE_TIME = new Date(2024, 0, 5, 12).getTime();

export const transactionRow = (
  overrides: Partial<TransactionRow> & Pick<TransactionRow, 'id' | 'holdingId'>,
): TransactionRow => ({
  amountMinorUnits: -1_000,
  time: BASE_TIME,
  description: '',
  category: null,
  categorySetByHand: false,
  mcc: null,
  hold: null,
  counterIban: null,
  exchangeCounterpartHoldingId: null,
  changeGroupId: null,
  exchangePairId: null,
  untrackedCounterpart: null,
  operation: null,
  loanHoldingId: null,
  loanLinkSource: null,
  loanLinkRejected: false,
  setsBalance: false,
  comment: null,
  source: 'manual',
  externalId: null,
  createdAt: 0,
  ...overrides,
});

export const holdingRow = (
  overrides: Partial<HoldingRow> & Pick<HoldingRow, 'id' | 'accountId'>,
): HoldingRow => ({
  name: overrides.id,
  type: 'card',
  currency: 'UAH',
  icon: null,
  color: null,
  balanceMinorUnits: 0,
  syncedBalanceMinorUnits: null,
  balanceSetAt: null,
  balanceSetRowId: null,
  metadata: null,
  sortOrder: 0,
  closedAt: null,
  createdAt: 0,
  ...overrides,
});

export const accountRow = (
  overrides: Partial<AccountRow> & Pick<AccountRow, 'id' | 'kind'>,
): AccountRow => ({
  name: overrides.id,
  institution: null,
  currency: 'UAH',
  bankId: null,
  icon: null,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  createdAt: 0,
  ...overrides,
});

export const BANK = accountRow({ id: 'bank', kind: 'bank' });
export const CRYPTO = accountRow({ id: 'crypto', kind: 'crypto' });

export const CARD = holdingRow({ id: 'card', accountId: 'bank' });
export const CASH = holdingRow({ id: 'cash', accountId: 'bank', type: 'cash' });
export const COIN = holdingRow({
  id: 'coin',
  accountId: 'crypto',
  type: 'crypto_asset',
  currency: 'USDT',
});
export const LOAN = holdingRow({
  id: 'loan',
  accountId: 'bank',
  type: 'loan',
  metadata: {
    kind: 'personal',
    principalMinorUnits: 900_000,
    startDate: new Date(2024, 0, 1).getTime(),
    annualRatePct: 12,
    termMonths: 1,
    schedule: 'annuity',
  },
});

// Each excluded row below is caught by exactly one of the seven rule sets.
export const COUNTED = transactionRow({
  id: 'counted',
  holdingId: 'card',
  amountMinorUnits: -1_500,
  category: 'groceries',
  time: BASE_TIME + 10 * MINUTE,
});
export const TRANSFER_OUT = transactionRow({
  id: 'transfer-out',
  holdingId: 'card',
  amountMinorUnits: -5_000,
  time: BASE_TIME + 30 * MINUTE,
});
export const TRANSFER_IN = transactionRow({
  id: 'transfer-in',
  holdingId: 'cash',
  amountMinorUnits: 5_000,
  time: BASE_TIME + 30 * MINUTE + 1_000,
});
export const CASH_OUT = transactionRow({
  id: 'cash-out',
  holdingId: 'card',
  amountMinorUnits: -2_000,
  mcc: 6011,
  time: BASE_TIME + 40 * MINUTE,
});
export const DEPOSIT_TOP_UP = transactionRow({
  id: 'deposit-top-up',
  holdingId: 'card',
  amountMinorUnits: -3_000,
  description: 'Поповнення депозиту',
  time: BASE_TIME + 50 * MINUTE,
});
export const CONVERT_LEG = transactionRow({
  id: 'convert-leg',
  holdingId: 'card',
  amountMinorUnits: -4_000,
  exchangeCounterpartHoldingId: 'coin',
  time: BASE_TIME + 60 * MINUTE,
});
export const MOVE_OUT = transactionRow({
  id: 'move-out',
  holdingId: 'card',
  amountMinorUnits: -7_000,
  exchangePairId: 'pair-1',
  time: BASE_TIME + 70 * MINUTE,
});
export const MOVE_IN = transactionRow({
  id: 'move-in',
  holdingId: 'cash',
  amountMinorUnits: 7_000,
  exchangePairId: 'pair-1',
  time: BASE_TIME + 70 * MINUTE,
});
export const COIN_PURCHASE = transactionRow({
  id: 'coin-purchase',
  holdingId: 'coin',
  amountMinorUnits: 9_990_000_000,
  untrackedCounterpart: 'p2p:UAH:4150.00',
  time: BASE_TIME + 120 * MINUTE,
});
export const FUNDING_DEBIT = transactionRow({
  id: 'funding-debit',
  holdingId: 'card',
  amountMinorUnits: -415_000,
  time: BASE_TIME + 100 * MINUTE,
});
export const LOAN_PAYMENT = transactionRow({
  id: 'loan-payment',
  holdingId: 'card',
  amountMinorUnits: -12_000,
  loanHoldingId: 'loan',
  category: 'utilities',
  time: BASE_TIME + 130 * MINUTE,
});

export const EXCLUDED_BY_ONE_RULE_EACH = [
  'transfer-out',
  'transfer-in',
  'cash-out',
  'deposit-top-up',
  'convert-leg',
  'move-out',
  'move-in',
  'coin-purchase',
  'funding-debit',
  'loan-payment',
];

export const WORLD_TRANSACTIONS = [
  COUNTED,
  TRANSFER_OUT,
  TRANSFER_IN,
  CASH_OUT,
  DEPOSIT_TOP_UP,
  CONVERT_LEG,
  MOVE_OUT,
  MOVE_IN,
  FUNDING_DEBIT,
  COIN_PURCHASE,
  LOAN_PAYMENT,
];

export const WORLD_HOLDINGS = [CARD, CASH, COIN, LOAN];

export const worldInput = (overrides: Partial<SpendingLedgerInput> = {}): SpendingLedgerInput => ({
  transactions: WORLD_TRANSACTIONS,
  holdings: WORLD_HOLDINGS,
  accounts: [BANK, CRYPTO],
  shownHoldings: [CARD, CASH, COIN, LOAN],
  ...overrides,
});
