// Semgrep fixture (POSITIVE): a non-repo module reads a stored holding row's
// `balanceMinorUnits` column directly for a value, instead of going through
// `holdingsRepo.balanceOf` (kiko-domain "Any table column holding an amount is an integer
// minor-units column"). `kiko-balance-through-repo` MUST flag the pinned line below.
// Never "fix" this file.
type FixtureHoldingRow = { currency: string; balanceMinorUnits: number };

export const fixtureBalanceMajorUnits = (holding: FixtureHoldingRow): number =>
  // EXPECT-FINDING
  holding.balanceMinorUnits / 100;
