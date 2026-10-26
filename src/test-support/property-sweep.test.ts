import { DEVELOPMENT_SWEEP_COUNT, PROPERTY_SWEEP_VARIABLE, sweep } from './property-sweep';

const range = (length: number): number[] => Array.from({ length }, (_unused, position) => position);

describe('sweep', () => {
  const original = process.env[PROPERTY_SWEEP_VARIABLE];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[PROPERTY_SWEEP_VARIABLE];
    } else {
      process.env[PROPERTY_SWEEP_VARIABLE] = original;
    }
  });

  it('returns every entry when KIKO_PROPERTY_SWEEP is full', () => {
    process.env[PROPERTY_SWEEP_VARIABLE] = 'full';
    const seeds = Array.from({ length: 25 }, (_unused, position) => 3 + position * 8);

    expect(sweep(seeds)).toEqual(seeds);
  });

  it('returns the first, middle and last entry in a dev run', () => {
    delete process.env[PROPERTY_SWEEP_VARIABLE];

    expect(sweep(range(25))).toEqual([0, 12, 24]);
    expect(sweep(range(25))).toHaveLength(DEVELOPMENT_SWEEP_COUNT);
  });

  it('spreads 40 and 100 entries the same way', () => {
    delete process.env[PROPERTY_SWEEP_VARIABLE];

    expect([sweep(range(40)), sweep(range(100))]).toEqual([
      [0, 20, 39],
      [0, 50, 99],
    ]);
  });

  it('returns a list of 3 or fewer unchanged', () => {
    delete process.env[PROPERTY_SWEEP_VARIABLE];

    expect(sweep([11, 23, 37])).toEqual([11, 23, 37]);
  });

  it('throws on any other switch value, naming the variable', () => {
    process.env[PROPERTY_SWEEP_VARIABLE] = 'Full';

    expect(() => sweep(range(25))).toThrow(/KIKO_PROPERTY_SWEEP/);
  });
});
