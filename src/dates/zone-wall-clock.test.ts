import {
  type ZoneRule,
  zoneWallClockOf,
  zoneOffsetMinutes,
  zoneWallClockToUtcMilliseconds,
} from './zone-wall-clock';
import { KYIV_ZONE_RULE } from './kyiv-wall-clock';

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
});

const CENTRAL_EUROPE: ZoneRule = { standardOffsetMinutes: 60, europeanSummerTime: true };

const WESTERN_EUROPE: ZoneRule = { standardOffsetMinutes: 0, europeanSummerTime: true };

const INDIA: ZoneRule = { standardOffsetMinutes: 330, europeanSummerTime: false };

const NEWFOUNDLAND_STANDARD: ZoneRule = { standardOffsetMinutes: -210, europeanSummerTime: false };

describe('zoneOffsetMinutes', () => {
  it('reads Kyiv as +3 in summer and +2 in winter', () => {
    expect(zoneOffsetMinutes(KYIV_ZONE_RULE, parts(2026, 9, 15, 22, 30))).toBe(180);
    expect(zoneOffsetMinutes(KYIV_ZONE_RULE, parts(2026, 1, 15, 22, 30))).toBe(120);
  });

  it('never adds summer time to a fixed offset', () => {
    expect(zoneOffsetMinutes(INDIA, parts(2026, 7, 15, 12, 0))).toBe(330);
  });
});

describe('zoneWallClockToUtcMilliseconds', () => {
  it('reads Central Europe as +1 in winter and +2 in summer', () => {
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 1, 15, 10, 0))).toBe(
      Date.UTC(2026, 0, 15, 9, 0, 0),
    );
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 7, 15, 10, 0))).toBe(
      Date.UTC(2026, 6, 15, 8, 0, 0),
    );
  });

  it('switches Central Europe at the same 01:00 UTC instant as Kyiv', () => {
    // 29 March 2026 is the last Sunday of March: 02:00 CET jumps to 03:00 CEST.
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 3, 29, 1, 59, 59))).toBe(
      Date.UTC(2026, 2, 29, 0, 59, 59),
    );
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 3, 29, 3, 0, 0))).toBe(
      Date.UTC(2026, 2, 29, 1, 0, 0),
    );
    // 25 October 2026: 03:00 CEST falls back to 02:00 CET, so 02:30 happens
    // twice and reads as the earlier instant.
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 10, 25, 2, 30, 0))).toBe(
      Date.UTC(2026, 9, 25, 0, 30, 0),
    );
    expect(zoneWallClockToUtcMilliseconds(CENTRAL_EUROPE, parts(2026, 10, 25, 3, 0, 0))).toBe(
      Date.UTC(2026, 9, 25, 2, 0, 0),
    );
  });

  it('reads Western Europe as UTC in winter and +1 in summer', () => {
    expect(zoneWallClockToUtcMilliseconds(WESTERN_EUROPE, parts(2026, 1, 15, 10, 0))).toBe(
      Date.UTC(2026, 0, 15, 10, 0, 0),
    );
    expect(zoneWallClockToUtcMilliseconds(WESTERN_EUROPE, parts(2026, 7, 15, 10, 0))).toBe(
      Date.UTC(2026, 6, 15, 9, 0, 0),
    );
  });

  it('reads a fixed half-hour offset the same all year', () => {
    expect(zoneWallClockToUtcMilliseconds(INDIA, parts(2026, 1, 15, 10, 0))).toBe(
      Date.UTC(2026, 0, 15, 4, 30, 0),
    );
    expect(zoneWallClockToUtcMilliseconds(INDIA, parts(2026, 7, 15, 10, 0))).toBe(
      Date.UTC(2026, 6, 15, 4, 30, 0),
    );
  });

  it('reads a negative half-hour offset', () => {
    expect(zoneWallClockToUtcMilliseconds(NEWFOUNDLAND_STANDARD, parts(2026, 1, 15, 22, 0))).toBe(
      Date.UTC(2026, 0, 16, 1, 30, 0),
    );
  });

  it('rejects a wall clock that rolls over', () => {
    expect(zoneWallClockToUtcMilliseconds(INDIA, parts(2026, 2, 31, 10, 0))).toBeUndefined();
  });
});

describe('zoneWallClockOf', () => {
  it('reads an instant back as its Kyiv wall clock in summer and winter', () => {
    expect(zoneWallClockOf(KYIV_ZONE_RULE, Date.UTC(2026, 8, 15, 21, 0, 0))).toEqual(
      parts(2026, 9, 16, 0, 0, 0),
    );
    expect(zoneWallClockOf(KYIV_ZONE_RULE, Date.UTC(2026, 0, 15, 22, 0, 0))).toEqual(
      parts(2026, 1, 16, 0, 0, 0),
    );
  });

  it('reads both instants of the autumn repeated hour as 03:30 Kyiv', () => {
    expect(zoneWallClockOf(KYIV_ZONE_RULE, Date.UTC(2026, 9, 25, 0, 30, 0))).toEqual(
      parts(2026, 10, 25, 3, 30, 0),
    );
    expect(zoneWallClockOf(KYIV_ZONE_RULE, Date.UTC(2026, 9, 25, 1, 30, 0))).toEqual(
      parts(2026, 10, 25, 3, 30, 0),
    );
  });

  it('round-trips a wall clock through a fixed 45-minute offset', () => {
    const nepal: ZoneRule = { standardOffsetMinutes: 345, europeanSummerTime: false };
    const wallClock = parts(2026, 5, 1, 0, 0, 0);
    const milliseconds = zoneWallClockToUtcMilliseconds(nepal, wallClock) ?? Number.NaN;

    expect(zoneWallClockOf(nepal, milliseconds)).toEqual(wallClock);
  });
});
