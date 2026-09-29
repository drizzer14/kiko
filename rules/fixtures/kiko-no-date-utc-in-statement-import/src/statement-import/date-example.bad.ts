// Semgrep fixture (POSITIVE): a hand-rolled `Date.UTC(...)` call in
// statement-import bypasses both zone readings this project settled on.
// `kiko-no-date-utc-in-statement-import` MUST report a finding on the pinned
// line below. Never "fix" this file.
export const fixtureBadWallClockMilliseconds = (): number =>
  // EXPECT-FINDING
  Date.UTC(2026, 8, 15, 22, 30, 0);
