import { EQUAL_SHARE } from './companion-share';
import { resolvePaneGeometry } from './pane-geometry';

const HAIRLINE = 1;

describe('the companion share', () => {
  it('is one half', () => {
    expect(EQUAL_SHARE).toBe(1 / 2);
  });

  it.each([1100, 1133, 1366, 1376])(
    'splits a flat %i pt columns window into equal halves',
    (width) => {
      const geometry = resolvePaneGeometry(
        'columns',
        { width, height: 820 },
        null,
        HAIRLINE,
        EQUAL_SHARE,
      );

      expect(geometry.companion.width).toBe((width - HAIRLINE) / 2);
      expect(geometry.primary.width).toBe((width - HAIRLINE) / 2);
      expect(geometry.primary.x).toBe((width - HAIRLINE) / 2 + HAIRLINE);
    },
  );

  it('gives the Duo 951 x 669 equal halves', () => {
    const geometry = resolvePaneGeometry(
      'columns',
      { width: 951, height: 669 },
      null,
      HAIRLINE,
      EQUAL_SHARE,
    );

    expect(geometry.companion.width).toBe(475);
    expect(geometry.primary.width).toBe(475);
  });
});
