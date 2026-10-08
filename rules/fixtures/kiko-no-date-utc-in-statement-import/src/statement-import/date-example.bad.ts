// Semgrep fixture (POSITIVE): a hand-rolled `Date.UTC(...)` call in
// statement-import bypasses the zone rule every wall clock is read through.
// `kiko-no-date-utc-in-statement-import` MUST report a finding on the pinned
// line below. Never "fix" this file.
export const fixtureBadWallClockMilliseconds = (): number =>
  // EXPECT-FINDING
  Date.UTC(2026, 8, 15, 22, 30, 0);
