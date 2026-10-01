const HOUR_MILLISECONDS = 3_600_000;

const MINUTES_PER_HOUR = 60;

type DateArguments = [] | [value: number | string | Date] | number[];

const fixedOffsetDateConstructor = (offsetHours: number): DateConstructor => {
  const RealDate = Date;
  const offsetMilliseconds = offsetHours * HOUR_MILLISECONDS;

  const instantOf = (dateArguments: DateArguments): number | string | Date => {
    if (dateArguments.length === 0) {
      return RealDate.now();
    }

    if (dateArguments.length === 1) {
      return dateArguments[0];
    }

    const [year, monthIndex, day = 1, hour = 0, minute = 0, second = 0, millisecond = 0] =
      dateArguments as number[];

    return (
      RealDate.UTC(year, monthIndex, day, hour, minute, second, millisecond) - offsetMilliseconds
    );
  };

  class FixedOffsetDate extends RealDate {
    constructor(...dateArguments: DateArguments) {
      super(instantOf(dateArguments));
    }

    private wallClock(): Date {
      return new RealDate(this.getTime() + offsetMilliseconds);
    }

    getFullYear(): number {
      return this.wallClock().getUTCFullYear();
    }

    getMonth(): number {
      return this.wallClock().getUTCMonth();
    }

    getDate(): number {
      return this.wallClock().getUTCDate();
    }

    getDay(): number {
      return this.wallClock().getUTCDay();
    }

    getHours(): number {
      return this.wallClock().getUTCHours();
    }

    getMinutes(): number {
      return this.wallClock().getUTCMinutes();
    }

    getSeconds(): number {
      return this.wallClock().getUTCSeconds();
    }

    getMilliseconds(): number {
      return this.wallClock().getUTCMilliseconds();
    }

    getTimezoneOffset(): number {
      return -offsetHours * MINUTES_PER_HOUR;
    }
  }

  return FixedOffsetDate as unknown as DateConstructor;
};

/**
 * Runs `run` as if this device sat in a zone fixed at `offsetHours` from UTC
 * (no DST). `jest.config.js` pins Europe/Kyiv for the whole process, and a
 * `process.env.TZ` assignment inside a test never retargets `Date`, so a test
 * proving a result does not depend on the device zone swaps the global `Date`
 * itself: its local-time constructor and local getters read the fixed offset,
 * while an instant built from milliseconds stays the same instant.
 */
export const withDeviceZoneOffset = <Result>(offsetHours: number, run: () => Result): Result => {
  const realDate = globalThis.Date;

  globalThis.Date = fixedOffsetDateConstructor(offsetHours);

  try {
    return run();
  } finally {
    globalThis.Date = realDate;
  }
};
