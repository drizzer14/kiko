import type { BankProviderId } from '../../../bank-sync/provider';

export type AddBankProviderSheetProps = {
  /** Whether the sheet and its dismiss scrim are mounted and shown. */
  visible: boolean;
  /** Called on a tap on the scrim behind the sheet, or a hardware/gesture back. */
  onDismiss: () => void;
  /** Called with the chosen provider's id; the caller closes the sheet. */
  onSelect: (providerId: BankProviderId) => void;
};
