import type { FoldRegion, HorizontalSizeClass } from '@kiko/display-regions';

import { resolveSheetFrame } from './bottom-sheet.layout';

const HAIRLINE = 1;
const MAX_WIDTH = 540;
const FOLD_GAP = 24;

const INNER_LANDSCAPE = { width: 951, height: 669 };
const INNER_PORTRAIT = { width: 669, height: 951 };
const OUTER = { width: 466, height: 678 };

const frameOf = (
  mode: 'single' | 'columns' | 'rows',
  window: { width: number; height: number },
  fold: FoldRegion = null,
  sizeClass: HorizontalSizeClass = 'compact',
) => resolveSheetFrame({ mode, sizeClass, window, fold, hairline: HAIRLINE, maxWidth: MAX_WIDTH });

describe('resolveSheetFrame', () => {
  it('leaves a single window full width, as before', () => {
    expect(frameOf('single', OUTER)).toEqual({});
  });

  it('caps a single regular window at the maximum width and centres it', () => {
    expect(frameOf('single', { width: 720, height: 500 }, null, 'regular')).toEqual({
      width: 540,
      left: (720 - 540) / 2,
    });
  });

  it('shrinks the card to a single regular window narrower than the maximum width', () => {
    expect(frameOf('single', { width: 500, height: 720 }, null, 'regular')).toEqual({
      width: 500,
      left: 0,
    });
  });

  it('leaves a single compact iPhone window full width', () => {
    expect(frameOf('single', { width: 390, height: 844 })).toEqual({});
  });

  it('leaves a single window alone even while a fold is reported', () => {
    expect(frameOf('single', OUTER, { x: 0, y: 300, width: 466, height: FOLD_GAP })).toEqual({});
  });

  it('centres a card of the maximum width in a flat landscape window', () => {
    expect(frameOf('columns', INNER_LANDSCAPE)).toEqual({ width: 540, left: (951 - 540) / 2 });
  });

  it('centres a card of the maximum width in a flat portrait window', () => {
    expect(frameOf('rows', INNER_PORTRAIT)).toEqual({ width: 540, left: (669 - 540) / 2 });
  });

  it('shrinks the card to a regular window narrower than the maximum width', () => {
    expect(frameOf('columns', { width: 500, height: 400 })).toEqual({ width: 500, left: 0 });
  });

  it('centres the card in the right pane in a book posture', () => {
    const fold = { x: 300, y: 0, width: FOLD_GAP, height: 800 };

    expect(frameOf('columns', { width: 1400, height: 800 }, fold)).toEqual({
      width: 540,
      left: 324 + (1076 - 540) / 2,
    });
  });

  it('shrinks the card to a right pane narrower than the maximum width', () => {
    const fold = { x: 463, y: 0, width: FOLD_GAP, height: 669 };

    expect(frameOf('columns', INNER_LANDSCAPE, fold)).toEqual({ width: 464, left: 487 });
  });

  it('caps the height to the bottom pane in a tabletop posture', () => {
    const fold = { x: 0, y: 463, width: 669, height: FOLD_GAP };

    expect(frameOf('rows', INNER_PORTRAIT, fold)).toEqual({
      width: 540,
      left: (669 - 540) / 2,
      heightCap: 951 - (463 + FOLD_GAP),
    });
  });

  it('does not cap the height of a flat portrait window', () => {
    expect(frameOf('rows', INNER_PORTRAIT).heightCap).toBeUndefined();
  });

  it('treats a fold across the wrong axis for the mode as flat', () => {
    const horizontalFold = { x: 0, y: 300, width: 951, height: FOLD_GAP };

    expect(frameOf('columns', INNER_LANDSCAPE, horizontalFold)).toEqual({
      width: 540,
      left: (951 - 540) / 2,
    });
  });

  // The user-visible promise: the card never straddles a reported fold.
  describe('invariant', () => {
    const positions = Array.from({ length: 36 }, (_, step) => 300 + step * 10);

    it.each(positions)('keeps the card clear of a vertical fold at x %i', (x) => {
      const fold = { x, y: 0, width: FOLD_GAP, height: INNER_LANDSCAPE.height };
      const { width = 0, left = 0 } = frameOf('columns', INNER_LANDSCAPE, fold);

      expect(left).toBeGreaterThanOrEqual(x + FOLD_GAP);
      expect(left + width).toBeLessThanOrEqual(INNER_LANDSCAPE.width);
    });

    it.each(positions)('caps the card height under a horizontal fold at y %i', (y) => {
      const fold = { x: 0, y, width: INNER_PORTRAIT.width, height: FOLD_GAP };
      const { heightCap = Infinity } = frameOf('rows', INNER_PORTRAIT, fold);

      expect(heightCap).toBeLessThanOrEqual(INNER_PORTRAIT.height - (y + FOLD_GAP));
    });
  });
});
