import { EQUAL_SHARE, LIST_SHARE, resolveCompanionShare } from './companion-share';

const HAIRLINE = 1;
const LIST_PANE_FLOOR = 320;
// A window of exactly this width gives the list pane its 2/5 at the floor: (w - 1) * 2/5 = 320.
const CROSSOVER_WIDTH = LIST_PANE_FLOOR / LIST_SHARE + HAIRLINE;

describe('resolveCompanionShare', () => {
  it('is the 2/5 a list tab asks for in a columns window above the 800 pt crossover', () => {
    expect(resolveCompanionShare('columns', 951, HAIRLINE, LIST_SHARE)).toBe(LIST_SHARE);
    expect(resolveCompanionShare('columns', 1366, HAIRLINE, LIST_SHARE)).toBe(LIST_SHARE);
  });

  it('is the 2/5 exactly at the crossover', () => {
    expect(CROSSOVER_WIDTH).toBe(801);
    expect(resolveCompanionShare('columns', CROSSOVER_WIDTH, HAIRLINE, LIST_SHARE)).toBe(
      LIST_SHARE,
    );
  });

  it.each([700, 744, 800])('keeps the list pane at 320 pt in a %i pt window', (width) => {
    const share = resolveCompanionShare('columns', width, HAIRLINE, LIST_SHARE);

    expect(share).toBeGreaterThan(LIST_SHARE);
    expect(share * (width - HAIRLINE)).toBeCloseTo(LIST_PANE_FLOOR, 8);
  });

  it('defaults to one half', () => {
    expect(resolveCompanionShare('columns', 1100, HAIRLINE)).toBe(EQUAL_SHARE);
  });

  it('never narrows a share that asks for more than the floor', () => {
    expect(resolveCompanionShare('columns', 1100, HAIRLINE, 0.6)).toBe(0.6);
  });

  it.each([LIST_SHARE, 0.6, EQUAL_SHARE])(
    'keeps rows equal whatever share %d was asked',
    (share) => {
      expect(resolveCompanionShare('rows', 1100, HAIRLINE, share)).toBe(EQUAL_SHARE);
    },
  );
});
