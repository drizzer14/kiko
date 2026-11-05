import { smallestSpelling } from '@kiko/transactions/merchant-name';

export type NameTally = { rowCount: number; spelling: string };

// Compared by code unit, never by locale, so the order cannot depend on the device.
export const compareByCodeUnit = (first: string, second: string): number => {
  if (first === second) {
    return 0;
  }

  return first < second ? -1 : 1;
};

// One row of a name, spelled in full: the review list and the confirm sheet of a rule list the
// same names in the same order, so both tally them here.
export const addToNameTally = (
  tallies: Map<string, NameTally>,
  normalizedName: string,
  spelling: string,
): void => {
  const tally = tallies.get(normalizedName);

  tallies.set(normalizedName, {
    rowCount: (tally?.rowCount ?? 0) + 1,
    spelling: smallestSpelling([tally?.spelling ?? spelling, spelling]),
  });
};

// The name with the most rows first, then by normalized text.
export const rankedNames = (tallies: ReadonlyMap<string, NameTally>): string[] =>
  [...tallies.entries()]
    .sort(
      ([firstName, first], [secondName, second]) =>
        second.rowCount - first.rowCount || compareByCodeUnit(firstName, secondName),
    )
    .map(([, tally]) => tally.spelling);
