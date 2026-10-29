/** A function that returns the next number in [0, 1) of a seeded sequence. */
export type Random = () => number;

/** A seeded generator (Lehmer), so a failing property run replays from its seed. */
export const seededRandom = (seed: number): Random => {
  let state = seed;

  return () => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };
};
