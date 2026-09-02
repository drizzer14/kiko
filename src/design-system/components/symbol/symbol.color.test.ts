import { toSFSymbolTintColor } from './symbol.color';

describe('toSFSymbolTintColor', () => {
  it('converts an rgba() theme color to #RRGGBBAA hex', () => {
    // theme.colors.textSecondary
    expect(toSFSymbolTintColor('rgba(235,235,245,0.60)')).toBe('#ebebf599');
  });

  it('converts an rgb() color (no alpha) to opaque #RRGGBBAA hex', () => {
    expect(toSFSymbolTintColor('rgb(255,0,0)')).toBe('#ff0000ff');
  });

  it('passes an already-hex color through unchanged', () => {
    // theme.colors.textPrimary / positive / negative are already hex.
    expect(toSFSymbolTintColor('#FFFFFF')).toBe('#FFFFFF');
    expect(toSFSymbolTintColor('#30D158')).toBe('#30D158');
  });

  it('passes through a color string it does not recognize as rgba()/rgb()', () => {
    expect(toSFSymbolTintColor('red')).toBe('red');
  });
});
