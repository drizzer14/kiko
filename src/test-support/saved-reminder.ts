import type { ReminderRow } from '@kiko/db';

// An active daily add-transactions reminder, as the reminder pages and rows
// read it back from the table.
export const savedReminder = (overrides: Partial<ReminderRow> = {}): ReminderRow => ({
  id: 'r-1',
  accountId: 'a-1',
  kind: 'add_transactions',
  schedule: { frequency: 'daily', minuteOfDay: 20 * 60 },
  pausedAt: null,
  pauseReason: null,
  activeSince: 0,
  lastEngagedAt: null,
  lastSnoozedAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});
