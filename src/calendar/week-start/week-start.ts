// CLDR's supplemental week-data table (unicode-org/cldr-json,
// cldr-core/supplemental/weekData.json, checked 2026-09-26 by
// kiko:researcher against
// https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/weekData.json)
// lists, per region, the day its calendar week starts on; every region not
// listed there falls back to CLDR's own default, MONDAY — the ISO-8601
// convention Ukraine and Kiko's European host countries already use, so no
// table entry is needed for them. The set below is the FULL current CLDR
// "sun" (Sunday-first) territory list. react-native-calendars' `firstDay`
// (and this header's own weekday-column order) only distinguishes Sunday
// from Monday — CLDR lists a handful of further regions that start on
// Saturday (the Gulf states) or Friday (Afghanistan); those fall back to the
// Monday default here rather than adding a third column order for a small,
// unrelated-to-Kiko's-user-base region set. AU is Monday-first as of
// CLDR-14795 (~v40) and is deliberately absent from this table.
const SUNDAY_FIRST_REGIONS = new Set([
  'AG',
  'AS',
  'BD',
  'BR',
  'BS',
  'BT',
  'BW',
  'BZ',
  'CA',
  'CO',
  'DM',
  'DO',
  'ET',
  'GT',
  'GU',
  'HK',
  'ID',
  'IL',
  'IN',
  'JM',
  'JP',
  'KE',
  'KH',
  'KR',
  'LA',
  'MH',
  'MM',
  'MO',
  'MT',
  'MX',
  'MZ',
  'NI',
  'NP',
  'PA',
  'PE',
  'PH',
  'PK',
  'PR',
  'PT',
  'PY',
  'SA',
  'SG',
  'SV',
  'TH',
  'TT',
  'TW',
  'UM',
  'US',
  'VE',
  'VI',
  'WS',
  'YE',
  'ZA',
  'ZW',
]);

/**
 * The calendar's first weekday for a device REGION — `0` (Sunday) for the
 * table above, `1` (Monday) for every other region, including an unresolved
 * one. The region is injected (see `deviceRegion`, `src/i18n/device-region`)
 * rather than read here, so this stays a pure, directly testable mapping.
 */
export const weekStartFor = (region: string | undefined): 0 | 1 =>
  region !== undefined && SUNDAY_FIRST_REGIONS.has(region.toUpperCase()) ? 0 : 1;
