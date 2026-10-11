import { i18n } from '@kiko/i18n/init';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';

import {
  type SaveDisabledParams,
  canSaveSplit,
  isSplitAmountInvalid,
  resolveFieldErrors,
  resolveFieldOrder,
} from './validation';

describe('canSaveSplit', () => {
  it('enforces a positive payment, ≥1 distinct return (payer allowed), and Σ returns < payment', () => {
    // A valid split: two distinct non-payer returns summing below the payment.
    expect(
      canSaveSplit(
        '212.00',
        [
          { holdingId: 'a', amount: '0.20' },
          { holdingId: 'b', amount: '0.08' },
        ],
        'UAH',
      ),
    ).toBe(true);

    // No returns at all.
    expect(canSaveSplit('10', [], 'UAH')).toBe(false);
    // A non-positive (or unparseable) payment.
    expect(canSaveSplit('0', [{ holdingId: 'a', amount: '1' }], 'UAH')).toBe(false);
    expect(canSaveSplit('', [{ holdingId: 'a', amount: '1' }], 'UAH')).toBe(false);
    // A return with no holding picked.
    expect(canSaveSplit('10', [{ holdingId: null, amount: '1' }], 'UAH')).toBe(false);
    // A return that targets the payer itself is allowed: the net is
    // still an expense (return < payment) and the balance nets on the payer with
    // no double-count, so a payer return is a valid split.
    expect(canSaveSplit('10', [{ holdingId: 'payer', amount: '1' }], 'UAH')).toBe(true);
    // Two returns on the SAME holding (the repo has no runtime guard — this is
    // the enforcement point).
    expect(
      canSaveSplit(
        '10',
        [
          { holdingId: 'a', amount: '1' },
          { holdingId: 'a', amount: '1' },
        ],
        'UAH',
      ),
    ).toBe(false);
    // A non-positive return amount.
    expect(canSaveSplit('10', [{ holdingId: 'a', amount: '0' }], 'UAH')).toBe(false);
    // Σ returns equals the payment (net zero is not an expense).
    expect(
      canSaveSplit(
        '2',
        [
          { holdingId: 'a', amount: '1' },
          { holdingId: 'b', amount: '1' },
        ],
        'UAH',
      ),
    ).toBe(false);
    // Validated in INTEGER minor units, not float-major: 0.10 + 0.20 = 30 minor
    // units, strictly below 0.31 = 31 minor units, so the sub-unit boundary holds
    // exactly rather than through fragile float arithmetic.
    expect(
      canSaveSplit(
        '0.31',
        [
          { holdingId: 'a', amount: '0.10' },
          { holdingId: 'b', amount: '0.20' },
        ],
        'UAH',
      ),
    ).toBe(true);
  });
});

const t = i18n.t.bind(i18n);

const BASE: SaveDisabledParams = {
  isSplit: false,
  isReadOnly: false,
  isEditing: false,
  amount: '',
  valueIn: '',
  counterpartAmount: '',
  destinationHoldingId: null,
  counterpartHoldingId: null,
  selectedCategory: null,
  changeReturns: [{ holdingId: null, amount: '' }],
  currency: 'UAH',
  primaryHoldingId: 'h1',
  templateName: '',
  templateNameRequired: false,
  isTemplateMode: false,
  templateNames: [],
  editTemplateId: null,
};

const TEMPLATE: SaveDisabledParams = {
  ...BASE,
  templateName: 'Rent',
  templateNameRequired: true,
  isTemplateMode: true,
};

// The field keys a Save press would block on, in the order the form scrolls to them.
const blockingFields = (mode: FormMode | 'converting', params: SaveDisabledParams) => {
  const errors = resolveFieldErrors(mode, params, t);

  return resolveFieldOrder(mode, params).filter((key) => errors[key] !== undefined);
};

describe('template modes', () => {
  it('block only on the name and the holding, for every mode', () => {
    for (const mode of ['income', 'expense', 'exchange', 'split'] as const) {
      expect(blockingFields(mode, TEMPLATE)).toEqual([]);
      expect(blockingFields(mode, { ...TEMPLATE, templateName: '  ' })).toEqual(['templateName']);
      expect(blockingFields(mode, { ...TEMPLATE, primaryHoldingId: null })).toEqual(['holding']);
    }
  });

  it('puts the name before the holding', () => {
    expect(
      blockingFields('expense', { ...TEMPLATE, templateName: '', primaryHoldingId: null }),
    ).toEqual(['templateName', 'holding']);
  });

  it('leaves the amount, destination, category and returns optional', () => {
    expect(
      blockingFields('exchange', {
        ...TEMPLATE,
        amount: '',
        valueIn: '',
        destinationHoldingId: null,
      }),
    ).toEqual([]);
    expect(
      blockingFields('split', {
        ...TEMPLATE,
        changeReturns: [{ holdingId: 'friend', amount: '' }],
        selectedCategory: null,
      }),
    ).toEqual([]);
  });

  it('checks an amount only when it is filled, and blocks a filled zero', () => {
    expect(blockingFields('expense', { ...TEMPLATE, amount: '0' })).toEqual(['amount']);
    expect(blockingFields('expense', { ...TEMPLATE, amount: '5' })).toEqual([]);
    expect(blockingFields('exchange', { ...TEMPLATE, amount: '0' })).toEqual(['valueOut']);
    expect(blockingFields('exchange', { ...TEMPLATE, valueIn: '0' })).toEqual(['valueIn']);
  });

  it('blocks a filled return amount of zero', () => {
    expect(
      blockingFields('split', {
        ...TEMPLATE,
        changeReturns: [{ holdingId: 'friend', amount: '0' }],
      }),
    ).toEqual(['splitReturns']);
  });

  it('puts the exchange fields after the holding', () => {
    expect(
      blockingFields('exchange', {
        ...TEMPLATE,
        primaryHoldingId: null,
        amount: '0',
        valueIn: '0',
        templateName: '',
      }),
    ).toEqual(['templateName', 'holding', 'valueOut', 'valueIn']);
  });

  it('does not mark a split payment invalid for returns that cover it', () => {
    expect(
      isSplitAmountInvalid(
        {
          ...TEMPLATE,
          isSplit: true,
          amount: '1',
          changeReturns: [{ holdingId: 'friend', amount: '5' }],
        },
        true,
      ),
    ).toBe(false);
  });

  it('shows the empty-name error text', () => {
    expect(resolveFieldErrors('expense', { ...TEMPLATE, templateName: ' ' }, t).templateName).toBe(
      'Enter a template name.',
    );
  });

  it('shows the taken error for a name another template holds, ignoring case and spaces', () => {
    const params = {
      ...TEMPLATE,
      templateName: ' оренда ',
      templateNames: [{ id: 'a', name: 'Оренда' }],
    };

    expect(resolveFieldErrors('expense', params, t).templateName).toBe(
      'A template with this name already exists.',
    );
  });

  it('does not count the template being edited as taken', () => {
    expect(
      resolveFieldErrors(
        'expense',
        {
          ...TEMPLATE,
          editTemplateId: 'a',
          templateName: 'оренда',
          templateNames: [{ id: 'a', name: 'Оренда' }],
        },
        t,
      ).templateName,
    ).toBeUndefined();
  });
});

describe('the holding field', () => {
  it('is required in a manual income or expense, with its own error', () => {
    const params = { ...BASE, amount: '5', selectedCategory: 'groceries', primaryHoldingId: null };

    expect(resolveFieldErrors('expense', params, t).holding).toBe('No holding selected.');
    expect(blockingFields('expense', params)).toEqual(['holding']);
  });

  it('is required in an exchange and a split, ahead of every other field', () => {
    const none = { ...BASE, primaryHoldingId: null };

    expect(blockingFields('exchange', none)[0]).toBe('holding');
    expect(blockingFields('split', none)[0]).toBe('holding');
    expect(blockingFields('expense', none)[0]).toBe('holding');
  });

  it('is not asked of a read-only row or a convert, which keep their own holding', () => {
    expect(
      blockingFields('expense', { ...BASE, isReadOnly: true, primaryHoldingId: null }),
    ).toEqual([]);
    expect(blockingFields('converting', { ...BASE, primaryHoldingId: null })).toEqual([
      'counterpartHolding',
      'counterpartAmount',
    ]);
  });

  it('is clear once a holding is picked', () => {
    expect(resolveFieldErrors('expense', BASE, t).holding).toBeUndefined();
  });
});

describe('the template name beside a transaction', () => {
  it('is checked last when it is required, and not at all when it is not', () => {
    const params = {
      ...BASE,
      amount: '5',
      selectedCategory: 'groceries',
      templateNameRequired: true,
      templateName: '',
    };

    expect(blockingFields('expense', params)).toEqual(['templateName']);
    expect(blockingFields('expense', { ...params, amount: '0' })).toEqual([
      'amount',
      'templateName',
    ]);
    expect(blockingFields('expense', { ...params, templateNameRequired: false })).toEqual([]);
  });

  it('keeps the transaction rules in force: a category is still required on a create', () => {
    expect(
      blockingFields('expense', {
        ...BASE,
        amount: '5',
        templateNameRequired: true,
        templateName: 'A',
      }),
    ).toEqual(['selectedCategory']);
  });
});
