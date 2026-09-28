import type { ReminderRow as SavedReminder } from '@kiko/db';
import type { ReminderKind } from '@kiko/reminders/schedule';

export type ReminderRowProps = {
  kind: ReminderKind;
  // Undefined while the account has no reminder of this kind.
  reminder: SavedReminder | undefined;
  // False once the account no longer allows this kind; the saved reminder
  // stays listed so the user can still remove it.
  available: boolean;
  accountArchived: boolean;
  onOpen: () => void;
  onPausedChange: (paused: boolean) => void;
  onDelete: () => void;
};
