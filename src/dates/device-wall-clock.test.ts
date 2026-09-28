import { deviceWallClockToLocalMilliseconds } from './device-wall-clock';

const parts = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => ({ year, month, day, hour, minute, second });

describe('deviceWallClockToLocalMilliseconds', () => {
  it('matches the local Date constructor for an ordinary wall clock', () => {
    const input = parts(2026, 9, 15, 22, 30, 0);

    expect(deviceWallClockToLocalMilliseconds(input)).toBe(
      new Date(2026, 8, 15, 22, 30, 0).getTime(),
    );
  });

  it('matches the local Date constructor for a date-only midnight wall clock', () => {
    const input = parts(2026, 1, 15, 0, 0, 0);

    expect(deviceWallClockToLocalMilliseconds(input)).toBe(
      new Date(2026, 0, 15, 0, 0, 0).getTime(),
    );
  });

  it('rejects a day that rolls over (February has no 31st)', () => {
    expect(deviceWallClockToLocalMilliseconds(parts(2026, 2, 31, 10, 0))).toBeUndefined();
  });

  it('rejects an out-of-range hour/minute that rolls over', () => {
    expect(deviceWallClockToLocalMilliseconds(parts(2026, 9, 15, 25, 61))).toBeUndefined();
  });

  // Whichever real instant this process's own zone maps a spring-forward gap
  // (a nonexistent wall clock) or an autumn repeated hour (an ambiguous one)
  // to is entirely the JS engine's own local-time constructor behavior (see
  // the header comment on `deviceWallClockToLocalMilliseconds`) — this
  // deliberately does not assert a specific offset, since the test process's
  // own zone is not controlled (`kiko-domain`'s "do not pin TZ" rule), only
  // that the helper agrees with a direct construction of the same digits and
  // with itself.
  it('is deterministic, and matches a direct construction of the same digits, for a wall clock that may fall in a DST gap or repeated hour', () => {
    const input = parts(2026, 3, 29, 3, 30, 0);
    const direct = new Date(2026, 2, 29, 3, 30, 0).getTime();

    expect(deviceWallClockToLocalMilliseconds(input)).toBe(direct);
    expect(deviceWallClockToLocalMilliseconds(input)).toBe(
      deviceWallClockToLocalMilliseconds(input),
    );
  });
});
