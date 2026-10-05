import { SYNC_MATCH_WINDOW_MILLISECONDS, pairSyncInputsWithImportRows } from './sync-adoption';

const SECOND = 1_000;
const T = Date.UTC(2026, 8, 20, 10);

const syncInput = (
  externalId: string,
  time: number,
  amountMinorUnits = -5_000,
  holdingId = 'h',
) => ({
  holdingId,
  amountMinorUnits,
  time,
  externalId,
});

const importRow = (id: string, time: number, amountMinorUnits = -5_000, holdingId = 'h') => ({
  id,
  holdingId,
  amountMinorUnits,
  time,
  externalId: id,
});

const pairs = (
  inputs: ReturnType<typeof syncInput>[],
  candidates: ReturnType<typeof importRow>[],
) => {
  const { adoptions, inserts } = pairSyncInputsWithImportRows(inputs, candidates);

  return {
    adopted: adoptions.map(({ candidate, input }) => [candidate.id, input.externalId]),
    inserted: inserts.map((input) => input.externalId),
  };
};

describe('pairSyncInputsWithImportRows', () => {
  it('uses the same 60 second window the statement import holds its rows by', () => {
    expect(SYNC_MATCH_WINDOW_MILLISECONDS).toBe(60 * SECOND);
  });

  it('pairs each sync input with its own import row one to one', () => {
    expect(
      pairs(
        [syncInput('k1', T + 5 * SECOND), syncInput('k2', T + 40 * SECOND)],
        [importRow('i1', T), importRow('i2', T + 30 * SECOND)],
      ),
    ).toEqual({
      adopted: [
        ['i1', 'k1'],
        ['i2', 'k2'],
      ],
      inserted: [],
    });
  });

  it('adopts only the earliest of two import rows for one sync input', () => {
    expect(
      pairs(
        [syncInput('k1', T + 20 * SECOND)],
        [importRow('i2', T + 30 * SECOND), importRow('i1', T)],
      ),
    ).toEqual({ adopted: [['i1', 'k1']], inserted: [] });
  });

  it('inserts the sync input an import row has already been given to', () => {
    expect(
      pairs(
        [syncInput('k1', T + 5 * SECOND), syncInput('k2', T + 40 * SECOND)],
        [importRow('i1', T)],
      ),
    ).toEqual({ adopted: [['i1', 'k1']], inserted: ['k2'] });
  });

  it('inserts a sync input with no import row of its amount near it', () => {
    expect(pairs([syncInput('k1', T)], [])).toEqual({ adopted: [], inserted: ['k1'] });
  });

  it.each([
    ['dated 61 seconds before is out of reach', -61 * SECOND, false],
    ['dated 60 seconds before is in reach', -60 * SECOND, true],
    ['dated 60 seconds after is in reach', 60 * SECOND, true],
    ['dated 61 seconds after is out of reach', 61 * SECOND, false],
  ])('an import row %s', (_name, offset, adopted) => {
    expect(pairs([syncInput('k1', T)], [importRow('i1', T + offset)]).adopted).toHaveLength(
      adopted ? 1 : 0,
    );
  });

  it('never pairs rows of different holdings', () => {
    expect(pairs([syncInput('k1', T)], [importRow('i1', T, -5_000, 'other')])).toEqual({
      adopted: [],
      inserted: ['k1'],
    });
  });

  it('never pairs a purchase with a refund of the same size', () => {
    expect(pairs([syncInput('k1', T)], [importRow('i1', T, 5_000)])).toEqual({
      adopted: [],
      inserted: ['k1'],
    });
  });

  it('pairs a purchase and its reversal each with its own sign', () => {
    expect(
      pairs(
        [syncInput('k1', T + SECOND), syncInput('k2', T + 12 * SECOND, 5_000)],
        [importRow('i2', T + 10 * SECOND, 5_000), importRow('i1', T)],
      ),
    ).toEqual({
      adopted: [
        ['i1', 'k1'],
        ['i2', 'k2'],
      ],
      inserted: [],
    });
  });

  it('leaves an import row with no sync twin out of every adoption', () => {
    const hour = 3_600 * SECOND;

    expect(
      pairs(
        [
          syncInput('k1', T - hour + 2 * SECOND, -1_000),
          syncInput('k2', T + hour + SECOND, -2_000),
          syncInput('k3', T + 4 * hour, -4_000),
        ],
        [
          importRow('i1', T - hour, -1_000),
          importRow('i2', T + hour, -2_000),
          importRow('i3', T + 3 * hour, -3_000),
          importRow('i4', T + 5 * hour, -9_900),
        ],
      ),
    ).toEqual({
      adopted: [
        ['i1', 'k1'],
        ['i2', 'k2'],
      ],
      inserted: ['k3'],
    });
  });

  it('takes the earliest import row in reach, not the nearest', () => {
    expect(
      pairs(
        [syncInput('k1', T), syncInput('k2', T + 25 * SECOND)],
        [importRow('i1', T - 10 * SECOND), importRow('i2', T + 10 * SECOND)],
      ),
    ).toEqual({
      adopted: [
        ['i1', 'k1'],
        ['i2', 'k2'],
      ],
      inserted: [],
    });
  });

  it('pairs as many rows as any pairing can where the nearest pair would strand one', () => {
    expect(
      pairs(
        [syncInput('k2', T + 130 * SECOND), syncInput('k1', T + 60 * SECOND)],
        [importRow('i2', T + 70 * SECOND), importRow('i1', T)],
      ),
    ).toEqual({
      adopted: [
        ['i1', 'k1'],
        ['i2', 'k2'],
      ],
      inserted: [],
    });
  });

  it('breaks a tie between import rows at one instant by external id', () => {
    expect(
      pairs([syncInput('k1', T)], [importRow('statement-1␟1', T), importRow('statement-1', T)]),
    ).toEqual({ adopted: [['statement-1', 'k1']], inserted: [] });
  });

  it('claims sync inputs at one instant in external id order, whatever the fetch order', () => {
    expect(pairs([syncInput('k2', T), syncInput('k1', T)], [importRow('i1', T)])).toEqual({
      adopted: [['i1', 'k1']],
      inserted: ['k2'],
    });
  });

  it('keeps the fetch order of the inputs it inserts', () => {
    expect(
      pairs(
        [syncInput('k3', T + 200 * SECOND), syncInput('k1', T), syncInput('k2', T + 100 * SECOND)],
        [],
      ).inserted,
    ).toEqual(['k3', 'k1', 'k2']);
  });

  it('inserts an input with no external id, which has no key to adopt under', () => {
    const { externalId: _externalId, ...keyless } = syncInput('k1', T);

    expect(pairSyncInputsWithImportRows([keyless], [importRow('i1', T)])).toEqual({
      adoptions: [],
      inserts: [keyless],
    });
  });

  it('does not reorder the arrays it is given', () => {
    const inputs = [syncInput('k2', T + SECOND), syncInput('k1', T)];
    const candidates = [importRow('i2', T + SECOND), importRow('i1', T)];

    pairSyncInputsWithImportRows(inputs, candidates);

    expect(inputs.map(({ externalId }) => externalId)).toEqual(['k2', 'k1']);
    expect(candidates.map(({ id }) => id)).toEqual(['i2', 'i1']);
  });
});
