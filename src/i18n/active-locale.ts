import { match } from 'ts-pattern';

import type { AppLanguage } from './device-language';
import { i18n } from './index';

// The BCP-47 locale for Number.prototype.toLocaleString, off the active
// i18next language. uk-UA groups as `1 234,56` (space thousands, comma
// decimal); en-US as `1,234.56`. Only the numeric punctuation follows this —
// currency-symbol placement is decided by the format functions themselves.
export const activeLocale = (): 'en-US' | 'uk-UA' =>
  match((i18n.language ?? 'en') as AppLanguage | string)
    .with('uk', () => 'uk-UA' as const)
    .otherwise(() => 'en-US' as const);
