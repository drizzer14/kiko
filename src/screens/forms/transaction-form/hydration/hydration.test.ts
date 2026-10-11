import type { HoldingRow, TransactionRow } from '@kiko/db';
import { EMPTY_DRAFT, TEMPLATE_MODES, type TemplateDraft } from '@kiko/transaction-templates/draft';

import {
  type SeedFieldsPlan,
  applySeedFields,
  resolveHydration,
  toTemplateMode,
} from './hydration';

type Args = Parameters<typeof resolveHydration>[0];

const holdingOf = (id: string): HoldingRow => ({ id, currency: 'UAH' }) as HoldingRow;

const rowOf = (overrides: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: 't1',
    holdingId: 'h1',
    amountMinorUnits: -105000,
    time: 1_700_000_000_000,
    description: 'Rent',
    category: 'Housing',
    ...overrides,
  }) as TransactionRow;

const argsOf = (overrides: Partial<Args> = {}): Args => ({
  existing: undefined,
  duplicateSource: undefined,
  holding: undefined,
  primaryHoldingId: null,
  currency: 'UAH',
  defaultPrimaryHoldingId: null,
  blankLabel: null,
  templateDraft: null,
  templateName: null,
  templateSeat: 'clear',
  ...overrides,
});

const draftOf = (overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...EMPTY_DRAFT,
  ...overrides,
});

const EMPTY_RETURNS = [{ holdingId: null, amount: '' }];

describe('resolveHydration — Edit and Duplicate (today)', () => {
  it('seeds an Edit once its holding has loaded, carrying the stored time', () => {
    expect(resolveHydration(argsOf({ existing: rowOf(), holding: holdingOf('h1') }))).toEqual({
      kind: 'seedFields',
      amount: '1 050',
      mode: 'expense',
      description: 'Rent',
      prefilledLabel: null,
      category: 'housing',
      time: 1_700_000_000_000,
      destinationHoldingId: null,
      valueIn: '',
      returns: EMPTY_RETURNS,
    });
  });

  it('seeds an Edit of an income row with the income mode and a blank label in place of a blank description', () => {
    expect(
      resolveHydration(
        argsOf({
          existing: rowOf({ amountMinorUnits: 2500, description: '', category: null }),
          holding: holdingOf('h1'),
          blankLabel: 'Monobank',
        }),
      ),
    ).toEqual({
      kind: 'seedFields',
      amount: '25',
      mode: 'income',
      description: 'Monobank',
      prefilledLabel: 'Monobank',
      category: null,
      time: 1_700_000_000_000,
      destinationHoldingId: null,
      valueIn: '',
      returns: EMPTY_RETURNS,
    });
  });

  it('waits for the holding of an Edit', () => {
    expect(resolveHydration(argsOf({ existing: rowOf() }))).toEqual({ kind: 'wait' });
  });

  it('seats the seam from a Duplicate source first, without closing the latch', () => {
    expect(resolveHydration(argsOf({ duplicateSource: rowOf() }))).toEqual({
      kind: 'seedHolding',
      holdingId: 'h1',
      final: false,
    });
  });

  it('seeds a Duplicate dated to now once its holding has loaded', () => {
    expect(
      resolveHydration(
        argsOf({
          duplicateSource: rowOf(),
          primaryHoldingId: 'h1',
          holding: holdingOf('h1'),
        }),
      ),
    ).toEqual({
      kind: 'seedFields',
      amount: '1 050',
      mode: 'expense',
      description: 'Rent',
      prefilledLabel: null,
      category: 'housing',
      time: null,
      destinationHoldingId: null,
      valueIn: '',
      returns: EMPTY_RETURNS,
    });
  });

  it('seats the empty-create default as a final step, and otherwise waits', () => {
    expect(resolveHydration(argsOf({ defaultPrimaryHoldingId: 'h9' }))).toEqual({
      kind: 'seedHolding',
      holdingId: 'h9',
      final: true,
    });
    expect(resolveHydration(argsOf())).toEqual({ kind: 'wait' });
  });
});

describe('resolveHydration — a template', () => {
  const stored = draftOf({
    mode: 'expense',
    holdingId: 'h1',
    currency: 'UAH',
    amountMinorUnits: 105000,
    description: 'Rent',
    category: 'housing',
  });

  it('seats a resolved holding first when it differs from the seam', () => {
    expect(resolveHydration(argsOf({ templateDraft: stored, primaryHoldingId: null }))).toEqual({
      kind: 'seedHolding',
      holdingId: 'h1',
      final: false,
    });
    expect(
      resolveHydration(
        argsOf({ templateDraft: stored, primaryHoldingId: 'other', holding: holdingOf('other') }),
      ),
    ).toEqual({ kind: 'seedHolding', holdingId: 'h1', final: false });
  });

  it('seeds a re-pick to a different holding from that holding, never from the old one', () => {
    const first = argsOf({
      templateDraft: stored,
      primaryHoldingId: 'old',
      holding: holdingOf('old'),
    });
    const second = argsOf({
      templateDraft: stored,
      primaryHoldingId: 'h1',
      holding: holdingOf('h1'),
    });

    expect(resolveHydration(first)).toMatchObject({ kind: 'seedHolding', holdingId: 'h1' });
    expect(resolveHydration(second)).toMatchObject({ kind: 'seedFields' });
  });

  it('waits for the holding to load once the seam is seated', () => {
    expect(resolveHydration(argsOf({ templateDraft: stored, primaryHoldingId: 'h1' }))).toEqual({
      kind: 'wait',
    });
  });

  it('seeds every field of a resolved holding dated to now and leaves the seam alone', () => {
    expect(
      resolveHydration(
        argsOf({
          templateDraft: stored,
          templateName: 'Rent',
          primaryHoldingId: 'h1',
          holding: holdingOf('h1'),
        }),
      ),
    ).toEqual({
      kind: 'seedFields',
      amount: '1 050',
      mode: 'expense',
      description: 'Rent',
      prefilledLabel: null,
      category: 'housing',
      time: null,
      destinationHoldingId: null,
      valueIn: '',
      returns: EMPTY_RETURNS,
      templateName: 'Rent',
      clearsHolding: false,
    });
  });

  it.each([
    ['clear', true],
    ['keepPage', false],
  ] as const)(
    'seeds a null holding at once, and with the seat %s clearsHolding is %s',
    (templateSeat, clearsHolding) => {
      const plan = resolveHydration(
        argsOf({
          templateDraft: draftOf({ description: 'Coffee' }),
          templateSeat,
          primaryHoldingId: 'page',
        }),
      );

      expect(plan).toMatchObject({ kind: 'seedFields', description: 'Coffee', clearsHolding });
    },
  );

  it('runs before the default-holding step', () => {
    expect(
      resolveHydration(argsOf({ templateDraft: draftOf(), defaultPrimaryHoldingId: 'default' })),
    ).toMatchObject({ kind: 'seedFields', clearsHolding: true });
  });

  it('seeds a category as its lowercase key, and no category as null', () => {
    const seedOf = (category: string | null) =>
      resolveHydration(argsOf({ templateDraft: draftOf({ category }) }));

    expect(seedOf('Dining')).toMatchObject({ category: 'dining' });
    expect(seedOf(null)).toMatchObject({ category: null });
  });

  describe('amount text', () => {
    const amountOf = (draft: Partial<TemplateDraft>) =>
      resolveHydration(argsOf({ templateDraft: draftOf(draft) }));

    it('formats UAH 105000 as "1 050"', () => {
      expect(amountOf({ currency: 'UAH', amountMinorUnits: 105000 })).toMatchObject({
        amount: '1 050',
      });
    });

    it('formats JPY 1050 as "1 050" (scale 0)', () => {
      expect(amountOf({ currency: 'JPY', amountMinorUnits: 1050 })).toMatchObject({
        amount: '1 050',
      });
    });

    it('formats BTC 12345678 as "0.12345678" (scale 8)', () => {
      expect(amountOf({ currency: 'BTC', amountMinorUnits: 12345678 })).toMatchObject({
        amount: '0.12345678',
      });
    });

    it('uses the stored currency when the holding is gone, never a fallback', () => {
      expect(
        resolveHydration(
          argsOf({
            templateDraft: draftOf({ currency: 'JPY', amountMinorUnits: 1050 }),
            currency: 'UAH',
          }),
        ),
      ).toMatchObject({ amount: '1 050' });
    });

    it('leaves the amount empty for a null amount or a null currency', () => {
      expect(amountOf({ currency: 'UAH', amountMinorUnits: null })).toMatchObject({ amount: '' });
      expect(amountOf({ currency: null, amountMinorUnits: 105000 })).toMatchObject({
        amount: '',
      });
    });
  });

  describe('exchange and split fields', () => {
    it('seeds the destination and the Value in text from the destination currency', () => {
      const plan = resolveHydration(
        argsOf({
          templateDraft: draftOf({
            mode: 'exchange',
            currency: 'UAH',
            amountMinorUnits: 410000,
            exchange: {
              destinationHoldingId: 'usd',
              destinationCurrency: 'JPY',
              valueInMinorUnits: 12500,
            },
          }),
        }),
      );

      expect(plan).toMatchObject({
        mode: 'exchange',
        amount: '4 100',
        destinationHoldingId: 'usd',
        valueIn: '12 500',
      });
    });

    it('leaves Value in empty without a destination currency or a value', () => {
      const valueInOf = (exchange: TemplateDraft['exchange']) =>
        resolveHydration(argsOf({ templateDraft: draftOf({ mode: 'exchange', exchange }) }));

      expect(valueInOf(null)).toMatchObject({ destinationHoldingId: null, valueIn: '' });
      expect(
        valueInOf({
          destinationHoldingId: null,
          destinationCurrency: null,
          valueInMinorUnits: 250,
        }),
      ).toMatchObject({ valueIn: '' });
      expect(
        valueInOf({
          destinationHoldingId: null,
          destinationCurrency: 'USD',
          valueInMinorUnits: null,
        }),
      ).toMatchObject({ valueIn: '' });
    });

    it('seeds the returns in the payer currency, and keeps one empty row when there are none', () => {
      const returnsOf = (returns: TemplateDraft['returns']) =>
        resolveHydration(
          argsOf({ templateDraft: draftOf({ mode: 'split', currency: 'UAH', returns }) }),
        );

      expect(
        returnsOf([
          { holdingId: 'a', amountMinorUnits: 105000 },
          { holdingId: null, amountMinorUnits: null },
        ]),
      ).toMatchObject({
        mode: 'split',
        returns: [
          { holdingId: 'a', amount: '1 050' },
          { holdingId: null, amount: '' },
        ],
      });
      expect(returnsOf([])).toMatchObject({ returns: EMPTY_RETURNS });
    });
  });
});

describe('applySeedFields', () => {
  const setters = () => ({
    setAmount: jest.fn(),
    setMode: jest.fn(),
    setDescription: jest.fn(),
    setPrefilledLabel: jest.fn(),
    setSelectedCategory: jest.fn(),
    setUserPickedCategory: jest.fn(),
    setTime: jest.fn(),
    setDestinationHoldingId: jest.fn(),
    setValueIn: jest.fn(),
    setChangeReturns: jest.fn(),
    setPrimaryHoldingId: jest.fn(),
  });
  const planOf = (overrides: Partial<SeedFieldsPlan> = {}): SeedFieldsPlan => ({
    kind: 'seedFields',
    amount: '1 050',
    mode: 'exchange',
    description: 'Rent',
    prefilledLabel: 'Label',
    category: 'housing',
    time: 42,
    destinationHoldingId: 'usd',
    valueIn: '25',
    returns: [
      { holdingId: 'a', amount: '1' },
      { holdingId: null, amount: '' },
    ],
    ...overrides,
  });

  it('hands every field to its own setter, giving each return row a fresh id', () => {
    const given = setters();
    let nextId = 7;

    applySeedFields(planOf(), given, () => nextId++);

    expect(given.setAmount).toHaveBeenCalledWith('1 050');
    expect(given.setMode).toHaveBeenCalledWith('exchange');
    expect(given.setDescription).toHaveBeenCalledWith('Rent');
    expect(given.setPrefilledLabel).toHaveBeenCalledWith('Label');
    expect(given.setSelectedCategory).toHaveBeenCalledWith('housing');
    expect(given.setDestinationHoldingId).toHaveBeenCalledWith('usd');
    expect(given.setValueIn).toHaveBeenCalledWith('25');
    expect(given.setChangeReturns).toHaveBeenCalledWith([
      { id: 7, holdingId: 'a', amount: '1' },
      { id: 8, holdingId: null, amount: '' },
    ]);
  });

  it('counts a seeded category as a hand pick, and no category as none', () => {
    const picked = setters();
    const none = setters();

    applySeedFields(planOf(), picked, () => 1);
    applySeedFields(planOf({ category: null }), none, () => 1);

    expect(picked.setUserPickedCategory).toHaveBeenCalledWith(true);
    expect(none.setUserPickedCategory).not.toHaveBeenCalled();
  });

  it('keeps the date at now for a null time, and carries a stored one', () => {
    const stored = setters();
    const now = setters();

    applySeedFields(planOf({ time: 42 }), stored, () => 1);
    applySeedFields(planOf({ time: null }), now, () => 1);

    expect(stored.setTime).toHaveBeenCalledWith(42);
    expect(now.setTime).not.toHaveBeenCalled();
  });

  it('empties the seam only when the plan clears the holding', () => {
    const clears = setters();
    const keeps = setters();
    const unset = setters();

    applySeedFields(planOf({ clearsHolding: true }), clears, () => 1);
    applySeedFields(planOf({ clearsHolding: false }), keeps, () => 1);
    applySeedFields(planOf(), unset, () => 1);

    expect(clears.setPrimaryHoldingId).toHaveBeenCalledWith(null);
    expect(keeps.setPrimaryHoldingId).not.toHaveBeenCalled();
    expect(unset.setPrimaryHoldingId).not.toHaveBeenCalled();
  });
});

describe('the template modes and the form modes', () => {
  it('map to each other without loss', () => {
    expect(TEMPLATE_MODES.map(toTemplateMode)).toEqual([...TEMPLATE_MODES]);
  });
});
