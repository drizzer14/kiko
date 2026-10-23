// Semgrep fixture (NEGATIVE, NESTED): a test-support module reads the stored `balanceMinorUnits`
// column directly. The rule excludes `src/test-support/**`, so `kiko-balance-through-repo` MUST
// report nothing here. The positive case stays the flat `kiko-balance-through-repo.bad.ts`: an
// exclude glob matches at any depth, so a positive fixture under this path would prove nothing.
type FixtureHoldingRow = { currency: string; balanceMinorUnits: number };

export const fixtureStoredBalance = (holding: FixtureHoldingRow): number =>
  holding.balanceMinorUnits;

export {};
