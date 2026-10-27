import { binanceWalkPendingValueOf, binanceWalkSpanHintsValueOf } from './walk-values';

describe('a walk list of owed ground that carries a scope', () => {
  it('reads a range owed to the backfill with its scope', () => {
    expect(binanceWalkPendingValueOf([{ start: 10, end: 20, scope: 'backfill' }])).toEqual([
      { start: 10, end: 20, scope: 'backfill' },
    ]);
  });

  it('reads a range owed to the backfill in one series with both', () => {
    expect(
      binanceWalkPendingValueOf([
        { start: 10, end: 20, series: 'MAIN_FUNDING', scope: 'backfill' },
      ]),
    ).toEqual([{ start: 10, end: 20, series: 'MAIN_FUNDING', scope: 'backfill' }]);
  });

  it('reads a point owed to the backfill with its scope, its series and its time', () => {
    expect(
      binanceWalkPendingValueOf([
        { start: 10, end: 20, kind: 'point', series: 'MAIN_FUNDING', since: 5, scope: 'backfill' },
      ]),
    ).toEqual([
      { start: 10, end: 20, kind: 'point', series: 'MAIN_FUNDING', since: 5, scope: 'backfill' },
    ]);
  });

  it('reads a range with no scope as owed for every coin', () => {
    expect(binanceWalkPendingValueOf([{ start: 10, end: 20 }])).toEqual([{ start: 10, end: 20 }]);
  });

  it.each([
    ['a scope it does not know', 'live'],
    ['a scope that is no text', 1],
    ['a null scope', null],
    ['an empty scope', ''],
  ])('reads a list holding %s as malformed', (_label, scope) => {
    expect(
      binanceWalkPendingValueOf([
        { start: 1, end: 2 },
        { start: 10, end: 20, scope },
      ]),
    ).toBeUndefined();
  });
});

describe('a walk span hint whose resume carries a scope', () => {
  const hintsOf = (resume: Record<string, unknown>) =>
    binanceWalkSpanHintsValueOf({
      forward: [],
      pending: [],
      rescan: [],
      point: [{ start: 10, end: 40, resume: { from: 20, returned: [], stuck: [], ...resume } }],
    });

  it('reads the scope of a resume', () => {
    expect(hintsOf({ scope: 'backfill' })?.point[0].resume).toEqual({
      from: 20,
      returned: [],
      stuck: [],
      scope: 'backfill',
    });
  });

  it('reads a resume with no scope as made for every coin', () => {
    expect(hintsOf({})?.point[0].resume).toEqual({ from: 20, returned: [], stuck: [] });
  });

  it('reads hints holding a resume with a scope it does not know as malformed', () => {
    expect(hintsOf({ scope: 'live' })).toBeUndefined();
  });
});
