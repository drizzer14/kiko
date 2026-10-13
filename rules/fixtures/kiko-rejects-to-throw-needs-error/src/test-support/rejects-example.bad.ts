// Semgrep fixture (POSITIVE, NESTED): kiko-rejects-to-throw-needs-error carries a path-prefixed
// `paths.include` entry (`src/test-support/**`), which draws NOTHING against a fixture placed
// directly in rules/fixtures/ (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a
// real src/test-support/ path instead. The rule MUST report a finding on each pinned line: a
// rejection asserted with `toThrow` or `toThrowError` and no argument, or with the bare `Error`
// class or `undefined`, with an empty message or a match-all pattern, or read through
// `toBeInstanceOf(Error)`, `toBeInstanceOf(Object)`, `toEqual(expect.anything())`, `toBeTruthy()`,
// `not.toBeNull()` or `toBeDefined()`: each passes on any failure.

// A module, so this file's `run` does not collide with the sibling fixture's under `tsc`.
export {};

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

  it('passes on any failure when the bare Error class is named', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrow(Error);
  });

  it('passes on any failure when the bare Error class is named through toThrowError', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrowError(Error);
  });

  it('passes on any failure when undefined is named', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrow(undefined);
  });

  it('passes on any failure when undefined is named through toThrowError', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrowError(undefined);
  });

  it('passes on any failure when the instance is only an Error', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toBeInstanceOf(Error);
  });

  it('passes on any failure when the rejection is only truthy', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toBeTruthy();
  });

  it('passes on any failure when the message is the empty string', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrow('');
  });

  it('passes on any failure when the pattern matches everything', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toThrow(/.*/);
  });

  it('passes on any failure when anything is expected', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toEqual(expect.anything());
  });

  it('passes on any failure when the instance is only an Object', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toBeInstanceOf(Object);
  });

  it('passes on any failure when the rejection is only not null', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.not.toBeNull();
  });

  it('passes on any failure when the rejection is only defined', async () => {
    // EXPECT-FINDING
    await expect(run()).rejects.toBeDefined();
  });
});
