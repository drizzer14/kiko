export const PROPERTY_SWEEP_VARIABLE = 'KIKO_PROPERTY_SWEEP';

export const DEVELOPMENT_SWEEP_COUNT = 3;

const FULL_SWEEP = 'full';

const spreadIndexes = (length: number): number[] =>
  Array.from({ length: DEVELOPMENT_SWEEP_COUNT }, (_unused, position) =>
    Math.round((position * (length - 1)) / (DEVELOPMENT_SWEEP_COUNT - 1)),
  );

export const sweep = <Entry>(entries: readonly Entry[]): readonly Entry[] => {
  const mode = process.env[PROPERTY_SWEEP_VARIABLE];

  if (mode === FULL_SWEEP) {
    return entries;
  }

  if (mode !== undefined) {
    throw new Error(`${PROPERTY_SWEEP_VARIABLE} must be unset or "${FULL_SWEEP}", got "${mode}"`);
  }

  if (entries.length <= DEVELOPMENT_SWEEP_COUNT) {
    return entries;
  }

  return spreadIndexes(entries.length).map((index) => entries[index] as Entry);
};
