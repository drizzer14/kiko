import { chartSeriesDark, entityColorsDark } from './palette';

// Guards the invariant documented in palette.ts: every chartSeries hue must
// stay a subset of the entityColors hexes. The add-category color picker
// (ColorPicker over entityColors) rings the swatch whose hex equals the
// resolved category color, and an uncolored category falls back to its
// chartSeries hue — so a fallback hue absent from entityColors would ring no
// swatch on the add form. This fails the moment a chartSeries entry is added or
// changed without a matching swatch.
describe('palette invariant: chartSeries hues are a subset of entityColors hues', () => {
  it('every chartSeries hue exists as an entityColors swatch', () => {
    const swatchHexes = new Set<string>(Object.values(entityColorsDark));
    const missing = chartSeriesDark.filter((hue) => !swatchHexes.has(hue));

    expect(missing).toEqual([]);
  });
});
