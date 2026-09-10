import { boundToMove } from './nearer-bound';

// Fixed reference timestamps (ms). Spacing is deliberate so the "nearer" bound
// is unambiguous in every non-tie case.
const FROM = 1_000;
const TO = 9_000;

describe('boundToMove', () => {
  it('moves the "from" bound when the pick is nearer to it', () => {
    // 3_000 is 2_000 from FROM, 6_000 from TO.
    expect(boundToMove(FROM, TO, 3_000)).toBe('from');
  });

  it('moves the "to" bound when the pick is nearer to it', () => {
    // 8_000 is 7_000 from FROM, 1_000 from TO.
    expect(boundToMove(FROM, TO, 8_000)).toBe('to');
  });

  it('moves the "from" bound on an exact tie (equidistant)', () => {
    // 5_000 is 4_000 from both bounds.
    expect(boundToMove(FROM, TO, 5_000)).toBe('from');
  });

  it('moves the "from" bound when the pick is outside and below the range', () => {
    // 200 is below FROM, so FROM is the nearer bound; moving it extends the range.
    expect(boundToMove(FROM, TO, 200)).toBe('from');
  });

  it('moves the "to" bound when the pick is outside and above the range', () => {
    // 12_000 is above TO, so TO is the nearer bound; moving it extends the range.
    expect(boundToMove(FROM, TO, 12_000)).toBe('to');
  });

  it('moves the "from" bound when both bounds are open-ended (null)', () => {
    // No bound is defined, so the tie default applies.
    expect(boundToMove(null, null, 5_000)).toBe('from');
  });

  it('moves the defined "to" bound when only "from" is open-ended (null)', () => {
    // A null bound is infinitely far, so the defined bound is always the nearer one.
    expect(boundToMove(null, TO, 5_000)).toBe('to');
  });

  it('moves the defined "from" bound when only "to" is open-ended (null)', () => {
    expect(boundToMove(FROM, null, 5_000)).toBe('from');
  });
});
