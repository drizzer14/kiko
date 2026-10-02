import type { SettingsRow } from './schema';

/**
 * The `settings` columns a `.kiko` restore keeps from the live row. A file can
 * carry any value or none for them, and each belongs to this device, so the
 * file never decides it; every other column comes from the file.
 * `settings-columns.test.ts` fails a new column until it is listed here or as
 * taken from the file.
 */
export const KEPT_FROM_LIVE_ON_RESTORE = [
  // Turning the lock off needs the owner to confirm in Settings.
  'lockEnabled',
  // Counts the calls this device's own EODHD key spent today.
  'quoteQuota',
  // When iOS first allowed notifications on this device: the reminders'
  // ignored count starts from it.
  'notificationsDeliverableSince',
] as const satisfies readonly (keyof SettingsRow)[];
