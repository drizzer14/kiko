import {
  clearDraftReferences,
  draftReferences,
  EMPTY_DRAFT,
  isTemplateDraft,
  TEMPLATE_MODES,
  type TemplateDraft,
} from './template-draft';

const expenseDraft: TemplateDraft = {
  version: 1,
  mode: 'expense',
  holdingId: 'holding-1',
  currency: 'UAH',
  amountMinorUnits: 12_500,
  description: 'Coffee',
  category: 'food',
  exchange: null,
  returns: [],
};

const exchangeDraft: TemplateDraft = {
  ...expenseDraft,
  mode: 'exchange',
  category: null,
  exchange: {
    destinationHoldingId: 'holding-2',
    destinationCurrency: 'USD',
    valueInMinorUnits: 300,
  },
};

const splitDraft: TemplateDraft = {
  ...expenseDraft,
  mode: 'split',
  returns: [
    { holdingId: 'holding-3', amountMinorUnits: 5_000 },
    { holdingId: null, amountMinorUnits: null },
  ],
};

const validDrafts: Record<(typeof TEMPLATE_MODES)[number], TemplateDraft> = {
  income: { ...expenseDraft, mode: 'income' },
  expense: expenseDraft,
  exchange: exchangeDraft,
  split: splitDraft,
};

const withField = (field: string, value: unknown): unknown => ({
  ...exchangeDraft,
  [field]: value,
});

const withoutField = (field: string): unknown => {
  const copy: Record<string, unknown> = { ...exchangeDraft };

  delete copy[field];

  return copy;
};

describe('TEMPLATE_MODES', () => {
  it('lists the four form modes', () => {
    expect(TEMPLATE_MODES).toEqual(['income', 'expense', 'exchange', 'split']);
  });
});

describe('EMPTY_DRAFT', () => {
  it('is an empty expense with no reference and no amount', () => {
    expect(EMPTY_DRAFT).toEqual({
      version: 1,
      mode: 'expense',
      holdingId: null,
      currency: null,
      amountMinorUnits: null,
      description: '',
      category: null,
      exchange: null,
      returns: [],
    });
  });

  it('passes its own guard', () => {
    expect(isTemplateDraft(EMPTY_DRAFT)).toBe(true);
  });
});

describe('isTemplateDraft', () => {
  it.each(TEMPLATE_MODES)('accepts a valid %s draft', (mode) => {
    expect(isTemplateDraft(validDrafts[mode])).toBe(true);
  });

  it('accepts a draft with every nullable field null', () => {
    expect(
      isTemplateDraft({
        ...exchangeDraft,
        holdingId: null,
        currency: null,
        amountMinorUnits: null,
        category: null,
        exchange: {
          destinationHoldingId: null,
          destinationCurrency: null,
          valueInMinorUnits: null,
        },
      }),
    ).toBe(true);
  });

  it('accepts the largest safe integer amount', () => {
    expect(isTemplateDraft(withField('amountMinorUnits', Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it('ignores an extra key', () => {
    expect(isTemplateDraft({ ...expenseDraft, comment: 'extra' })).toBe(true);
  });

  it.each([null, undefined, [], 'draft', 7, true])('rejects %p', (value) => {
    expect(isTemplateDraft(value)).toBe(false);
  });

  it.each([
    ['version', 2],
    ['version', '1'],
    ['mode', 'transfer'],
    ['mode', null],
    ['holdingId', 5],
    ['currency', 'XYZ'],
    ['currency', 5],
    ['amountMinorUnits', 0],
    ['amountMinorUnits', -1],
    ['amountMinorUnits', 1.5],
    ['amountMinorUnits', Number.MAX_SAFE_INTEGER + 1],
    ['amountMinorUnits', Number.NaN],
    ['amountMinorUnits', '100'],
    ['description', null],
    ['description', 5],
    ['category', 5],
    ['exchange', []],
    ['exchange', 'none'],
    ['returns', null],
    ['returns', {}],
    ['returns', 'none'],
  ])('rejects %s = %p', (field, value) => {
    expect(isTemplateDraft(withField(field, value))).toBe(false);
  });

  it.each([
    'version',
    'mode',
    'holdingId',
    'currency',
    'amountMinorUnits',
    'description',
    'category',
    'exchange',
    'returns',
  ])('rejects a draft missing %s', (field) => {
    expect(isTemplateDraft(withoutField(field))).toBe(false);
  });

  it.each([
    ['destinationHoldingId', 5],
    ['destinationCurrency', 'XYZ'],
    ['valueInMinorUnits', 0],
    ['valueInMinorUnits', -3],
    ['valueInMinorUnits', 2.5],
    ['valueInMinorUnits', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects an exchange with %s = %p', (field, value) => {
    expect(
      isTemplateDraft(withField('exchange', { ...exchangeDraft.exchange, [field]: value })),
    ).toBe(false);
  });

  it.each(['destinationHoldingId', 'destinationCurrency', 'valueInMinorUnits'])(
    'rejects an exchange missing %s',
    (field) => {
      const exchange: Record<string, unknown> = { ...exchangeDraft.exchange };

      delete exchange[field];

      expect(isTemplateDraft(withField('exchange', exchange))).toBe(false);
    },
  );

  it.each([
    ['holdingId', 5],
    ['amountMinorUnits', 0],
    ['amountMinorUnits', -1],
    ['amountMinorUnits', 1.5],
    ['amountMinorUnits', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects a return with %s = %p', (field, value) => {
    expect(
      isTemplateDraft(
        withField('returns', [{ holdingId: 'holding-3', amountMinorUnits: 5_000, [field]: value }]),
      ),
    ).toBe(false);
  });

  it.each(['holdingId', 'amountMinorUnits'])('rejects a return missing %s', (field) => {
    const row: Record<string, unknown> = { holdingId: 'holding-3', amountMinorUnits: 5_000 };

    delete row[field];

    expect(isTemplateDraft(withField('returns', [row]))).toBe(false);
  });

  it.each([null, 'row', [], 7])('rejects a return that is %p', (row) => {
    expect(isTemplateDraft(withField('returns', [row]))).toBe(false);
  });
});

describe('draftReferences', () => {
  it('reads nothing from an empty draft', () => {
    expect(draftReferences(EMPTY_DRAFT)).toEqual({ holdingIds: [], categoryKey: null });
  });

  it('reads the primary, destination and every return holding', () => {
    const draft: TemplateDraft = {
      ...splitDraft,
      exchange: {
        destinationHoldingId: 'holding-2',
        destinationCurrency: 'USD',
        valueInMinorUnits: 300,
      },
    };

    expect(draftReferences(draft).holdingIds).toEqual(['holding-1', 'holding-2', 'holding-3']);
  });

  it('lists a holding once when it fills several slots', () => {
    const draft: TemplateDraft = {
      ...splitDraft,
      returns: [
        { holdingId: 'holding-1', amountMinorUnits: 1 },
        { holdingId: 'holding-3', amountMinorUnits: 2 },
        { holdingId: 'holding-3', amountMinorUnits: 3 },
      ],
    };

    expect(draftReferences(draft).holdingIds).toEqual(['holding-1', 'holding-3']);
  });

  it('skips a null slot', () => {
    expect(draftReferences(splitDraft).holdingIds).toEqual(['holding-1', 'holding-3']);
  });

  it('returns the category lowercased', () => {
    expect(draftReferences({ ...expenseDraft, category: 'Food' }).categoryKey).toBe('food');
  });

  it('keeps a null category null', () => {
    expect(draftReferences({ ...expenseDraft, category: null }).categoryKey).toBeNull();
  });

  it('does not read ids out of the description', () => {
    expect(
      draftReferences({ ...EMPTY_DRAFT, description: 'paid from holding-1' }).holdingIds,
    ).toEqual([]);
  });
});

describe('clearDraftReferences', () => {
  const nothingCleared = { holdingIds: [], categoryKey: null };

  it('clears the primary holding', () => {
    const cleared = clearDraftReferences(expenseDraft, {
      holdingIds: ['holding-1'],
      categoryKey: null,
    });

    expect(cleared).toEqual({ ...expenseDraft, holdingId: null });
  });

  it('clears the destination holding', () => {
    const cleared = clearDraftReferences(exchangeDraft, {
      holdingIds: ['holding-2'],
      categoryKey: null,
    });

    expect(cleared.exchange).toEqual({
      destinationHoldingId: null,
      destinationCurrency: 'USD',
      valueInMinorUnits: 300,
    });
    expect(cleared.holdingId).toBe('holding-1');
  });

  it('clears a return holding and keeps its row', () => {
    const cleared = clearDraftReferences(splitDraft, {
      holdingIds: ['holding-3'],
      categoryKey: null,
    });

    expect(cleared.returns).toEqual([
      { holdingId: null, amountMinorUnits: 5_000 },
      { holdingId: null, amountMinorUnits: null },
    ]);
  });

  it('clears every slot that holds one of several ids', () => {
    const cleared = clearDraftReferences(
      { ...splitDraft, exchange: exchangeDraft.exchange },
      { holdingIds: ['holding-1', 'holding-2', 'holding-3'], categoryKey: null },
    );

    expect(cleared.holdingId).toBeNull();
    expect(cleared.exchange?.destinationHoldingId).toBeNull();
    expect(cleared.returns[0]?.holdingId).toBeNull();
  });

  it('clears the category', () => {
    const cleared = clearDraftReferences(expenseDraft, { holdingIds: [], categoryKey: 'food' });

    expect(cleared).toEqual({ ...expenseDraft, category: null });
  });

  it('leaves another category alone', () => {
    expect(
      clearDraftReferences(expenseDraft, { holdingIds: [], categoryKey: 'rent' }).category,
    ).toBe('food');
  });

  it('leaves an id that only appears inside the description alone', () => {
    const draft: TemplateDraft = { ...expenseDraft, description: 'holding-1 and food' };

    expect(clearDraftReferences(draft, { holdingIds: ['holding-9'], categoryKey: 'rent' })).toEqual(
      draft,
    );
  });

  it('keeps the description when it clears the holding named in it', () => {
    const draft: TemplateDraft = { ...expenseDraft, description: 'holding-1' };

    expect(
      clearDraftReferences(draft, { holdingIds: ['holding-1'], categoryKey: null }).description,
    ).toBe('holding-1');
  });

  it('returns an unrelated draft equal', () => {
    expect(clearDraftReferences(splitDraft, nothingCleared)).toEqual(splitDraft);
    expect(clearDraftReferences(exchangeDraft, nothingCleared)).toEqual(exchangeDraft);
    expect(clearDraftReferences(EMPTY_DRAFT, nothingCleared)).toEqual(EMPTY_DRAFT);
  });

  it('does not change the draft it was given', () => {
    const draft: TemplateDraft = structuredClone(splitDraft);

    clearDraftReferences(draft, { holdingIds: ['holding-1', 'holding-3'], categoryKey: 'food' });

    expect(draft).toEqual(splitDraft);
  });
});
