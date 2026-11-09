import { entrySymbol } from './entry-symbols';

describe('entrySymbol', () => {
  it('holds the glyph of every entry that has its own symbol', () => {
    expect(entrySymbol).toEqual({
      system: 'gearshape',
      reminders: 'bell',
      importData: 'square.and.arrow.down',
      exportData: 'square.and.arrow.up',
      exportCsv: 'tablecells',
      statistics: 'chart.xyaxis.line',
      recurringCharges: 'repeat',
    });
  });
});
