// The time zone a column-mapped file's wall clocks are read in, saved with
// the mapping. Every zone here is a hand-rolled `ZoneRule` (`@kiko/dates`),
// never an `Intl` zone name: Hermes' `Intl` timeZone support is unverified
// on device.
import { type ZoneRule, KYIV_ZONE_RULE } from '@kiko/dates';

// Every real UTC offset in use, standard or summer, so a zone outside the EU
// rule can still be picked as the offset its bank writes.
export const fixedOffsetZoneIds = [
  'UTC-12:00',
  'UTC-11:00',
  'UTC-10:00',
  'UTC-09:30',
  'UTC-09:00',
  'UTC-08:00',
  'UTC-07:00',
  'UTC-06:00',
  'UTC-05:00',
  'UTC-04:00',
  'UTC-03:30',
  'UTC-03:00',
  'UTC-02:00',
  'UTC-01:00',
  'UTC+00:00',
  'UTC+01:00',
  'UTC+02:00',
  'UTC+03:00',
  'UTC+03:30',
  'UTC+04:00',
  'UTC+04:30',
  'UTC+05:00',
  'UTC+05:30',
  'UTC+05:45',
  'UTC+06:00',
  'UTC+06:30',
  'UTC+07:00',
  'UTC+08:00',
  'UTC+08:45',
  'UTC+09:00',
  'UTC+09:30',
  'UTC+10:00',
  'UTC+10:30',
  'UTC+11:00',
  'UTC+12:00',
  'UTC+12:45',
  'UTC+13:00',
  'UTC+13:45',
  'UTC+14:00',
] as const;

export type FixedOffsetZoneId = (typeof fixedOffsetZoneIds)[number];

const europeanZoneRules = {
  kyiv: KYIV_ZONE_RULE,
  'western-europe': { standardOffsetMinutes: 0, europeanSummerTime: true },
  'central-europe': { standardOffsetMinutes: 60, europeanSummerTime: true },
  'eastern-europe': { standardOffsetMinutes: 120, europeanSummerTime: true },
} as const satisfies Record<string, ZoneRule>;

type EuropeanZoneId = keyof typeof europeanZoneRules;

export const sourceTimeZoneIds = [
  'kyiv',
  'western-europe',
  'central-europe',
  'eastern-europe',
  ...fixedOffsetZoneIds,
] as const satisfies readonly (EuropeanZoneId | FixedOffsetZoneId)[];

export type SourceTimeZoneId = (typeof sourceTimeZoneIds)[number];

const isEuropeanZoneId = (id: SourceTimeZoneId): id is EuropeanZoneId => id in europeanZoneRules;

/** The `+05:45` / `-03:30` part of a fixed-offset id. */
export const offsetTextOf = (id: FixedOffsetZoneId): string => id.slice(3);

const fixedOffsetMinutes = (id: FixedOffsetZoneId): number => {
  const sign = id[3] === '-' ? -1 : 1;

  return sign * (Number(id.slice(4, 6)) * 60 + Number(id.slice(7, 9)));
};

export const zoneRuleFor = (id: SourceTimeZoneId): ZoneRule =>
  isEuropeanZoneId(id)
    ? europeanZoneRules[id]
    : { standardOffsetMinutes: fixedOffsetMinutes(id), europeanSummerTime: false };

/** A saved mapping's stored zone; Kyiv when the field is missing or names a
 * zone this build does not know. */
export const sourceTimeZoneOrKyiv = (stored: string | undefined): SourceTimeZoneId =>
  sourceTimeZoneIds.find((id) => id === stored) ?? 'kyiv';
