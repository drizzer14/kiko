import { NativeModules } from 'react-native';

// The iOS-only, dependency-free device REGION read (Settings > General >
// Language & Region > Region) — used only for the calendar's week-start day
// (weekStartFor, `src/calendar/week-start`), NEVER for the app's display
// language, which stays deviceLanguage's own AppleLanguages read: iOS lets a
// user pick a Region independently of their Language, and a native calendar
// app follows the Region for its week start, not the Language. AppleLocale
// (a React Native SettingsManager built-in, the same family deviceLanguage
// already reads) is the current locale identifier — underscore-joined ICU
// style (e.g. "en_US"), unlike AppleLanguages' dash-joined BCP-47 tags — and
// its region subtag reflects the Region setting even when it differs from
// the Language.
export const deviceRegion = (): string | undefined => {
  const locale: string | undefined = NativeModules?.SettingsManager?.settings?.AppleLocale;

  // iOS's "Regional Override" setting appends a CLDR locale extension (for
  // example "@rg=gbzzzz") after the region subtag; strip it before
  // splitting, or the extension's own segments pollute the search below.
  const localeWithoutExtension = locale?.split('@')[0];

  // The region subtag is the first 2-letter segment after the leading
  // language subtag; a script subtag (e.g. "Hans") is always 4 letters and
  // never matches.
  const region = localeWithoutExtension
    ?.split(/[-_]/)
    .slice(1)
    .find((segment) => /^[a-zA-Z]{2}$/.test(segment));

  return region?.toUpperCase();
};
