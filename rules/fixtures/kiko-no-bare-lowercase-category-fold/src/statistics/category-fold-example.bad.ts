// Semgrep fixture (POSITIVE, NESTED): kiko-no-bare-lowercase-category-fold
// carries a path-prefixed `paths.include: ["src/statistics/**"]`, which draws
// NOTHING against a fixture placed directly in rules/fixtures/ (kiko-linter's
// "Semgrep facts" gotcha) — so this fixture is nested to mirror a real
// src/statistics/ path instead. Never move it back to a flat
// rules/fixtures/kiko-no-bare-lowercase-category-fold.bad.ts location.
export const groupKeyOptional = (category: string | null, defaultKey: string): string => {
  // EXPECT-FINDING
  return category?.toLowerCase() || defaultKey;
};

export const groupKeyPlain = (category: string, defaultKey: string): string => {
  // EXPECT-FINDING
  return category.toLowerCase() || defaultKey;
};
