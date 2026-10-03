import { holdingFormDraft, holdingFormTarget } from './holding-form-target';

describe('holdingFormTarget', () => {
  it('targets the named account when the route carries an accountId', () => {
    expect(holdingFormTarget({ accountId: 'account-1' })).toEqual({
      kind: 'account',
      accountId: 'account-1',
    });
  });

  it('targets the implicit account of the kind when the route carries an implicitKind', () => {
    expect(holdingFormTarget({ implicitKind: 'debt' })).toEqual({
      kind: 'implicit',
      implicitKind: 'debt',
    });
  });

  it('keeps the kind of a property create, and ignores the draft', () => {
    expect(
      holdingFormTarget({
        implicitKind: 'property',
        draft: { name: 'Flat', icon: null, color: null },
      }),
    ).toEqual({ kind: 'implicit', implicitKind: 'property' });
  });

  it('keeps the edit holdingId off the target', () => {
    expect(holdingFormTarget({ accountId: 'account-1', holdingId: 'holding-1' })).toEqual({
      kind: 'account',
      accountId: 'account-1',
    });
  });
});

describe('holdingFormDraft', () => {
  const draft = { name: 'Flat', icon: 'giftcard', color: '#ffffff' };

  it('reads the draft an implicit route carries', () => {
    expect(holdingFormDraft({ implicitKind: 'property', draft })).toBe(draft);
  });

  it('is empty for an implicit route that carries no draft', () => {
    expect(holdingFormDraft({ implicitKind: 'property' })).toEqual({
      name: '',
      icon: null,
      color: null,
    });
  });

  it('is empty for an account route', () => {
    expect(holdingFormDraft({ accountId: 'account-1' })).toEqual({
      name: '',
      icon: null,
      color: null,
    });
  });
});
