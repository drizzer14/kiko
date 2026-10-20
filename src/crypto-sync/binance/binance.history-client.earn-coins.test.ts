import { type EarnRecordKind, fetchEarnRecords } from './binance.history-client';

const NOW = 1_704_326_400_000;
const TIME = NOW - 1_000;

/** A whole row of each kind, in BTC, as Binance sends it; the settled status is the kind's own. */
const EARN_ROWS: Record<EarnRecordKind, Record<string, unknown>> = {
  flexibleSubscription: {
    amount: '1',
    asset: 'BTC',
    time: TIME,
    purchaseId: 'p-1',
    status: 'SUCCESS',
  },
  flexibleRedemption: {
    amount: '1',
    asset: 'BTC',
    time: TIME,
    redeemId: 'r-1',
    status: 'PAID',
  },
  flexibleRewards: { asset: 'BTC', rewards: '1', projectId: 'p', type: 'REALTIME', time: TIME },
  lockedSubscription: {
    positionId: 'pos-1',
    purchaseId: 'p-1',
    time: TIME,
    asset: 'BTC',
    amount: '1',
    status: 'SUCCESS',
  },
  lockedRedemption: {
    positionId: 'pos-1',
    redeemId: 'r-1',
    time: TIME,
    asset: 'BTC',
    amount: '1',
    status: 'PAID',
  },
  lockedRewards: { positionId: 'pos-1', time: TIME, asset: 'BTC', amount: '1', type: 'Booster' },
};

const KINDS = Object.keys(EARN_ROWS) as EarnRecordKind[];

/** The status a row of each kind has once it went through; a reward has none. */
const SETTLED_STATUS: Record<EarnRecordKind, string | undefined> = {
  flexibleSubscription: 'SUCCESS',
  flexibleRedemption: 'PAID',
  flexibleRewards: undefined,
  lockedSubscription: 'SUCCESS',
  lockedRedemption: 'PAID',
  lockedRewards: undefined,
};

const readEarn = (kind: EarnRecordKind, rows: unknown[]) =>
  fetchEarnRecords(
    'api-key-fixture',
    'secret-fixture',
    kind,
    { startTime: NOW - 10_000, endTime: NOW, current: 1 },
    {
      fetchImpl: (async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ total: rows.length, rows }),
      })) as unknown as typeof fetch,
      now: () => NOW,
    },
  );

describe.each(KINDS)('the asset of a %s row', (kind) => {
  const row = EARN_ROWS[kind];

  it('reads a tracked asset of any case or padding upper-cased, once', async () => {
    const page = await readEarn(kind, [{ ...row, asset: ' usdt ' }]);

    expect(page.rows).toEqual([expect.objectContaining({ asset: 'USDT' })]);
    expect(page.untracked).toEqual([]);
    expect(page.unreadable).toEqual([]);
  });

  it('reads an incomplete row of a tracked asset as unreadable, never as untracked', async () => {
    const page = await readEarn(kind, [{ asset: 'ETH', time: TIME }]);

    expect(page.rows).toEqual([]);
    expect(page.untracked).toEqual([]);
    expect(page.unreadable).toEqual([{ time: TIME }]);
  });

  it('reports a row of an untracked asset by its upper-cased ticker, status and time alone', async () => {
    const page = await readEarn(kind, [{ ...row, asset: ' xyz ', amount: 'secret-amount' }]);

    expect(page.rows).toEqual([]);
    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: 'XYZ', status: SETTLED_STATUS[kind], time: TIME }]);
    expect(JSON.stringify(page.untracked)).not.toMatch(/secret/);
  });

  it('never parses a row of an untracked asset, whatever else is wrong with it', async () => {
    const page = await readEarn(kind, [{ asset: 'XYZ' }]);

    expect(page.unreadable).toEqual([]);
    expect(page.untracked).toEqual([{ ticker: 'XYZ', status: undefined, time: undefined }]);
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
  ])(
    'reads a settled row whose asset is %s as unreadable, never as untracked',
    async (_label, asset) => {
      const page = await readEarn(kind, [{ ...row, asset }]);

      expect(page.rows).toEqual([]);
      expect(page.untracked).toEqual([]);
      expect(page.unreadable).toEqual([{ time: TIME }]);
    },
  );

  it('counts every row of the page, tracked, untracked and unreadable', async () => {
    const page = await readEarn(kind, [row, { ...row, asset: 'XYZ' }, { ...row, time: 'x' }]);

    expect([page.rows.length, page.untracked.length, page.unreadable.length]).toEqual([1, 1, 1]);
    expect(page.gathered).toBe(3);
  });
});

describe.each(KINDS.filter((kind) => SETTLED_STATUS[kind] !== undefined))(
  'a %s row that is not settled yet',
  (kind) => {
    it('is counted with an empty ticker when its asset is blank: it can import no row yet', async () => {
      const page = await readEarn(kind, [{ ...EARN_ROWS[kind], asset: '', status: 'PENDING' }]);

      expect(page.unreadable).toEqual([]);
      expect(page.untracked).toEqual([{ ticker: '', status: 'PENDING', time: TIME }]);
    });
  },
);
