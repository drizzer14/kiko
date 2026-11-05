import {
  mccExcludedTransferTransactionIds,
  descriptionExcludedTransferTransactionIds,
} from '@kiko/statistics/transfer-exclusion';
import { sweep } from '@kiko/test-support/property-sweep';
import { seededRandom } from '@kiko/test-support/seeded-random';
import type { AccountRow, HoldingRow, TransactionRow } from '@kiko/db';
import { fundingPurchasesOf } from '@kiko/test-support/recurring-ledger';
import { ledgerRowsOf, ownIbansOf } from '@kiko/statistics/spending-ledger';

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

type OfferedForMark = (
  row: LedgerRow,
  holding: Holding | undefined,
  account: Account | undefined,
  ownIbans: ReadonlySet<string>,
  now: number,
) => boolean;

// A missing export fails the test that reaches for it, not the whole file.
const isOfferedForMark = (...callArguments: Parameters<OfferedForMark>): boolean => {
  const found = (eligibility as unknown as Record<string, unknown>).isOfferedForMark;

  if (typeof found !== 'function') {
    throw new Error('./eligibility does not export the function isOfferedForMark');
  }

  return (found as OfferedForMark)(...callArguments);
};

const NOW = new Date(2026, 10, 3, 12, 0).getTime();
const TOMORROW_EARLY = new Date(2026, 10, 4, 0, 10).getTime();
const TODAY_LATE = new Date(2026, 10, 3, 23, 50).getTime();

const startOfDay = (time: number): number => new Date(time).setHours(0, 0, 0, 0);

const offeredIn = (world: World, rowId = 'charge-0'): boolean => {
  const row = world.rows.find(({ id }) => id === rowId);
  const holding = world.holdings.find(({ id }) => id === row?.holdingId);
  const account = world.accounts.find(({ id }) => id === holding?.accountId);

  if (row === undefined) {
    throw new Error(`the world holds no row ${rowId}`);
  }

  return isOfferedForMark(row, holding, account, ownIbansOf(world.holdings), NOW);
};

describe('isOfferedForMark', () => {
  describe.each<[string, World, World]>([
    ['a credit', worldOf({ row: { amountMinorUnits: -CHARGE_AMOUNT } }), worldOf()],
    ['a blank description', worldOf({ row: { description: '' } }), worldOf()],
    ['a whitespace description', worldOf({ row: { description: '   ' } }), worldOf()],
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
    ['a linked loan payment', worldOf({ row: { loanHoldingId: 'loan-1' } }), worldOf()],
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
      'a crypto account',
      worldOf({ row: { description: 'USDT' }, account: { kind: 'crypto' } }),
      worldOf({ row: { description: 'USDT' }, account: { kind: 'bank' } }),
    ],
    [
      'an archived account',
      worldOf({ account: { archivedAt: 1_700_000_000_000 } }),
      worldOf({ account: { archivedAt: null } }),
    ],
    ['a missing holding', worldOf({ withoutHolding: true }), worldOf()],
    ['a missing account', { ...worldOf(), accounts: [] }, worldOf()],
    [
      'a row on a later local day',
      worldOf({ row: { time: TOMORROW_EARLY } }),
      worldOf({ row: { time: TODAY_LATE } }),
    ],
  ])('%s', (_label, outWorld, inWorld) => {
    it('is not offered', () => {
      expect(offeredIn(outWorld)).toBe(false);
    });

    it('is offered once the rule no longer applies', () => {
      expect(offeredIn(inWorld)).toBe(true);
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
  ])('%s', (_label, world) => {
    it('is offered', () => {
      expect(offeredIn(world)).toBe(true);
    });
  });

  // The two rules that read the whole ledger are invisible to a single row: the form cannot see
  // them, and a mark never overrides an exclusion, so the series builder drops such a row.
  describe.each<[string, World]>([
    [
      'a matched pair across two own cards',
      worldOf({ extraRows: creditOnSecondCard(MINUTE_MS), ...secondCard(OTHER_IBAN) }),
    ],
    ['a debit that funded an exchange purchase', worldOf(exchangePurchases(FUNDED_P2P_DELAY_MS))],
  ])('%s', (_label, world) => {
    it('is offered although the whole ledger excludes it', () => {
      expect(chargeIdsOf(world)).not.toContain('charge-0');
      expect(offeredIn(world)).toBe(true);
    });
  });
});

describe('isOfferedForMark against the whole-ledger composition', () => {
  const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + 1);
  const SEEDS = sweep(FULL_SEEDS);
  const SEED_SPREAD = 104_729;
  const MIN_PER_RUN = 1;
  const MIN_ROWS = 30;
  const ROW_SPREAD = 20;
  const DAY_SPREAD = 6;
  const CREDIT_SHARE = 0.2;
  const FLAG_SHARE = 0.06;
  const PAIR_SHARE = 0.25;
  const FUNDED_SHARE = 0.15;
  const HOLDING_IDS = ['card', 'card', 'card', 'card-b', 'wallet', 'usdt', 'old', 'ghost'];
  const DESCRIPTIONS = ['Netflix', 'Apple', 'Spotify', 'Silpo', 'Поповнення депозиту', '   '];
  const MCCS = [null, GROCERY_MCC, GROCERY_MCC, CASH_OUT_MCC, OWN_TRANSFER_MCC];
  const IBANS = [null, null, OWN_IBAN, OTHER_IBAN];

  const sweepWorldOf = (seed: number): World => {
    const random = seededRandom(seed * SEED_SPREAD);
    const between = (low: number, high: number): number =>
      low + Math.floor(random() * (high - low + 1));
    const pick = <Entry>(entries: readonly Entry[]): Entry =>
      entries[between(0, entries.length - 1)] as Entry;
    const flag = (value: string): string | null => (random() < FLAG_SHARE ? value : null);

    const rows = Array.from({ length: MIN_ROWS + between(0, ROW_SPREAD) }, (_unused, index) =>
      rowOf(`row-${index}`, 0, {
        holdingId: pick(HOLDING_IDS),
        amountMinorUnits: (random() < CREDIT_SHARE ? 1 : -1) * between(100, 90_000),
        description: pick(DESCRIPTIONS),
        mcc: pick(MCCS),
        counterIban: pick(IBANS),
        setsBalance: random() < FLAG_SHARE,
        changeGroupId: flag('change-1'),
        exchangePairId: flag('pair-1'),
        loanHoldingId: flag('loan-1'),
        time: new Date(
          2026,
          10,
          3 + between(-DAY_SPREAD, 3),
          between(0, 23),
          between(0, 59),
        ).getTime(),
      }),
    );
    const debitsOnCard = rows.filter(
      ({ holdingId, amountMinorUnits }) => holdingId === 'card' && amountMinorUnits < 0,
    );
    const pairs = debitsOnCard
      .filter(() => random() < PAIR_SHARE)
      .map((debit) =>
        rowOf(`credit-${debit.id}`, 0, {
          holdingId: 'card-b',
          amountMinorUnits: -debit.amountMinorUnits,
          time: debit.time + MINUTE_MS,
        }),
      );
    const funded = fundingPurchasesOf(
      debitsOnCard.filter(() => random() < FUNDED_SHARE),
      FUNDED_P2P_DELAY_MS,
    );

    return {
      rows: [...rows, ...pairs, ...funded],
      holdings: [
        holdingOf('card', 'bank-account'),
        holdingOf('card-b', 'bank-account-b', { iban: OWN_IBAN }),
        holdingOf('wallet', 'cash-account'),
        holdingOf('usdt', 'crypto-account'),
        holdingOf('old', 'archived-account'),
      ],
      accounts: [
        { id: 'bank-account', kind: 'bank', archivedAt: null },
        { id: 'bank-account-b', kind: 'bank', archivedAt: null },
        { id: 'cash-account', kind: 'cash', archivedAt: null },
        { id: 'crypto-account', kind: 'crypto', archivedAt: null },
        { id: 'archived-account', kind: 'bank', archivedAt: 1_700_000_000_000 },
      ],
    };
  };

  it('answers as the whole-ledger composition does, but for a pair and a funded debit', () => {
    const counts = { offered: 0, refused: 0, perRow: 0, blind: 0, later: 0 };

    for (const seed of SEEDS) {
      const { rows, holdings, accounts } = sweepWorldOf(seed);
      const ledger = ledgerRowsOf(rows, holdings);
      const ownIbans = ownIbansOf(holdings);
      const perRowIds = new Set([
        ...mccExcludedTransferTransactionIds(ledger, ownIbans),
        ...descriptionExcludedTransferTransactionIds(ledger),
      ]);
      const excludedIds = eligibility.recurringExcludedIds(rows, holdings, accounts);

      for (const row of rows) {
        const holding = holdings.find(({ id }) => id === row.holdingId);
        const account = accounts.find(({ id }) => id === holding?.accountId);
        const isBlind = excludedIds.has(row.id) && !perRowIds.has(row.id);
        const isOnTime = startOfDay(row.time) <= startOfDay(NOW);
        const isCandidate = eligibility.isRecurringCandidate(row, holding, account);
        const expected = isBlind
          ? isCandidate && isOnTime
          : isCandidate && !excludedIds.has(row.id) && isOnTime;

        expect(isOfferedForMark(row, holding, account, ownIbans, NOW)).toBe(expected);

        counts.offered += Number(expected);
        counts.refused += Number(!expected);
        counts.perRow += Number(perRowIds.has(row.id));
        counts.blind += Number(isBlind && isCandidate);
        counts.later += Number(isCandidate && !isOnTime);
      }
    }

    expect(Object.values(counts).every((count) => count >= MIN_PER_RUN)).toBe(true);
  });
});
