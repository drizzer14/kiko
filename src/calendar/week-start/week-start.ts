// CLDR's supplemental week-data table (supplementalData.xml,
// weekData/firstDay) lists, per region, the day its calendar week starts on;
// every region not listed there falls back to CLDR's own default, MONDAY —
// the ISO-8601 convention Ukraine and Kiko's European host countries already
// use, so no table entry is needed for them. The set below is the CLDR
// "sun" (Sunday-first) list. react-native-calendars' `firstDay` (and this
// header's own weekday-column order) only distinguishes Sunday from Monday —
// CLDR lists a handful of further regions that start on Saturday (the Gulf
// states) or Friday (Afghanistan); those fall back to the Monday default
// here rather than adding a third column order for a small, unrelated-to-
// Kiko's-user-base region set.
const SUNDAY_FIRST_REGIONS = new Set([
  'US',
  'CA',
  'BR',
  'MX',
  'JP',
  'KR',
  'TW',
  'HK',
  'PH',
  'IL',
  'ZA',
  'IN',
  'AU',
]);

/**
 * The calendar's first weekday for a device REGION — `0` (Sunday) for the
 * table above, `1` (Monday) for every other region, including an unresolved
 * one. The region is injected (see `deviceRegion`, `src/i18n/device-region`)
 * rather than read here, so this stays a pure, directly testable mapping.
 */
export const weekStartFor = (region: string | undefined): 0 | 1 =>
  region !== undefined && SUNDAY_FIRST_REGIONS.has(region.toUpperCase()) ? 0 : 1;
