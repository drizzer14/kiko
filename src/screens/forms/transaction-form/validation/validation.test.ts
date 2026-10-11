import { canSaveSplit } from './validation';

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
