import { resolveTopClearance } from './top-clearance';

describe('resolveTopClearance', () => {
  it('is the 44 pt pill under a top bar: content at 76 pt below a 32 pt inset (Pro 13-inch full screen; bar bottom 76)', () => {
    const insetTop = 32;

    expect(insetTop + resolveTopClearance('top')).toBe(76);
  });

  it('is the 44 pt pill below a 10 pt inset, 54 pt (Stage Manager bottom half; bar bottom 54)', () => {
    const insetTop = 10;

    expect(insetTop + resolveTopClearance('top')).toBe(54);
  });

  it('is zero under a bottom bar', () => {
    expect(resolveTopClearance('bottom')).toBe(0);
  });

  it('is zero beside a side bar', () => {
    expect(resolveTopClearance('side')).toBe(0);
  });
});
