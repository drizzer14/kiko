import type { RefObject } from 'react';
import type { Weekday } from '@kiko/reminders/schedule';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

export type WeekdayFieldProps = {
  label: string;
  selected: readonly Weekday[];
  // Reports the whole new set after one day was added or removed.
  onChange: (weekdays: Weekday[]) => void;
  error?: string;
  // The field's own box, so a failed Save can scroll to it.
  fieldRef?: RefObject<FieldInstance | null>;
};
