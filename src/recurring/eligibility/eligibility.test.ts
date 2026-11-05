import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';

import * as eligibility from './eligibility';

type LedgerRow = Pick<
  TransactionRow,
  | 'id'
  | 'holdingId'
  | 'amountMinorUnits'
  | 'time'
  | 'description'
  | 'mcc'
  | 'counterIban'
  | 'categorySetByHand'
  | 'setsBalance'
  | 'changeGroupId'
  | 'exchangePairId'
  | 'exchangeCounterpartHoldingId'
  | 'untrackedCounterpart'
  | 'loanHoldingId'
  | 'source'
>;
type Holding = Pick<HoldingRow, 'id' | 'accountId' | 'name' | 'currency' | 'metadata'>;
type Account = Pick<AccountRow, 'id' | 'kind' | 'archivedAt'>;
type RowOverrides = Partial<LedgerRow & { hold: boolean }>;
type World = { rows: LedgerRow[]; holdings: Holding[]; accounts: Account[] };
type WorldChange = {
  row?: RowOverrides;
  holding?: Partial<Holding & { closedAt: number }>;
  account?: Partial<Account>;
  extraRows?: LedgerRow[];
  extraHoldings?: Holding[];
  extraAccounts?: Account[];
  withoutHolding?: boolean;
};

const MONTH_COUNT = 12;
const CHARGE_IDS = Array.from({ length: MONTH_COUNT }, (_, month) => `charge-${month}`);
const CHARGE_AMOUNT = -415_000;
const OWN_IBAN = 'UA213223130000026007233566001';
const OTHER_IBAN = 'UA903052992990004149123456789';
const CASH_OUT_MCC = 6011;
const OWN_TRANSFER_MCC = 4829;
const GROCERY_MCC = 5411;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const chargeTime = (month: number): number => new Date(2026, 9 - month, 5, 10, 30).getTime();

const rowOf = (id: string, month: number, overrides: RowOverrides = {}): LedgerRow => ({
  id,
  holdingId: 'card',
  amountMinorUnits: CHARGE_AMOUNT,
  time: chargeTime(month),
  description: 'Netflix',
  mcc: GROCERY_MCC,
  counterIban: null,
  categorySetByHand: false,
  setsBalance: false,
  changeGroupId: null,
  exchangePairId: null,
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  loanHoldingId: null,
  source: 'monobank',
  ...overrides,
});

const holdingOf = (id: string, accountId: string, metadata: unknown = null): Holding => ({
  id,
  accountId,
  name: id,
  currency: 'UAH',
  metadata,
});

const worldOf = (change: WorldChange = {}): World => ({
  rows: [
    ...CHARGE_IDS.map((id, month) => rowOf(id, month, change.row)),
    ...(change.extraRows ?? []),
  ],
  holdings: [
    ...(change.withoutHolding ? [] : [{ ...holdingOf('card', 'bank-account'), ...change.holding }]),
    ...(change.extraHoldings ?? []),
  ],
  accounts: [
    { id: 'bank-account', kind: 'bank', archivedAt: null, ...change.account },
    ...(change.extraAccounts ?? []),
  ],
});

const chargeIdsOf = ({ rows, holdings, accounts }: World): string[] => {
  const excludedIds = eligibility.recurringExcludedIds(rows, holdings, accounts);

  return rows
    .filter((row) => {
      const holding = holdings.find(({ id }) => id === row.holdingId);
      const account = accounts.find(({ id }) => id === holding?.accountId);

      return !excludedIds.has(row.id) && eligibility.isRecurringCandidate(row, holding, account);
    })
    .map(({ id }) => id);
};

const secondCard = (iban: string): Pick<WorldChange, 'extraHoldings' | 'extraAccounts'> => ({
  extraHoldings: [holdingOf('card-b', 'bank-account-b', { iban })],
  extraAccounts: [{ id: 'bank-account-b', kind: 'bank', archivedAt: null }],
});

const creditOnSecondCard = (offsetMs: number): LedgerRow[] =>
  CHARGE_IDS.map((id, month) =>
    rowOf(`credit-${id}`, month, {
      holdingId: 'card-b',
      amountMinorUnits: -CHARGE_AMOUNT,
      time: chargeTime(month) + offsetMs,
    }),
  );

const exchangePurchases = (offsetMs: number): WorldChange => ({
  extraRows: CHARGE_IDS.map((id, month) =>
    rowOf(`purchase-${id}`, month, {
      holdingId: 'usdt',
      amountMinorUnits: 9_990_000_000,
      time: chargeTime(month) + offsetMs,
      description: 'USDT',
      untrackedCounterpart: 'p2p:UAH:4150.00',
    }),
  ),
  extraHoldings: [{ ...holdingOf('usdt', 'crypto-account'), currency: 'USDT' }],
  extraAccounts: [{ id: 'crypto-account', kind: 'crypto', archivedAt: null }],
});

const FUNDED_P2P_DELAY_MS = 10 * MINUTE_MS;
const BEYOND_P2P_WINDOW_MS = 5 * HOUR_MS;

describe('which rows count as charges', () => {
  it('counts twelve monthly debits on a plain card', () => {
    expect(chargeIdsOf(worldOf())).toEqual(CHARGE_IDS);
  });

  describe.each<[string, World, World]>([
    ['a balance set', worldOf({ row: { setsBalance: true } }), worldOf()],
    ['a change group', worldOf({ row: { changeGroupId: 'change-1' } }), worldOf()],
    ['an exchange pair id', worldOf({ row: { exchangePairId: 'pair-1' } }), worldOf()],
    [
      'an exchange counterpart holding',
      worldOf({ row: { exchangeCounterpartHoldingId: 'usdt' } }),
      worldOf(),
    ],
    [
      'an untracked counterpart',
      worldOf({ row: { untrackedCounterpart: 'wallet:abc' } }),
      worldOf(),
    ],
    ['a cash-out MCC', worldOf({ row: { mcc: CASH_OUT_MCC } }), worldOf()],
    [
      'a 4829 transfer to an own IBAN',
      worldOf({ row: { mcc: OWN_TRANSFER_MCC, counterIban: OWN_IBAN }, ...secondCard(OWN_IBAN) }),
      worldOf({
        row: { mcc: OWN_TRANSFER_MCC, counterIban: OTHER_IBAN },
        ...secondCard(OWN_IBAN),
      }),
    ],
    [
      'the deposit wording',
      worldOf({ row: { description: 'Поповнення депозиту' } }),
      worldOf({ row: { description: 'Netflix' } }),
    ],
    [
      'a matched pair across two own cards',
      worldOf({ extraRows: creditOnSecondCard(MINUTE_MS), ...secondCard(OTHER_IBAN) }),
      worldOf({ extraRows: creditOnSecondCard(HOUR_MS), ...secondCard(OTHER_IBAN) }),
    ],
    [
      'a debit that funded an exchange purchase',
      worldOf(exchangePurchases(FUNDED_P2P_DELAY_MS)),
      worldOf(exchangePurchases(BEYOND_P2P_WINDOW_MS)),
    ],
    ['a linked loan payment', worldOf({ row: { loanHoldingId: 'loan-1' } }), worldOf()],
    [
      'a crypto account carrying a ticker as its description',
      worldOf({ row: { description: 'USDT' }, account: { kind: 'crypto' } }),
      worldOf({ row: { description: 'USDT' }, account: { kind: 'bank' } }),
    ],
    [
      'an archived account',
      worldOf({ account: { archivedAt: 1_700_000_000_000 } }),
      worldOf({ account: { archivedAt: null } }),
    ],
    ['a missing holding', worldOf({ withoutHolding: true }), worldOf()],
    ['a credit', worldOf({ row: { amountMinorUnits: -CHARGE_AMOUNT } }), worldOf()],
    ['a blank description', worldOf({ row: { description: '' } }), worldOf()],
  ])('%s', (_label, outWorld, inWorld) => {
    it('leaves every month out', () => {
      expect(chargeIdsOf(outWorld)).toEqual([]);
    });

    it('keeps every month in once the rule no longer applies', () => {
      expect(chargeIdsOf(inWorld)).toEqual(CHARGE_IDS);
    });
  });

  describe.each<[string, World]>([
    [
      'a 4829 transfer to a third party',
      worldOf({ row: { mcc: OWN_TRANSFER_MCC, counterIban: OTHER_IBAN }, ...secondCard(OWN_IBAN) }),
    ],
    ['a closed holding', worldOf({ holding: { closedAt: 1_700_000_000_000 } })],
    ['a pending hold row', worldOf({ row: { hold: true } })],
    ['a manual row', worldOf({ row: { source: 'manual' } })],
    ['an import row', worldOf({ row: { source: 'import' } })],
    ['a cash account', worldOf({ account: { kind: 'cash' } })],
    [
      'a funded debit whose category was set by hand',
      worldOf({ ...exchangePurchases(FUNDED_P2P_DELAY_MS), row: { categorySetByHand: true } }),
    ],
  ])('%s', (_label, world) => {
    it('counts every month', () => {
      expect(chargeIdsOf(world)).toEqual(CHARGE_IDS);
    });
  });
});
