// Semgrep fixture (POSITIVE, NESTED): kiko-test-title-no-history carries a path-prefixed
// `paths.include` entry (`src/test-support/**`), which draws NOTHING against a fixture placed
// directly in rules/fixtures/ (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a
// real src/test-support/ path instead. The rule MUST report a finding on each pinned line: a test
// or suite title that opens with a task id (`A1 `, `Q7 `, `X1:`) or a ruling id (`ruling A2`), or
// that carries a `(was: ` label or ends in a parenthesized id (`(P2)`, `(task C2)`), however the
// title is declared.

// EXPECT-FINDING
describe('A1 the footer', () => {
  // EXPECT-FINDING
  it('B12 keeps the row flat', () => {});

  // EXPECT-FINDING
  test('Q7 renders the empty state', () => {});

  // EXPECT-FINDING
  it("C3 doesn't skip a double-quoted title", () => {});

  // EXPECT-FINDING
  it(`D4 keeps a template title in scope`, () => {});

  // EXPECT-FINDING
  it('ruling A2 keeps the footer pinned', () => {});

  // EXPECT-FINDING
  it('Ruling B1: a row opens its screen', () => {});

  // EXPECT-FINDING
  it('keeps the cap (was: 30)', () => {});

  // EXPECT-FINDING
  test('rows stay flat (was: grouped)', () => {});

  // EXPECT-FINDING
  it.only('E5 runs a focused test', () => {});

  // EXPECT-FINDING
  it.skip('F6 runs a skipped test', () => {});

  // EXPECT-FINDING
  it.todo('G7 later');

  // EXPECT-FINDING
  it.each([1, 2])('H8 runs a table row for %s', () => {});

  // EXPECT-FINDING
  test.each([1, 2])('J9 runs a test table row for %s', () => {});

  // EXPECT-FINDING
  it.each([1, 2])('keeps the count (was: 1) for %s', () => {});

  // EXPECT-FINDING
  it.only.each([1, 2])('K10 runs a focused table row for %s', () => {});

  // EXPECT-FINDING
  it('L11 keeps a timeout call in scope', () => {}, 10000);
});

// EXPECT-FINDING
describe.each([1, 2])('M12 suite for %s', () => {});

// EXPECT-FINDING
describe.skip('N13 skipped suite', () => {});

// EXPECT-FINDING
describe('a suite (was: grouped by day)', () => {});

// EXPECT-FINDING
describe('X1: the colon form of a task id', () => {});

// EXPECT-FINDING
describe('single-flight join over the whole arm (P2)', () => {});

// EXPECT-FINDING
describe(`a template title with a trailing id (T27)`, () => {});

// EXPECT-FINDING
describe('keeps the row flat (task C2)', () => {});

// EXPECT-FINDING
describe('keeps the cap (spec A3, B4)', () => {});

// EXPECT-FINDING
describe.each([1, 2])('runs a table row for %s (P2)', () => {});

// EXPECT-FINDING
describe.each`
  first | second
  ${1}  | ${2}
`('Z9 runs a tagged table', () => {});
