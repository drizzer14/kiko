import { walkStateFake } from './walk-marks';

const storedOf = async (fake: ReturnType<typeof walkStateFake>) =>
  JSON.parse((await fake.deps.readExchangeState('acc-1')) ?? 'null');

describe('walkStateFake and the log walk', () => {
  it('seeds the marks of a log walk and of the convert read', async () => {
    const fake = walkStateFake({
      marks: { log: { cursor: 5 }, convert: { cursor: 6, pageIndex: 2, passOwed: [] } },
    });

    expect(fake.marksOf('log')).toEqual({ cursor: 5 });
    expect(fake.marksOf('convert')).toEqual({ cursor: 6, pageIndex: 2, passOwed: [] });
  });

  it('applies the log kinds and the dense spans a walk writes, so a later read sees them', async () => {
    const fake = walkStateFake();

    await fake.deps.patchExchangeState('acc-1', [
      { kind: 'logKinds', kinds: ['transfer'] },
      { kind: 'denseSpans', series: 'log', start: 7 },
    ]);

    expect(await storedOf(fake)).toEqual({
      version: 1,
      walks: {},
      logKinds: ['transfer'],
      denseSpans: { log: 7 },
    });
  });

  it('applies the Funding held count and the left-out flag, and seeds the ledger walk', async () => {
    const fake = walkStateFake({ marks: { fundingLedger: { cursor: 8 } } });

    await fake.deps.patchExchangeState('acc-1', [
      { kind: 'fundingHeld', count: 2 },
      { kind: 'fundingLeftOut' },
    ]);

    expect(fake.marksOf('fundingLedger')).toEqual({ cursor: 8 });
    expect(await storedOf(fake)).toEqual({
      version: 1,
      walks: { fundingLedger: { cursor: 8 } },
      fundingHeld: 2,
      fundingLeftOut: true,
    });
  });

  it('still throws on a patch it does not own, so a mistyped mark shows', async () => {
    const fake = walkStateFake();

    await expect(
      fake.deps.patchExchangeState('acc-1', [{ kind: 'balanceSyncedAt', value: 1 }]),
    ).rejects.toThrow('walkStateFake: no walk mark is stored under "balanceSyncedAt"');
  });
});
