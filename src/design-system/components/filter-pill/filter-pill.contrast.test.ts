import { darkTheme, lightTheme } from '@kiko/design-system/theme';
import { compositeOver } from '@kiko/test-support/composite-over';
import { wcagContrastRatio } from '@kiko/design-system/entity-tint';

// The active fill is translucent, so it composites over whatever the pill sits on: the screen
// `background` (Home, Tables) or a card's `surface` (Statistics).
describe.each([
  ['dark', darkTheme],
  ['light', lightTheme],
] as const)('the active filter pill in %s', (_scheme, theme) => {
  describe.each([
    ['background', theme.colors.background],
    ['surface', theme.colors.surface],
  ] as const)('over the %s backdrop', (_backdropName, backdrop) => {
    const fill = compositeOver(theme.colors.accentSubtle, backdrop);

    it('holds 4.5:1 for the textPrimary label on the active fill', () => {
      expect(wcagContrastRatio(theme.colors.textPrimary, fill)).toBeGreaterThanOrEqual(4.5);
    });

    it('holds 3:1 for the accent glyph and border on the active fill', () => {
      expect(wcagContrastRatio(theme.colors.accent, fill)).toBeGreaterThanOrEqual(3);
    });
  });
});
