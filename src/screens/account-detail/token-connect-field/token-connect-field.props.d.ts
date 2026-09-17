import type { SyncStatus } from '../sync-status-line';

export type TokenConnectFieldProps = {
  // The "how to get this token" copy shown above the field.
  notice: string;
  label: string;
  value: string;
  // Called with the new text on every edit AND on a clipboard paste, where
  // the pasted value arrives already trimmed.
  onChangeText: (text: string) => void;
  placeholder: string;
  // The translated accessibility label for the trailing paste-icon button —
  // VoiceOver has no visible text to read on an icon-only control.
  pasteAccessibilityLabel: string;
  connectLabel: string;
  onConnectPress: () => void;
  connectDisabled: boolean;
  status: SyncStatus;
};
