import path from 'node:path';
import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import {
  monobankFixtureInput,
  sensebankFixtureInput,
} from '@kiko/statement-import/formats/format-test-fixtures';
import type { StatementFormatInput } from '@kiko/statement-import/parser';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { sensebankCsvFormat } from '@kiko/statement-import/formats/sensebank-csv';
import { privatbankXlsxFormat } from '@kiko/statement-import/formats/privatbank-xlsx';

import {
  planImportTimeRezone,
  rezoneDedupKey,
  rezoneImportTime,
  type RezoneHoldingInput,
  type RezoneTransactionInput,
} from './plan-import-time-rezone';

const importRow = (
  overrides: Partial<RezoneTransactionInput> & Pick<RezoneTransactionInput, 'id'>,
): RezoneTransactionInput => ({
  holdingId: 'holding-1',
  time: 0,
  externalId: null,
  ...overrides,
});

describe('rezoneImportTime', () => {
  it('reads a legacy (wall-clock-as-UTC) instant as this device local time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);

    expect(rezoneImportTime(legacy)).toBe(new Date(2026, 8, 15, 22, 30, 0).getTime());
  });

  it('treats a legacy exact 00:00:00 as date-only, reading it as noon local time', () => {
    const legacy = Date.UTC(2026, 8, 15, 0, 0, 0);

    expect(rezoneImportTime(legacy)).toBe(new Date(2026, 8, 15, 12, 0, 0).getTime());
  });

  // Every real bank-format fixture's own row: `legacyParse` (test-local
  // `Date.UTC` of the SAME raw digits) fed through `rezoneImportTime` must
  // equal the CURRENT (Kyiv) parser's own output for that row — proving the
  // planner reproduces exactly what a fresh re-import would produce, so a
  // re-import of the same old file dedups.
  it('reproduces the current Kyiv-parsed time for the Monobank fixture rows', () => {
    const dedicated = monobankCsvFormat.parse(monobankFixtureInput);
    // Row 1: "01.04.2022 05:27:35"; Row 4 (last): "12.05.2023 17:30:36" — the
    // same raw digits every dedicated format test pins.
    const legacyFirst = Date.UTC(2022, 3, 1, 5, 27, 35);
    const legacyLast = Date.UTC(2023, 4, 12, 17, 30, 36);

    expect(rezoneImportTime(legacyFirst) / 1000).toBe(dedicated.transactions[0].timeSeconds);
    expect(rezoneImportTime(legacyLast) / 1000).toBe(dedicated.transactions[3].timeSeconds);
  });

  it('reproduces the current Kyiv-parsed time for the Sensebank fixture rows', () => {
    const dedicated = sensebankCsvFormat.parse(sensebankFixtureInput);
    // Row 1: "09.01.00 00:58"; Row 2: "25.01.00 12:12" — the same raw digits
    // `sensebank-csv.format.test.ts` pins; the fixture's 2-digit year maps
    // to 20YY, same as the dedicated format's own parse.
    const legacyFirst = Date.UTC(2000, 0, 9, 0, 58, 0);
    const legacySecond = Date.UTC(2000, 0, 25, 12, 12, 0);

    expect(rezoneImportTime(legacyFirst) / 1000).toBe(dedicated.transactions[0].timeSeconds);
    expect(rezoneImportTime(legacySecond) / 1000).toBe(dedicated.transactions[1].timeSeconds);
  });

  it('reproduces the current Kyiv-parsed time for the PrivatBank XLSX fixture rows', async () => {
    const buffer = readFileSync(
      path.join(
        __dirname,
        '../formats/privatbank-xlsx/__fixtures__/synthetic-privatbank-sample.xlsx',
      ),
    );
    const sheets = await readXlsxFile(buffer);
    const input: StatementFormatInput = {
      text: '',
      fileName: 'synthetic-privatbank-sample.xlsx',
      sheetRows: sheets[0].data as StatementFormatInput['sheetRows'],
    };
    const dedicated = privatbankXlsxFormat.parse(input);
    // The fixture's own first resolvable row's real cell text,
    // "01.07.2025 10:15:00" — pinned in `privatbank-xlsx.format.test.ts`.
    const legacy = Date.UTC(2025, 6, 1, 10, 15, 0);

    expect(rezoneImportTime(legacy) / 1000).toBe(dedicated.transactions[0].timeSeconds);
  });
});

describe('rezoneDedupKey', () => {
  it('rewrites the time token when it equals the old seconds, keeping every other part', () => {
    expect(rezoneDedupKey('holding-1 1000 -500 coffee', 1000, 2000)).toBe(
      'holding-1 2000 -500 coffee',
    );
  });

  it('keeps a legacy space-joined occurrence suffix untouched', () => {
    expect(rezoneDedupKey('holding-1 1000 -500 coffee 1', 1000, 2000)).toBe(
      'holding-1 2000 -500 coffee 1',
    );
  });

  it('keeps an injective ␟-joined occurrence suffix untouched', () => {
    expect(rezoneDedupKey('holding-1 1000 -500 coffee␟1', 1000, 2000)).toBe(
      'holding-1 2000 -500 coffee␟1',
    );
  });

  it('returns null (no rewrite) for a null externalId', () => {
    expect(rezoneDedupKey(null, 1000, 2000)).toBeNull();
  });

  it('returns null (no rewrite) when the second token does not equal the old seconds', () => {
    expect(rezoneDedupKey('holding-1 999 -500 coffee', 1000, 2000)).toBeNull();
  });

  it('returns null (no rewrite) for a foreign-shaped key with no time token', () => {
    expect(rezoneDedupKey('bank-issued-id-42', 1000, 2000)).toBeNull();
  });
});

describe('planImportTimeRezone', () => {
  it('returns an empty plan for empty input', () => {
    expect(planImportTimeRezone([], [])).toEqual({ transactions: [], holdings: [] });
  });

  it('moves every import row time and rewrites its dedup key', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const row = importRow({
      id: 'tx-1',
      time: legacy,
      externalId: `holding-1 ${legacy / 1000} -500 coffee`,
    });

    const plan = planImportTimeRezone([row], []);

    expect(plan.transactions).toEqual([
      {
        id: 'tx-1',
        time: rezoneImportTime(legacy),
        externalId: `holding-1 ${rezoneImportTime(legacy) / 1000} -500 coffee`,
      },
    ]);
  });

  it('leaves a foreign-shaped key alone but still moves its time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const row = importRow({ id: 'tx-1', time: legacy, externalId: 'bank-issued-id-42' });

    const plan = planImportTimeRezone([row], []);

    expect(plan.transactions).toEqual([
      { id: 'tx-1', time: rezoneImportTime(legacy), externalId: 'bank-issued-id-42' },
    ]);
  });

  // Decision 8: a holding's `balanceSetAt` moves ONLY when it equals the OLD
  // time of one of ITS OWN import rows.
  it('moves a balanceSetAt that equals one of the holding’s own import rows old time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const row = importRow({ id: 'tx-1', time: legacy, externalId: null });
    const holding: RezoneHoldingInput = { id: 'holding-1', balanceSetAt: legacy };

    const plan = planImportTimeRezone([row], [holding]);

    expect(plan.holdings).toEqual([{ id: 'holding-1', balanceSetAt: rezoneImportTime(legacy) }]);
  });

  it('never moves a manual/edit balanceSetAt stamp that matches no import row time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const row = importRow({ id: 'tx-1', time: legacy });
    const holding: RezoneHoldingInput = { id: 'holding-1', balanceSetAt: 1_790_000_000_123 };

    const plan = planImportTimeRezone([row], [holding]);

    expect(plan.holdings).toEqual([]);
  });

  it('never moves a balanceSetAt that only matches ANOTHER holding’s import row time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const rowOnHoldingA = importRow({ id: 'tx-1', holdingId: 'holding-A', time: legacy });
    const holdingB: RezoneHoldingInput = { id: 'holding-B', balanceSetAt: legacy };

    const plan = planImportTimeRezone([rowOnHoldingA], [holdingB]);

    expect(plan.holdings).toEqual([]);
  });

  it('never touches a holding with a null balanceSetAt', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);
    const row = importRow({ id: 'tx-1', time: legacy });
    const holding: RezoneHoldingInput = { id: 'holding-1', balanceSetAt: null };

    const plan = planImportTimeRezone([row], [holding]);

    expect(plan.holdings).toEqual([]);
  });

  // Decision 6: a spring-gap time, or a timed 00:00:00 row plus a 12:00:00
  // row with the same amount and description, can collide on the FINAL key
  // after rezoning — the planner renumbers with a `␟n` suffix rather than
  // throwing.
  it('renumbers a collision between a midnight row and a noon row that rezone to the same instant', () => {
    const midnightLegacy = Date.UTC(2026, 8, 15, 0, 0, 0);
    const noonLegacy = Date.UTC(2026, 8, 15, 12, 0, 0);
    const midnightRow = importRow({
      id: 'tx-midnight',
      time: midnightLegacy,
      externalId: `holding-1 ${midnightLegacy / 1000} -500 coffee`,
    });
    const noonRow = importRow({
      id: 'tx-noon',
      time: noonLegacy,
      externalId: `holding-1 ${noonLegacy / 1000} -500 coffee`,
    });

    const plan = planImportTimeRezone([midnightRow, noonRow], []);
    const byId = new Map(plan.transactions.map((row) => [row.id, row]));
    const rezonedSeconds = rezoneImportTime(midnightLegacy) / 1000;

    expect(byId.get('tx-midnight')?.externalId).toBe(`holding-1 ${rezonedSeconds} -500 coffee`);
    expect(byId.get('tx-noon')?.externalId).toBe(`holding-1 ${rezonedSeconds} -500 coffee␟1`);
    // Both rows still land on the exact same rezoned instant.
    expect(byId.get('tx-midnight')?.time).toBe(byId.get('tx-noon')?.time);
    // The two final keys are unique.
    expect(byId.get('tx-midnight')?.externalId).not.toBe(byId.get('tx-noon')?.externalId);
  });

  it('never throws on a collision', () => {
    const legacy = Date.UTC(2026, 8, 15, 0, 0, 0);
    const rows = [
      importRow({ id: 'tx-1', time: legacy, externalId: `holding-1 ${legacy / 1000} -500 coffee` }),
      importRow({ id: 'tx-2', time: legacy, externalId: `holding-1 ${legacy / 1000} -500 coffee` }),
      importRow({ id: 'tx-3', time: legacy, externalId: `holding-1 ${legacy / 1000} -500 coffee` }),
    ];

    expect(() => planImportTimeRezone(rows, [])).not.toThrow();

    const plan = planImportTimeRezone(rows, []);
    const keys = plan.transactions.map((row) => row.externalId);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
