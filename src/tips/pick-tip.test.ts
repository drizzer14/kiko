import { pickTip } from './pick-tip';

describe('pickTip', () => {
  it('returns the first candidate whose condition holds and which is not dismissed', () => {
    const picked = pickTip(
      [
        { id: 'settings.categories', condition: false },
        { id: 'transaction.applyToAll', condition: true },
        { id: 'accountDetail.importStatement', condition: true },
      ],
      new Set(),
    );

    expect(picked).toBe('transaction.applyToAll');
  });

  it('skips a dismissed candidate', () => {
    const picked = pickTip(
      [
        { id: 'settings.categories', condition: true },
        { id: 'transaction.applyToAll', condition: true },
      ],
      new Set(['settings.categories' as const]),
    );

    expect(picked).toBe('transaction.applyToAll');
  });

  it('returns null when every candidate is false or dismissed', () => {
    const picked = pickTip(
      [
        { id: 'settings.categories', condition: true },
        { id: 'transaction.applyToAll', condition: false },
      ],
      new Set(['settings.categories' as const]),
    );

    expect(picked).toBeNull();
  });

  it('returns null for no candidates', () => {
    expect(pickTip([], new Set())).toBeNull();
  });

  it('never returns more than one id', () => {
    const picked = pickTip(
      [
        { id: 'settings.categories', condition: true },
        { id: 'transaction.applyToAll', condition: true },
      ],
      new Set(),
    );

    expect(typeof picked).toBe('string');
  });
});
