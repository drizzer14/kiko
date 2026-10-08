// Semgrep fixture (POSITIVE): a non-repo module reads a stored holding row's
// `balanceMinorUnits` column directly for a value, instead of going through
// `holdingsRepo.balanceOf` (kiko-domain "Money at the boundary").
// `kiko-balance-through-repo` MUST report a finding on the pinned line below.
// Never "fix" this file.
type FixtureHoldingRow = { currency: string; balanceMinorUnits: number };

export const fixtureBalanceMajorUnits = (holding: FixtureHoldingRow): number =>
  // EXPECT-FINDING
  holding.balanceMinorUnits / 100;
