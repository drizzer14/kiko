// Semgrep fixture (NEGATIVE, NESTED): every rejection below names the error it expects, by
// message, pattern or class, so `kiko-rejects-to-throw-needs-error` must draw ZERO findings from
// this file.
declare const run: () => Promise<void>;

class SaleExceedsHoldingError extends Error {}

describe('a rejection with an expected error', () => {
  it('names the message', async () => {
    await expect(run()).rejects.toThrow('a sale would take more than is held');
  });

  it('names a pattern', async () => {
    await expect(run()).rejects.toThrow(/more than is held/);
  });

  it('names the class', async () => {
    await expect(run()).rejects.toThrow(SaleExceedsHoldingError);
  });

  it('names the class through toThrowError', async () => {
    await expect(run()).rejects.toThrowError(SaleExceedsHoldingError);
  });

  it('reads the instance', async () => {
    await expect(run()).rejects.toBeInstanceOf(SaleExceedsHoldingError);
  });

  // A synchronous throw has no promise to reject; the rule is about a rejection only.
  it('keeps a synchronous toThrow out of scope', () => {
    expect(() => {
      throw new Error('x');
    }).toThrow();
  });

  it('keeps a resolved promise out of scope', async () => {
    await expect(run()).resolves.toBeUndefined();
  });
});
