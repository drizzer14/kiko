// Semgrep fixture (POSITIVE): kiko-no-math-min-max-spread MUST report a
// finding on every pinned line below. Never "fix" this file — see
// kiko-code-style's "No Math.min/Math.max over a spread array".
type Entry = { time: number };

export const earliest = (times: number[]): number =>
  // EXPECT-FINDING
  Math.min(...times);

export const nextSortOrder = (entries: Entry[]): number =>
  // EXPECT-FINDING
  Math.max(0, ...entries.map((entry) => entry.time));

export const largest = (values: number[]): number =>
  // EXPECT-FINDING
  Math.max.apply(null, values);
