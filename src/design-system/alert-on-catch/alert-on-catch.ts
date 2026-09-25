import { Alert } from 'react-native';
import type { ParseKeys, TFunction } from 'i18next';

// i18next's own catalog-key union (see `src/i18n/i18next.d.ts`) — reused here
// so `titleKey`/`messageKey` stay checked against the real catalog rather
// than widened to a bare `string`.
type TranslationKey = ParseKeys;

/**
 * The repeated "translated Alert, no dynamic content, no custom buttons"
 * shape every write-failure `catch` across the forms and sync screens used —
 * `Alert.alert(t(titleKey), t(messageKey))` — centralized so a future change
 * to that shape lands in one place instead of at every duplicated call site.
 */
export const alertOnCatch = (
  t: TFunction,
  titleKey: TranslationKey,
  messageKey: TranslationKey,
): void => {
  Alert.alert(t(titleKey), t(messageKey));
};
