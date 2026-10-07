import type { RefObject } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';

/**
 * What a Connect field (Monobank token, Binance key pair, wallet address) shares with a form that
 * reminds the user to press Connect before saving. The field keeps its input to itself, so it
 * reports whether anything is typed instead of handing the value out.
 */
export type ConnectReminder = {
  // Hung on the field's Connect row, so a blocked Save can scroll the hint into view.
  ref: RefObject<FieldInstance | null>;
  // The hint shown under the Connect button, or `undefined` while there is nothing to remind of.
  message: string | undefined;
  // Called on every edit and paste with whether any input is typed, and with `false` once the
  // field unmounts, since its input goes with it.
  onDraftChange: (hasDraft: boolean) => void;
  // Called whenever the Connect button is pressed.
  onConnectPress: () => void;
};
