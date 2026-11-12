// A Monobank card takes the dated read of a Bybit holding: the fast phase writes the time of its
// client-info read, a read lists the typed rows it overwrote, the line holds the last read, and a
// delete or an edit of a row on the list moves no balance. This file builds the card the way a
// device does: a real `runSync` over a faked network writes the balance and the statement rows,
// rows the user types come in through `recordManual`, and the line is the one `createHoldingValuer`
// draws from what the database holds. A card that shipped before the read was dated is seeded by
// raw SQL, one seed per case.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () =>
  require('@kiko/test-support/real-sqlite').databaseClientOver(() => mockDatabase),
);
jest.mock('@kiko/monobank/token', () => ({ clearToken: jest.fn(async () => undefined) }));

import { DatabaseSync } from 'node:sqlite';
import { isRecord } from '@kiko/type-guards';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { at } from '@kiko/test-support/past-line-world';
import { transactionsRepo } from '@kiko/transactions/repo';
import statement from '@kiko/monobank/__fixtures__/statement.json';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import clientInfo from '@kiko/monobank/__fixtures__/client-info.json';
import { createHoldingValuer, type SeriesTransaction } from '@kiko/statistics/holding-value-at';

import { disconnectMonobank } from '../disconnect';
import type { MonobankAccount, MonobankStatementItem } from '../monobank-types';

import { runSync } from './sync';

const ACCOUNT_ID = 'acc-1';
const SECOND = 1_000;
const THOUSAND = 100_000;
const NINE_HUNDRED = 90_000;
const HUNDRED = 10_000;
const FIFTY = 5_000;
const TWENTY = 2_000;
const THIRTY = 3_000;
const SEVENTY = 7_000;
const ONE_FIFTY = 15_000;
const [CARD, OTHER_CARD] = clientInfo.accounts;

// The card as the bank answers for it, at a balance.
const cardAt = (balance: number): MonobankAccount[] => [{ ...CARD, balance } as MonobankAccount];

const itemAt = (id: string, time: number, amount: number): MonobankStatementItem => ({
  ...(statement[0] as MonobankStatementItem),
  id,
  amount,
  operationAmount: amount,
  time: time / SECOND,
});

const storedCard = async () => {
  const holding = (await holdingsRepo.listByAccountQuery(ACCOUNT_ID)).find(
    ({ metadata }) => isRecord(metadata) && metadata.monobankId === CARD.id,
  );

  if (holding === undefined) {
    throw new Error('the account should hold its card by now');
  }

  return holding;
};

type Answer = {
  accounts?: MonobankAccount[];
  payments?: MonobankStatementItem[];
  statementTakes?: number;
};

// A run over the bank's answer: the card at `balance` unless the answer lists other cards, and
// `payments` handed back by the statement read whatever its window, since the bank's clock can be
// ahead of the device's and a payment then is dated after the read time of the run that imports it.
// The device's clock stands at `time` until the statement read, which takes `statementTakes` more:
// a read time taken after that read is a later time than the answer's.
const readOfCard = (
  time: number,
  balance: number,
  { accounts = cardAt(balance), payments = [], statementTakes = 0 }: Answer = {},
): ReturnType<typeof runSync> => {
  let clock = time;

  return runSync({
    targetAccountId: ACCOUNT_ID,
    now: () => clock,
    sleep: async () => undefined,
    readToken: async () => 'token',
    fetchClientInfo: async () => ({ accounts, jars: [] }),
    fetchStatement: async () => {
      clock += statementTakes;

      return payments;
    },
  });
};

const typedRowAt = async (time: number, amountMinorUnits: number): Promise<string> => {
  const { id } = await storedCard();

  return transactionsRepo.recordManual({ holdingId: id, amountMinorUnits, time });
};

// The card's line at local midnight of each day from `firstDay` to `lastDay`, in minor units.
const lineFrom = async (firstDay: number, lastDay: number): Promise<number[]> => {
  const holding = await storedCard();
  const rows = mockDatabase
    .prepare(
      'SELECT id, time, amount_minor_units AS amountMinorUnits, source FROM transactions WHERE holding_id = ?',
    )
    .all(holding.id) as SeriesTransaction[];
  const valueAt = createHoldingValuer(holding, rows);

  return Array.from({ length: lastDay - firstDay + 1 }, (_, index) =>
    valueAt(at(firstDay + index, 0)),
  );
};

// The confirm's balance changes of a delete, which the delete then carries out.
const deletedRowChanges = async (rowId: string): Promise<unknown> => {
  const { balanceChanges } = await transactionsRepo.removePlan(rowId);

  await transactionsRepo.remove(rowId);

  return balanceChanges;
};

// A card as the release before the dated read stored it: a key and its balance, no read time.
const seedShippedCard = (balanceMinorUnits: number): void => {
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES ('shipped', ?, '1234', 'card', 'UAH', ?, ?)`,
    )
    .run(
      ACCOUNT_ID,
      balanceMinorUnits,
      JSON.stringify({ monobankId: CARD.id, iban: CARD.iban, maskedPan: CARD.maskedPan }),
    );
};

const seedRow = (
  id: string,
  source: 'manual' | 'monobank' | 'import',
  time: number,
  amountMinorUnits: number,
): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
       VALUES (?, 'shipped', ?, ?, ?, ?)`,
    )
    .run(id, amountMinorUnits, time, source, source === 'manual' ? null : `${ACCOUNT_ID}:${id}`);
};

const readMetadata = (balanceReadAt: number) => ({
  monobankId: CARD.id,
  iban: CARD.iban,
  maskedPan: CARD.maskedPan,
  balanceReadAt,
});

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase
    .prepare(
      "INSERT INTO accounts (id, name, kind, institution) VALUES (?, 'Monobank', 'bank', 'monobank')",
    )
    .run(ACCOUNT_ID);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the line of a Monobank card whose balance is older than its rows, on real SQLite', () => {
  it('a payment dated after the read of its run stays off the line until the next run, which counts it', async () => {
    const payment = itemAt('payment', at(0, 10) + SECOND, -HUNDRED);

    await readOfCard(at(0, 10), THOUSAND, { payments: [payment], statementTakes: 2 * SECOND });

    expect(await lineFrom(-1, 1)).toEqual([THOUSAND, THOUSAND, THOUSAND]);
    expect((await storedCard()).metadata).toMatchObject({ balanceReadAt: at(0, 10) });

    await readOfCard(at(1, 10), NINE_HUNDRED);

    expect(await lineFrom(-1, 1)).toEqual([THOUSAND, NINE_HUNDRED, NINE_HUNDRED]);
  });
});

describe('the line of a Monobank card whose read overwrote rows the user typed, on real SQLite', () => {
  // Read 100, disconnect, type +50 (the balance moves to 150), reconnect, read 100 again.
  const typedRowThenReadOfAHundred = async (): Promise<string> => {
    await readOfCard(at(0, 10), HUNDRED);
    await accountsRepo.disconnect(ACCOUNT_ID);

    const typedRowId = await typedRowAt(at(1, 9), FIFTY);

    await readOfCard(at(2, 10), HUNDRED);

    return typedRowId;
  };

  it('the typed row is left off the line, and Home shows the read', async () => {
    const typedRowId = await typedRowThenReadOfAHundred();
    const holding = await storedCard();

    expect(await lineFrom(-1, 3)).toEqual([HUNDRED, HUNDRED, HUNDRED, HUNDRED, HUNDRED]);
    expect(holding.balanceMinorUnits).toBe(HUNDRED);
    expect(holding.metadata).toMatchObject({
      balanceReadAt: at(2, 10),
      overwrittenRowIds: [typedRowId],
    });
  });

  it('a manual row on the mark moves no balance on delete', async () => {
    const typedRowId = await typedRowThenReadOfAHundred();

    expect(await deletedRowChanges(typedRowId)).toBeUndefined();
    expect((await storedCard()).balanceMinorUnits).toBe(HUNDRED);
    expect(await lineFrom(-1, 3)).toEqual([HUNDRED, HUNDRED, HUNDRED, HUNDRED, HUNDRED]);
  });

  it('a manual row on the mark moves no balance on edit, and keeps its id', async () => {
    const typedRowId = await typedRowThenReadOfAHundred();

    await transactionsRepo.update({
      transactionId: typedRowId,
      amountMinorUnits: SEVENTY,
      time: at(1, 9),
    });

    expect((await storedCard()).balanceMinorUnits).toBe(HUNDRED);
    expect(await lineFrom(-1, 3)).toEqual([HUNDRED, HUNDRED, HUNDRED, HUNDRED, HUNDRED]);
    expect(
      mockDatabase.prepare('SELECT id, amount_minor_units AS amount FROM transactions').all(),
    ).toEqual([{ id: typedRowId, amount: SEVENTY }]);
  });

  it('an import row stays off the mark and keeps counting', async () => {
    await readOfCard(at(0, 10), ONE_FIFTY);
    await accountsRepo.disconnect(ACCOUNT_ID);

    const { id } = await storedCard();

    mockDatabase
      .prepare(
        `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id)
         VALUES ('statement-row', ?, ?, ?, 'import', 'statement-row')`,
      )
      .run(id, FIFTY, at(1, 9));

    const typedRowId = await typedRowAt(at(2, 9), TWENTY);

    await readOfCard(at(3, 10), ONE_FIFTY);

    expect((await storedCard()).metadata).toMatchObject({ overwrittenRowIds: [typedRowId] });
    expect(await lineFrom(0, 3)).toEqual([HUNDRED, ONE_FIFTY, ONE_FIFTY, ONE_FIFTY]);
  });
});

describe('the line of a Monobank card that shipped with no read time, on real SQLite', () => {
  it('an undated card counts every row, a card payment and a typed row alike', async () => {
    seedShippedCard(HUNDRED);
    seedRow('payment', 'monobank', at(1, 9), -TWENTY);
    seedRow('typed-row', 'manual', at(1, 9), FIFTY);

    expect(await lineFrom(-1, 2)).toEqual([HUNDRED - THIRTY, HUNDRED - THIRTY, HUNDRED, HUNDRED]);
  });
});

describe('the line of a Monobank card that shipped with a row the user typed, on real SQLite', () => {
  // The card at 150 as the release before the dated read stored it, with a +50 the user typed long
  // before, which that balance holds. Seeded per pin, since each pin names its own world.
  const seedShippedCardWithTypedRow = (): void => {
    seedShippedCard(ONE_FIFTY);
    seedRow('typed-row', 'manual', at(1, 9), FIFTY);
  };

  const lineOfTheTypedRow = [HUNDRED, HUNDRED, ONE_FIFTY, ONE_FIFTY, ONE_FIFTY];

  it('the first dated read writes the date and no mark, and the old typed row keeps counting', async () => {
    seedShippedCardWithTypedRow();

    expect(await lineFrom(-1, 3)).toEqual(lineOfTheTypedRow);

    await readOfCard(at(2, 10), ONE_FIFTY);

    expect((await storedCard()).metadata).toEqual({
      ...readMetadata(at(2, 10)),
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual(lineOfTheTypedRow);
  });

  it('the old typed row stays off the mark at the second and the third dated read, with a disconnect between them, and keeps counting', async () => {
    seedShippedCardWithTypedRow();

    for (const day of [2, 3, 4]) {
      await readOfCard(at(day, 10), ONE_FIFTY);

      expect((await storedCard()).metadata).toEqual({
        ...readMetadata(at(day, 10)),
        keptRowIds: ['typed-row'],
      });
      expect(await lineFrom(-1, 3)).toEqual(lineOfTheTypedRow);

      await accountsRepo.disconnect(ACCOUNT_ID);
    }
  });

  it('a delete of the old typed row after the third dated read moves the balance as today', async () => {
    seedShippedCardWithTypedRow();
    await readOfCard(at(2, 10), ONE_FIFTY);
    await readOfCard(at(3, 10), ONE_FIFTY);
    await readOfCard(at(4, 10), ONE_FIFTY);

    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedCard()).balanceMinorUnits).toBe(HUNDRED);
  });

  it('a manual row typed after the first dated read is on the mark of the next read', async () => {
    seedShippedCardWithTypedRow();
    await readOfCard(at(2, 10), ONE_FIFTY);
    await accountsRepo.disconnect(ACCOUNT_ID);

    const laterRowId = await typedRowAt(at(3, 9), TWENTY);

    await readOfCard(at(4, 10), ONE_FIFTY);

    expect((await storedCard()).metadata).toEqual({
      ...readMetadata(at(4, 10)),
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual(lineOfTheTypedRow);

    await transactionsRepo.remove(laterRowId);

    expect((await storedCard()).balanceMinorUnits).toBe(ONE_FIFTY);
  });
});

describe('the read time, the mark and the kept list of a Monobank card, through a close and a disconnect, on real SQLite', () => {
  // A card that shipped at 150 with a +50 typed long before, read, then a +20 typed while it was
  // disconnected, and read again: the read time, the mark of the +20 and the kept list of the +50.
  const markedCard = async (): Promise<string> => {
    seedShippedCard(ONE_FIFTY);
    seedRow('typed-row', 'manual', at(1, 9), FIFTY);
    await readOfCard(at(2, 10), ONE_FIFTY);
    await accountsRepo.disconnect(ACCOUNT_ID);

    const laterRowId = await typedRowAt(at(3, 9), TWENTY);

    await readOfCard(at(4, 10), ONE_FIFTY);

    return laterRowId;
  };

  const lineOfTheMarkedCard = [HUNDRED, HUNDRED, ONE_FIFTY, ONE_FIFTY, ONE_FIFTY];

  const cardRow = () =>
    mockDatabase
      .prepare(
        "SELECT closed_at AS closedAt, metadata FROM holdings WHERE json_extract(metadata, '$.monobankId') = ?",
      )
      .get(CARD.id) as { closedAt: number | null; metadata: string };

  const cardMetadata = (): Record<string, unknown> => JSON.parse(cardRow().metadata);

  it('a sync-closed card keeps its read time, its mark and its kept list through the reopen', async () => {
    const laterRowId = await markedCard();

    await readOfCard(at(44, 10), 0, { accounts: [OTHER_CARD as MonobankAccount] });

    expect(cardRow().closedAt).not.toBeNull();
    expect(cardMetadata()).toMatchObject({
      balanceReadAt: at(4, 10),
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
      syncClosedFromMs: expect.any(Number),
    });

    await readOfCard(at(46, 10), ONE_FIFTY);

    expect(cardRow().closedAt).toBeNull();
    expect(cardMetadata()).toEqual({
      ...readMetadata(at(46, 10)),
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual(lineOfTheMarkedCard);
  });

  it('a disconnect keeps the read time, the mark and the kept list, so the old row counts and the marked row moves nothing', async () => {
    const laterRowId = await markedCard();

    await disconnectMonobank(ACCOUNT_ID);

    expect(cardMetadata()).toEqual({
      ...readMetadata(at(4, 10)),
      overwrittenRowIds: [laterRowId],
      keptRowIds: ['typed-row'],
    });
    expect(await lineFrom(-1, 3)).toEqual(lineOfTheMarkedCard);
    expect(await deletedRowChanges(laterRowId)).toBeUndefined();
    expect((await storedCard()).balanceMinorUnits).toBe(ONE_FIFTY);
    expect(await deletedRowChanges('typed-row')).toBeDefined();
    expect((await storedCard()).balanceMinorUnits).toBe(HUNDRED);
  });
});
