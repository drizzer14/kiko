// Semgrep fixture (POSITIVE, NESTED): kiko-no-process-env-time-zone-in-test
// carries a path-prefixed `paths.include` entry (`src/test-support/**`), which
// draws NOTHING against a fixture placed directly in rules/fixtures/
// (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a real
// src/test-support/ path instead.
export const withTimeZone = (zone: string, run: () => void): void => {
  const original = process.env.TZ;
  // EXPECT-FINDING
  process.env.TZ = zone;
  run();
  // EXPECT-FINDING
  process.env.TZ = original;
};

export const pinUniversalTime = (): void => {
  // EXPECT-FINDING
  process.env['TZ'] = 'UTC';
};
