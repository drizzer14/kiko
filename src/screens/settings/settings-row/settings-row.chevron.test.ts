import '../../../design-system/unistyles';
import { darkTheme } from '../../../design-system/theme';

import { chevronSize, chevronTrailingWhitespace } from './settings-row.chevron';

describe('settings-row.chevron', () => {
  describe('chevronSize', () => {
    it('matches the row title\'s own fontSize (the label\'s `variant="body"` Text)', () => {
      expect(chevronSize(darkTheme)).toBe(darkTheme.typography.body.fontSize);
    });

    it('is smaller than the default SymbolIcon icon size the chevron used to fall back to', () => {
      // The whole point of round-7 item 2: the chevron must shrink relative
      // to its old (larger) default, not stay the same or grow.
      expect(chevronSize(darkTheme)).toBeLessThan(darkTheme.iconSizes.body);
    });
  });

  describe('chevronTrailingWhitespace', () => {
    it("returns the gap between the glyph's visible right edge and its render frame's right edge, snapped to the 4pt spacing grid", () => {
      const size = chevronSize(darkTheme);
      const whitespace = chevronTrailingWhitespace(size, darkTheme);

      // The glyph is centered in a square frame narrower than the frame
      // itself, so the whitespace must be strictly less than half the frame
      // (the glyph occupies more than 0 width) and a positive multiple of
      // the spacing grid step.
      expect(whitespace).toBeGreaterThan(0);
      expect(whitespace).toBeLessThan(size / 2);
      expect(whitespace % darkTheme.spacing(1)).toBe(0);
    });

    it('scales up for a larger chevron frame', () => {
      const small = chevronTrailingWhitespace(16, darkTheme);
      const large = chevronTrailingWhitespace(32, darkTheme);

      expect(large).toBeGreaterThan(small);
    });
  });
});
