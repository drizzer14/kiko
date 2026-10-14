import { REMINDERS_BELL_SYMBOL } from '@kiko/design-system/edit-bar-item';

// The glyph of each screen the app opens from one place and the Help footer opens too, so an entry
// and its Help button read from one source and cannot drift apart. The account, transaction,
// template and category entries are the generic entity symbols instead.
export const entrySymbol = {
  system: 'gearshape',
  reminders: REMINDERS_BELL_SYMBOL,
  importData: 'square.and.arrow.down',
  exportData: 'square.and.arrow.up',
  statistics: 'chart.xyaxis.line',
} as const;
