import { REMINDERS_BELL_SYMBOL } from '@kiko/design-system/edit-bar-item';

// The glyph of each place the app opens from one entry, read from one source so an entry and the
// Help button that opens the same screen cannot drift apart (`exportCsv` is a Settings row only).
// The account, transaction, template and category entries are the generic entity symbols instead.
export const entrySymbol = {
  system: 'gearshape',
  reminders: REMINDERS_BELL_SYMBOL,
  importData: 'square.and.arrow.down',
  exportData: 'square.and.arrow.up',
  exportCsv: 'tablecells',
  statistics: 'chart.xyaxis.line',
  recurringCharges: 'repeat',
} as const;
