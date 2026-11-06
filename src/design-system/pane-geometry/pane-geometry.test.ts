import { MINIMUM_PANE_LENGTH } from '@kiko/display-regions';

import { EQUAL_SHARE } from './companion-share';
import { belowTopBand, resolvePaneGeometry, wholeWindowFrame } from '.';

const HAIRLINE = 1;
const UNEQUAL_SHARE = 2 / 3;

// A fold ignores the share, so its cases pass an unequal one to prove it.
const resolveWithUnequalShare = (
  mode: 'columns' | 'rows',
  window: { width: number; height: number },
  fold: { x: number; y: number; width: number; height: number },
) => resolvePaneGeometry(mode, window, fold, HAIRLINE, UNEQUAL_SHARE);

describe('resolvePaneGeometry', () => {
  describe('the Duo fixtures keep every pane at the minimum pane length or more', () => {
    it('flat landscape inner window', () => {
      const geometry = resolvePaneGeometry(
        'columns',
        { width: 951, height: 669 },
        null,
        HAIRLINE,
        EQUAL_SHARE,
      );

      expect(geometry.companion.width).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
      expect(geometry.primary.width).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
    });

    it('flat portrait inner window', () => {
      const geometry = resolvePaneGeometry(
        'rows',
        { width: 669, height: 951 },
        null,
        HAIRLINE,
        EQUAL_SHARE,
      );

      expect(geometry.companion.height).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
      expect(geometry.primary.height).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
    });

    it('half-open landscape fold', () => {
      const fold = { x: 455.5, y: 0, width: 40, height: 669 };
      const geometry = resolvePaneGeometry(
        'columns',
        { width: 951, height: 669 },
        fold,
        HAIRLINE,
        EQUAL_SHARE,
      );

      expect(geometry.companion.width).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
      expect(geometry.primary.width).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
    });

    it('portrait fold in the rows window', () => {
      const fold = { x: 0, y: 470, width: 669, height: 24 };
      const geometry = resolvePaneGeometry(
        'rows',
        { width: 669, height: 951 },
        fold,
        HAIRLINE,
        EQUAL_SHARE,
      );

      expect(geometry.companion.height).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
      expect(geometry.primary.height).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
    });
  });

  it('splits a flat columns window into equal halves around a hairline divider', () => {
    const geometry = resolvePaneGeometry(
      'columns',
      { width: 951, height: 669 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 475, height: 669 });
    expect(geometry.divider).toEqual({ x: 475, y: 0, width: 1, height: 669 });
    expect(geometry.primary).toEqual({ x: 476, y: 0, width: 475, height: 669 });
    expect(geometry.isFolded).toBe(false);
  });

  it('gives each pane half of a flat 1366 x 1024 columns window at the equal share', () => {
    const geometry = resolvePaneGeometry(
      'columns',
      { width: 1366, height: 1024 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );

    expect(geometry.companion.width).toBe(682.5);
    expect(geometry.divider.x).toBe(682.5);
    expect(geometry.primary.x).toBe(683.5);
    expect(geometry.primary.width).toBe(682.5);
  });

  it('puts the companion on top and the primary at the bottom of a flat rows window', () => {
    const geometry = resolvePaneGeometry(
      'rows',
      { width: 669, height: 951 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 669, height: 475 });
    expect(geometry.divider).toEqual({ x: 0, y: 475, width: 669, height: 1 });
    expect(geometry.primary).toEqual({ x: 0, y: 476, width: 669, height: 475 });
    expect(geometry.isFolded).toBe(false);
  });

  it('ends the panes at the fold edges in columns', () => {
    const fold = { x: 465, y: 0, width: 21, height: 669 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 465, height: 669 });
    expect(geometry.primary).toEqual({ x: 486, y: 0, width: 465, height: 669 });
    expect(geometry.isFolded).toBe(true);
  });

  it('ends the panes at the fold edges in rows', () => {
    const fold = { x: 0, y: 470, width: 669, height: 24 };
    const geometry = resolveWithUnequalShare('rows', { width: 669, height: 951 }, fold);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 669, height: 470 });
    expect(geometry.primary).toEqual({ x: 0, y: 494, width: 669, height: 457 });
    expect(geometry.isFolded).toBe(true);
  });

  // A rotation while half open can pair the new mode with the old fold; that fold is a transient
  // and must not collapse a pane.
  it('treats a tall fold as flat in rows, so no pane collapses to zero size', () => {
    const fold = { x: 455.5, y: 0, width: 40, height: 669 };
    const geometry = resolvePaneGeometry(
      'rows',
      { width: 669, height: 951 },
      fold,
      1 / 3,
      EQUAL_SHARE,
    );

    expect(geometry.isFolded).toBe(false);
    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 669, height: (951 - 1 / 3) / 2 });
    expect(geometry.primary.height).toBeCloseTo((951 - 1 / 3) / 2, 5);
  });

  it('treats a wide fold as flat in columns, so no pane collapses to zero size', () => {
    const fold = { x: 0, y: 270, width: 951, height: 40 };
    const geometry = resolvePaneGeometry(
      'columns',
      { width: 951, height: 669 },
      fold,
      1 / 3,
      EQUAL_SHARE,
    );

    expect(geometry.isFolded).toBe(false);
    expect(geometry.companion).toEqual({ x: 0, y: 0, width: (951 - 1 / 3) / 2, height: 669 });
    expect(geometry.primary.width).toBeCloseTo((951 - 1 / 3) / 2, 5);
  });

  it('still splits at a fold a fraction of a point shorter than the window', () => {
    const fold = { x: 455.5, y: 0, width: 40, height: 668.9 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.isFolded).toBe(true);
    expect(geometry.companion.width).toBe(455.5);
    expect(geometry.primary.x).toBe(495.5);
  });

  it('measured Duo half-open: a centred 40 pt vertical fold gives equal halves', () => {
    const fold = { x: 455.5, y: 0, width: 40, height: 669 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 455.5, height: 669 });
    expect(geometry.primary).toEqual({ x: 495.5, y: 0, width: 455.5, height: 669 });
    expect(geometry.isFolded).toBe(true);
  });

  it('keeps an off-centre fold unequal: each pane stops at the fold edge', () => {
    const fold = { x: 300, y: 0, width: 20, height: 669 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.companion.width).toBe(300);
    expect(geometry.primary).toEqual({ x: 320, y: 0, width: 631, height: 669 });
  });

  it('clamps a fold that overhangs the window so no pane goes negative', () => {
    const fold = { x: 940, y: 0, width: 40, height: 669 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.companion.width).toBe(940);
    expect(geometry.primary).toEqual({ x: 951, y: 0, width: 0, height: 669 });
  });

  it('clamps a fold that starts before the window', () => {
    const fold = { x: -10, y: 0, width: 20, height: 669 };
    const geometry = resolveWithUnequalShare('columns', { width: 951, height: 669 }, fold);

    expect(geometry.companion.width).toBe(0);
    expect(geometry.primary.x).toBe(10);
  });
});

describe('belowTopBand', () => {
  const BAND = 76;

  it('moves the companion, divider and primary of flat 1376x1032 columns below the band', () => {
    const flat = resolvePaneGeometry(
      'columns',
      { width: 1376, height: 1032 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );
    const moved = belowTopBand(flat, BAND);

    for (const name of ['companion', 'divider', 'primary'] as const) {
      expect(moved[name]).toEqual({ ...flat[name], y: BAND, height: 956 });
    }
    expect(moved.isFolded).toBe(false);
  });

  it('moves both panes of a folded columns window, and keeps the fold flag', () => {
    const fold = { x: 455.5, y: 0, width: 40, height: 669 };
    const folded = resolvePaneGeometry(
      'columns',
      { width: 951, height: 669 },
      fold,
      HAIRLINE,
      EQUAL_SHARE,
    );
    const moved = belowTopBand(folded, BAND);

    expect(moved.companion).toEqual({ ...folded.companion, y: BAND, height: 669 - BAND });
    expect(moved.primary).toEqual({ ...folded.primary, y: BAND, height: 669 - BAND });
    expect(moved.isFolded).toBe(true);
  });

  it('moves only the companion of 683x909 rows: the primary already lies below the top', () => {
    const rows = resolvePaneGeometry(
      'rows',
      { width: 683, height: 909 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );
    const moved = belowTopBand(rows, BAND);

    expect(moved.companion).toEqual({
      ...rows.companion,
      y: BAND,
      height: rows.companion.height - BAND,
    });
    expect(moved.divider).toEqual(rows.divider);
    expect(moved.primary).toEqual(rows.primary);
  });

  it.each([
    ['columns', { width: 1376, height: 1032 }],
    ['rows', { width: 683, height: 909 }],
  ] as const)('returns the %s geometry unchanged at band 0', (mode, window) => {
    const geometry = resolvePaneGeometry(mode, window, null, HAIRLINE, EQUAL_SHARE);

    expect(belowTopBand(geometry, 0)).toEqual(geometry);
  });
});

describe('wholeWindowFrame', () => {
  const WINDOW = { width: 951, height: 669 };

  it('is the window below the top-bar band', () => {
    expect(wholeWindowFrame(WINDOW, 76)).toEqual({ x: 0, y: 76, width: 951, height: 593 });
  });

  it('is the whole window at band 0', () => {
    expect(wholeWindowFrame(WINDOW, 0)).toEqual({ x: 0, y: 0, width: 951, height: 669 });
  });
});
