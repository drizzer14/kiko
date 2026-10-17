import { MINIMUM_PANE_LENGTH } from '@kiko/display-regions';

import {
  EQUAL_SHARE,
  resolveCompanionShare,
  WIDE_SHARE,
  WIDE_SPLIT_MIN_WIDTH,
} from './companion-share';
import { resolvePaneGeometry } from './pane-geometry';

const HAIRLINE = 1;

describe('resolveCompanionShare', () => {
  it('pins the share constants', () => {
    expect(EQUAL_SHARE).toBe(1 / 2);
    expect(WIDE_SHARE).toBe(2 / 3);
    expect(WIDE_SPLIT_MIN_WIDTH).toBe(1100);
  });

  it('gives a companion wide slot two thirds at 1366 x 1024 (Home)', () => {
    const window = { width: 1366, height: 1024 };
    const share = resolveCompanionShare('columns', window, 'companion');
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(share).toBe(WIDE_SHARE);
    expect(geometry.companion.width).toBeCloseTo(910, 5);
    expect(geometry.primary.width).toBeCloseTo(455, 5);
  });

  it('gives a primary wide slot one third to the companion at 1366 x 1024 (Statistics)', () => {
    const window = { width: 1366, height: 1024 };
    const share = resolveCompanionShare('columns', window, 'primary');
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(share).toBe(1 - WIDE_SHARE);
    expect(geometry.companion.width).toBeCloseTo(455, 5);
    expect(geometry.primary.width).toBeCloseTo(910, 5);
  });

  it('keeps equal halves at 1366 x 1024 without a wide slot (Accounts, Settings)', () => {
    const window = { width: 1366, height: 1024 };
    const share = resolveCompanionShare('columns', window, undefined);
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(share).toBe(EQUAL_SHARE);
    expect(geometry.companion.width).toBe(682.5);
    expect(geometry.primary.width).toBe(682.5);
  });

  it('splits 1100 x 820 Home at two thirds', () => {
    const window = { width: 1100, height: 820 };
    const share = resolveCompanionShare('columns', window, 'companion');
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(geometry.companion.width).toBeCloseTo(732.67, 2);
    expect(geometry.primary.width).toBeCloseTo(366.33, 2);
  });

  it('keeps equal halves one point below the 1100 boundary', () => {
    const window = { width: 1099, height: 820 };
    const share = resolveCompanionShare('columns', window, 'companion');
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(share).toBe(EQUAL_SHARE);
    expect(geometry.companion.width).toBe(549);
    expect(geometry.primary.width).toBe(549);
  });

  it('switches to the wide share exactly at 1100', () => {
    expect(resolveCompanionShare('columns', { width: 1099, height: 820 }, 'companion')).toBe(
      EQUAL_SHARE,
    );
    expect(resolveCompanionShare('columns', { width: 1100, height: 820 }, 'companion')).toBe(
      WIDE_SHARE,
    );
  });

  it('gives rows equal halves at any size, for either wide slot', () => {
    const sizes = [
      { width: 1032, height: 1376 },
      { width: 2000, height: 3000 },
      { width: 1366, height: 1024 },
    ];

    sizes.forEach((window) => {
      expect(resolveCompanionShare('rows', window, 'companion')).toBe(EQUAL_SHARE);
      expect(resolveCompanionShare('rows', window, 'primary')).toBe(EQUAL_SHARE);
    });
  });

  it('gives the Duo 951 x 669 equal halves', () => {
    const window = { width: 951, height: 669 };
    const share = resolveCompanionShare('columns', window, 'companion');
    const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

    expect(share).toBe(EQUAL_SHARE);
    expect(geometry.companion.width).toBe(475);
    expect(geometry.primary.width).toBe(475);
  });

  it('keeps the smaller flat pane at the minimum pane length across 1100..1376 x 320..1376', () => {
    let smallestPane = Number.POSITIVE_INFINITY;

    (['companion', 'primary'] as const).forEach((wideSlot) => {
      for (let width = 1100; width <= 1376; width += 1) {
        for (let height = 320; height <= 1376; height += 1) {
          const window = { width, height };
          const share = resolveCompanionShare('columns', window, wideSlot);
          const geometry = resolvePaneGeometry('columns', window, null, HAIRLINE, share);

          smallestPane = Math.min(smallestPane, geometry.companion.width, geometry.primary.width);
        }
      }
    });

    expect(smallestPane).toBeGreaterThanOrEqual(MINIMUM_PANE_LENGTH);
    expect(MINIMUM_PANE_LENGTH).toBe(360);
  });
});
