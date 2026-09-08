import { chartSeriesByScheme, entityColorsByScheme } from './palette';

// Guards the invariant documented in palette.ts: every chartSeries hue must
// stay a subset of the same scheme's entityColors hexes. The add-category color
// picker (ColorPicker over entityColors) rings the swatch whose hex equals the
// resolved category color, and an uncolored category falls back to its
// chartSeries hue — so a fallback hue absent from entityColors would ring no
// swatch on the add form (regressing Task 8's ring-on-open). This fails the
// moment a chartSeries entry is added or changed without a matching swatch.
describe('palette invariant: chartSeries hues are a subset of entityColors hues', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`every ${scheme} chartSeries hue exists as an ${scheme} entityColors swatch`, () => {
      const swatchHexes = new Set(Object.values(entityColorsByScheme[scheme]));
      const missing = chartSeriesByScheme[scheme].filter((hue) => !swatchHexes.has(hue));

      expect(missing).toEqual([]);
    });
  }
});
