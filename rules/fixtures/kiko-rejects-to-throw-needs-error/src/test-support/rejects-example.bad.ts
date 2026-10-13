// Semgrep fixture (POSITIVE, NESTED): kiko-rejects-to-throw-needs-error carries a path-prefixed
// `paths.include` entry (`src/test-support/**`), which draws NOTHING against a fixture placed
// directly in rules/fixtures/ (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a
// real src/test-support/ path instead. The rule MUST report a finding on each pinned line: a
// rejection asserted with `toThrow` or `toThrowError` and no argument, which passes on any failure.
declare const run: () => Promise<void>;

describe('a rejection with no expected error', () => {
  it('passes on any failure', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrow();
  });

  it('passes on any failure through toThrowError', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrowError();
  });

  it('passes on any failure when the call wraps', async () => {
    const save = async (_input: { accountId: string; amount: string; note: string }) => {};

    // EXPECT-FINDING
    await expect(
      save({ accountId: 'account-1', amount: '12.00', note: 'a call long enough to wrap' }),
    ).rejects.toThrow();
  });

  it('passes on any failure of a member call', async () => {
    const service = { open: run };

    // EXPECT-FINDING
    await expect(service.open()).rejects.toThrow();
  });
});
