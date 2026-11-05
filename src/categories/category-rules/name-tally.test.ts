import { addToNameTally, compareByCodeUnit, type NameTally, rankedNames } from './name-tally';

const tallyOf = (rows: [string, string][]): Map<string, NameTally> => {
  const tallies = new Map<string, NameTally>();

  for (const [normalizedName, spelling] of rows) {
    addToNameTally(tallies, normalizedName, spelling);
  }

  return tallies;
};

describe('compareByCodeUnit', () => {
  it('orders by code unit, uppercase before lowercase', () => {
    expect(compareByCodeUnit('B', 'a')).toBe(-1);
    expect(compareByCodeUnit('a', 'B')).toBe(1);
    expect(compareByCodeUnit('a', 'a')).toBe(0);
  });
});

describe('addToNameTally', () => {
  it('counts every row of a name and keeps its smallest spelling', () => {
    const tallies = tallyOf([
      ['silpo', 'SILPO'],
      ['silpo', 'Silpo'],
      ['silpo', 'silpo'],
    ]);

    expect(tallies.get('silpo')).toEqual({ rowCount: 3, spelling: 'SILPO' });
  });
});

describe('rankedNames', () => {
  it('lists the name with the most rows first, then by normalized text', () => {
    const tallies = tallyOf([
      ['zara', 'Zara'],
      ['atb', 'ATB'],
      ['silpo', 'Silpo'],
      ['silpo', 'Silpo'],
      ['bolt', 'Bolt'],
    ]);

    expect(rankedNames(tallies)).toEqual(['Silpo', 'ATB', 'Bolt', 'Zara']);
  });
});
