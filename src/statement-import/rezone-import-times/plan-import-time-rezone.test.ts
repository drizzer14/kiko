import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';

import { computeDedupKey } from '../mapping';
import { parseDateTimeSeconds } from '../parse-date-time';

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
  it('reads a legacy (wall-clock-as-UTC) summer instant as Kyiv local time', () => {
    const legacy = Date.UTC(2026, 8, 15, 22, 30, 0);

    expect(rezoneImportTime(legacy)).toBe(Date.UTC(2026, 8, 15, 19, 30, 0));
  });

  it('reads a legacy winter instant as Kyiv local time', () => {
    const legacy = Date.UTC(2026, 0, 15, 22, 30, 0);

    expect(rezoneImportTime(legacy)).toBe(Date.UTC(2026, 0, 15, 20, 30, 0));
  });

  it('treats a legacy exact 00:00:00 as date-only, reading it as noon Kyiv', () => {
    const legacy = Date.UTC(2026, 8, 15, 0, 0, 0);

    expect(rezoneImportTime(legacy)).toBe(Date.UTC(2026, 8, 15, 9, 0, 0));
  });

  // A stored row records no format, so the legacy digits must land on the
  // instant a fresh named-format parse of the same text gives — otherwise an
  // overlapping re-import of the same file misses every legacy key.
  it.each([
    ['Monobank', '01.04.2022 05:27:35', Date.UTC(2022, 3, 1, 5, 27, 35)],
    ['Monobank', '12.05.2023 17:30:36', Date.UTC(2023, 4, 12, 17, 30, 36)],
    ['PrivatBank', '01.07.2025 10:15:00', Date.UTC(2025, 6, 1, 10, 15, 0)],
  ])('matches a fresh %s parse of %s', (formatLabel, text, legacy) => {
    expect(rezoneImportTime(legacy)).toBe(parseDateTimeSeconds(text, formatLabel) * 1000);
  });
});

describe('planImportTimeRezone on a device outside Kyiv', () => {
  const freshKey = (text: string): string =>
    computeDedupKey(
      'holding-1',
      {
        currency: 'UAH',
        amountMinorUnits: -15000,
        timeSeconds: parseDateTimeSeconds(text, 'Monobank'),
        description: 'Coffee',
      },
      0,
    );

  it.each([
    ['UTC+1', 1, '15.06.2026 14:30:00', Date.UTC(2026, 5, 15, 14, 30, 0)],
    ['UTC+1', 1, '15.01.2026 14:30:00', Date.UTC(2026, 0, 15, 14, 30, 0)],
    ['UTC-5', -5, '15.06.2026 14:30:00', Date.UTC(2026, 5, 15, 14, 30, 0)],
    ['UTC+3', 3, '15.01.2026 14:30:00', Date.UTC(2026, 0, 15, 14, 30, 0)],
  ])(
    'rezones a legacy row under %s (%d h) onto the fresh time and key of %s',
    (_zone, offsetHours, text, legacy) => {
      const legacyKey = computeDedupKey(
        'holding-1',
        {
          currency: 'UAH',
          amountMinorUnits: -15000,
          timeSeconds: legacy / 1000,
          description: 'Coffee',
        },
        0,
      );

      const plan = withDeviceZoneOffset(offsetHours, () =>
        planImportTimeRezone([importRow({ id: 'tx-1', time: legacy, externalId: legacyKey })], []),
      );

      expect(plan.transactions).toEqual([
        {
          id: 'tx-1',
          time: parseDateTimeSeconds(text, 'Monobank') * 1000,
          externalId: freshKey(text),
        },
      ]);
    },
  );
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

  // A holding's `balanceSetAt` moves ONLY when it equals the OLD time of one
  // of ITS OWN import rows — a coincidental match on a DIFFERENT holding's
  // row, or a manual edit stamp, is never touched.
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

  // A spring-gap time, or a timed 00:00:00 row plus a 12:00:00 row with the
  // same amount and description, can collide on the FINAL key after
  // rezoning — the planner renumbers with a `␟n` suffix rather than
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
