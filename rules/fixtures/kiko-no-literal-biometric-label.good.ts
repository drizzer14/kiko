// Semgrep fixture (NEGATIVE): the same options shape as
// kiko-no-literal-biometric-label.bad.ts, but each label is routed through
// i18n.t(...) or a variable the caller supplies — neither is a hardcoded
// string literal, so kiko-no-literal-biometric-label stays silent.
import { i18n } from '../../src/i18n';

export const buildOptions = (prompt: string, fallbackText: string) => ({
  title: prompt,
  allowDeviceCredentials: true,
  cancelLabel: i18n.t('common.cancel'),
  fallbackLabel: fallbackText,
});
