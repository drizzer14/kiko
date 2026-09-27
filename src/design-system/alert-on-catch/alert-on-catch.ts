import { Alert } from 'react-native';
import type { ParseKeys, TFunction } from 'i18next';

/**
 * The repeated "translated Alert, no dynamic content, no custom buttons"
 * shape every write-failure `catch` across the forms and sync screens used —
 * `Alert.alert(t(titleKey), t(messageKey))` — centralized so a future change
 * to that shape lands in one place instead of at every duplicated call site.
 */
export const alertOnCatch = (t: TFunction, titleKey: ParseKeys, messageKey: ParseKeys): void => {
  Alert.alert(t(titleKey), t(messageKey));
};
