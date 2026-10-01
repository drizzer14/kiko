const HOUR_MILLISECONDS = 3_600_000;

type DateArguments = [] | [value: number | string | Date] | number[];

// A `run` that returns a promise would finish after the real `Date` is back,
// so its awaited half would read the real zone; the type refuses one.
type Synchronous<Result> = Result extends PromiseLike<unknown> ? never : Result;

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
  }

  return FixedOffsetDate as unknown as DateConstructor;
};

/**
 * Runs `run` as if this device sat in a zone fixed at `offsetHours` from UTC
 * (no DST). `jest.config.js` pins Europe/Kyiv for the whole process, and a
 * `process.env.TZ` assignment inside a test never retargets `Date`, so a test
 * proving a result does not depend on the device zone swaps the global `Date`
 * itself. Only the multi-argument local-time constructor
 * (`new Date(year, month, ...)`) reads the fixed offset; an instant built
 * from milliseconds stays the same instant.
 *
 * Every other device-zone read still sees Kyiv: the local getters and
 * setters, `getTimezoneOffset`, a string `new Date("...")`, `Date.parse`,
 * `toLocale*`/`toString`, and `Intl`. Semgrep's
 * `kiko-no-device-zone-in-statement-import` bans those in statement-import
 * instead. A `Date` created inside `run` and kept past it stays a
 * `FixedOffsetDate`, and a real `Date` from outside is not `instanceof` the
 * swapped global inside `run`.
 */
export const withDeviceZoneOffset = <Result>(
  offsetHours: number,
  run: () => Synchronous<Result>,
): Synchronous<Result> => {
  const realDate = globalThis.Date;

  globalThis.Date = fixedOffsetDateConstructor(offsetHours);

  try {
    return run();
  } finally {
    globalThis.Date = realDate;
  }
};
