import { KYIV_ZONE_RULE } from '@kiko/dates';

import {
  zoneRuleFor,
  sourceTimeZoneIds,
  fixedOffsetZoneIds,
  sourceTimeZoneOrKyiv,
} from './source-time-zone';

describe('sourceTimeZoneIds', () => {
  it('starts with Kyiv, then the EU summer-time zones, then every fixed offset', () => {
    expect(sourceTimeZoneIds.slice(0, 4)).toEqual([
      'kyiv',
      'western-europe',
      'central-europe',
      'eastern-europe',
    ]);
    expect(sourceTimeZoneIds.slice(4)).toEqual(fixedOffsetZoneIds);
  });

  it('runs the fixed offsets from UTC-12:00 to UTC+14:00, with the real half-hour and 45-minute ones', () => {
    expect(fixedOffsetZoneIds.at(0)).toBe('UTC-12:00');
    expect(fixedOffsetZoneIds.at(-1)).toBe('UTC+14:00');
    expect(fixedOffsetZoneIds).toEqual(
      expect.arrayContaining(['UTC-09:30', 'UTC-03:30', 'UTC+05:30', 'UTC+05:45', 'UTC+12:45']),
    );
  });
});

describe('zoneRuleFor', () => {
  it('reads Kyiv with the Kyiv rule itself', () => {
    expect(zoneRuleFor('kyiv')).toBe(KYIV_ZONE_RULE);
  });

  it('gives the EU zones their standard offset with summer time', () => {
    expect(zoneRuleFor('western-europe')).toEqual({
      standardOffsetMinutes: 0,
      europeanSummerTime: true,
    });
    expect(zoneRuleFor('central-europe')).toEqual({
      standardOffsetMinutes: 60,
      europeanSummerTime: true,
    });
    expect(zoneRuleFor('eastern-europe')).toEqual({
      standardOffsetMinutes: 120,
      europeanSummerTime: true,
    });
  });

  it.each([
    ['UTC-12:00', -720],
    ['UTC-03:30', -210],
    ['UTC+00:00', 0],
    ['UTC+05:45', 345],
    ['UTC+14:00', 840],
  ] as const)('reads %s as a fixed %d-minute offset with no summer time', (id, minutes) => {
    expect(zoneRuleFor(id)).toEqual({ standardOffsetMinutes: minutes, europeanSummerTime: false });
  });
});

describe('sourceTimeZoneOrKyiv', () => {
  it('reads a saved mapping without a zone as Kyiv', () => {
    expect(sourceTimeZoneOrKyiv(undefined)).toBe('kyiv');
  });

  it('reads an unknown stored zone as Kyiv', () => {
    expect(sourceTimeZoneOrKyiv('mars-central')).toBe('kyiv');
  });

  it('keeps a known zone', () => {
    expect(sourceTimeZoneOrKyiv('UTC+05:30')).toBe('UTC+05:30');
  });
});
