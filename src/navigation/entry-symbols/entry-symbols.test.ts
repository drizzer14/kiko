import { entrySymbol } from './entry-symbols';

describe('entrySymbol', () => {
  it('holds the glyph of every screen the Help footer opens', () => {
    expect(entrySymbol).toEqual({
      system: 'gearshape',
      reminders: 'bell',
      importData: 'square.and.arrow.down',
      exportData: 'square.and.arrow.up',
      statistics: 'chart.xyaxis.line',
    });
  });
});
