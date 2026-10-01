import type { LocalDateTime } from '@kiko/reminders/native';

import type { ReminderSchedule } from './reminder-schedule';
import { calendarDaysBetween, occurrenceAfter, toInstant } from './occurrences';

const HOUR_MS = 60 * 60 * 1000;

// Instants are built through the local `Date` constructor so each fixture is a
// wall-clock time on the host's own calendar, the same way the code reads it.
const local = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): LocalDateTime => ({ year, month, day, hour, minute });

const consecutiveOccurrences = (
  schedule: ReminderSchedule,
  from: number,
  count: number,
): LocalDateTime[] => {
  const occurrences: LocalDateTime[] = [];
  let cursor = from;

  for (let position = 0; position < count; position += 1) {
    const occurrence = occurrenceAfter(schedule, cursor);

    occurrences.push(occurrence);
    cursor = toInstant(occurrence);
  }

  return occurrences;
};

const daily = (minuteOfDay: number): ReminderSchedule => ({ frequency: 'daily', minuteOfDay });

const EVERY_NINE_DAYS: ReminderSchedule = {
  frequency: 'interval',
  minuteOfDay: 8 * 60,
  everyDays: 9,
  anchorDay: { year: 2026, month: 9, day: 1 },
};

describe('toInstant', () => {
  it('reads the components as a local wall-clock time with a 1-12 month', () => {
    expect(toInstant(at(2026, 9, 28, 19, 5))).toBe(local(2026, 9, 28, 19, 5));
  });
});

describe('occurrenceAfter — daily', () => {
  const schedule = daily(20 * 60);

  it('fires later today when today’s time is still ahead', () => {
    expect(occurrenceAfter(schedule, local(2026, 9, 28, 10))).toEqual(at(2026, 9, 28, 20, 0));
  });

  it('fires tomorrow once today’s time has passed', () => {
    expect(occurrenceAfter(schedule, local(2026, 9, 28, 21))).toEqual(at(2026, 9, 29, 20, 0));
  });

  it('is strictly after: an instant exactly at the time moves to the next day', () => {
    expect(occurrenceAfter(schedule, local(2026, 9, 28, 20))).toEqual(at(2026, 9, 29, 20, 0));
  });

  it('rolls over the year end', () => {
    expect(occurrenceAfter(schedule, local(2026, 12, 31, 21))).toEqual(at(2027, 1, 1, 20, 0));
  });
});

describe('occurrenceAfter — weekly', () => {
  const mondayAndThursday: ReminderSchedule = {
    frequency: 'weekly',
    minuteOfDay: 9 * 60,
    weekdays: [1, 4],
  };

  it('from a Tuesday, fires on that week’s Thursday', () => {
    expect(occurrenceAfter(mondayAndThursday, local(2026, 9, 29, 12))).toEqual(
      at(2026, 10, 1, 9, 0),
    );
  });

  it('from a Thursday before the time, fires that Thursday', () => {
    expect(occurrenceAfter(mondayAndThursday, local(2026, 10, 1, 8))).toEqual(
      at(2026, 10, 1, 9, 0),
    );
  });

  it('from a Thursday after the time, fires on the next Monday', () => {
    expect(occurrenceAfter(mondayAndThursday, local(2026, 10, 1, 10))).toEqual(
      at(2026, 10, 5, 9, 0),
    );
  });

  it('with one weekday, fires a week later once that day’s time has passed', () => {
    const sundays: ReminderSchedule = { frequency: 'weekly', minuteOfDay: 9 * 60, weekdays: [0] };

    expect(occurrenceAfter(sundays, local(2026, 10, 4, 10))).toEqual(at(2026, 10, 11, 9, 0));
  });
});

describe('occurrenceAfter — monthly', () => {
  const onThe31st: ReminderSchedule = {
    frequency: 'monthly',
    minuteOfDay: 19 * 60,
    dayOfMonth: 31,
  };
  const onThe15th: ReminderSchedule = {
    frequency: 'monthly',
    minuteOfDay: 19 * 60,
    dayOfMonth: 15,
  };

  it('day 31 fires on the 30th of a 30-day month', () => {
    expect(occurrenceAfter(onThe31st, local(2026, 11, 1))).toEqual(at(2026, 11, 30, 19, 0));
  });

  it('day 31 fires on February 28th in a common year', () => {
    expect(occurrenceAfter(onThe31st, local(2027, 2, 1))).toEqual(at(2027, 2, 28, 19, 0));
  });

  it('day 31 fires on February 29th in a leap year', () => {
    expect(occurrenceAfter(onThe31st, local(2028, 2, 1))).toEqual(at(2028, 2, 29, 19, 0));
  });

  it('day 31 never skips a month: after October 31st it fires on November 30th', () => {
    expect(occurrenceAfter(onThe31st, local(2026, 10, 31, 20))).toEqual(at(2026, 11, 30, 19, 0));
  });

  it('day 31 fires on the 31st of a 31-day month, across the year end', () => {
    expect(occurrenceAfter(onThe31st, local(2026, 12, 31, 20))).toEqual(at(2027, 1, 31, 19, 0));
  });

  it('day 31 fires on every month’s last day, in order', () => {
    expect(consecutiveOccurrences(onThe31st, local(2027, 1, 1), 4)).toEqual([
      at(2027, 1, 31, 19, 0),
      at(2027, 2, 28, 19, 0),
      at(2027, 3, 31, 19, 0),
      at(2027, 4, 30, 19, 0),
    ]);
  });

  it('day 15 before the 15th fires this month', () => {
    expect(occurrenceAfter(onThe15th, local(2026, 9, 10))).toEqual(at(2026, 9, 15, 19, 0));
  });

  it('day 15 after the time on the 15th fires next month', () => {
    expect(occurrenceAfter(onThe15th, local(2026, 9, 15, 20))).toEqual(at(2026, 10, 15, 19, 0));
  });
});

describe('occurrenceAfter — every N days', () => {
  it('before the anchor, fires on the anchor day', () => {
    expect(occurrenceAfter(EVERY_NINE_DAYS, local(2026, 8, 1))).toEqual(at(2026, 9, 1, 8, 0));
  });

  it('at the anchor occurrence itself, fires one step later', () => {
    expect(occurrenceAfter(EVERY_NINE_DAYS, local(2026, 9, 1, 8))).toEqual(at(2026, 9, 10, 8, 0));
  });

  it('between steps, fires on the next calendar step', () => {
    expect(occurrenceAfter(EVERY_NINE_DAYS, local(2026, 9, 12))).toEqual(at(2026, 9, 19, 8, 0));
  });

  it('keeps the calendar step and the hour across the autumn fall-back', () => {
    expect(consecutiveOccurrences(EVERY_NINE_DAYS, local(2026, 9, 1), 9)).toEqual([
      at(2026, 9, 1, 8, 0),
      at(2026, 9, 10, 8, 0),
      at(2026, 9, 19, 8, 0),
      at(2026, 9, 28, 8, 0),
      at(2026, 10, 7, 8, 0),
      at(2026, 10, 16, 8, 0),
      at(2026, 10, 25, 8, 0),
      at(2026, 11, 3, 8, 0),
      at(2026, 11, 12, 8, 0),
    ]);
  });
});

describe('calendarDaysBetween', () => {
  it('counts 0 on the same local day', () => {
    expect(calendarDaysBetween(local(2026, 9, 28, 0, 5), at(2026, 9, 28, 23, 55))).toBe(0);
  });

  it('counts calendar days, not elapsed hours', () => {
    expect(calendarDaysBetween(local(2026, 9, 28, 23), at(2026, 9, 29, 1, 0))).toBe(1);
  });

  it('counts across a month end', () => {
    expect(calendarDaysBetween(local(2026, 9, 25, 12), at(2026, 10, 5, 12, 0))).toBe(10);
  });
});

// These cases cross real Kyiv transitions only because jest.config.js pins the
// suite to Europe/Kyiv; __tests__/jest-time-zone.test.ts fails if that pin breaks.
describe('DST transitions (Europe/Kyiv)', () => {
  it('spring-forward: a 03:30 that does not exist still fires on that day, as 03:30', () => {
    expect(occurrenceAfter(daily(3 * 60 + 30), local(2027, 3, 27, 12))).toEqual(
      at(2027, 3, 28, 3, 30),
    );
  });

  it('spring-forward: after the skipped hour, that day’s 03:30 is still ahead', () => {
    expect(occurrenceAfter(daily(3 * 60 + 30), local(2027, 3, 28, 4))).toEqual(
      at(2027, 3, 28, 3, 30),
    );
  });

  it('fall-back: a 03:30 that happens twice fires on that day, as 03:30', () => {
    expect(occurrenceAfter(daily(3 * 60 + 30), local(2026, 10, 24, 12))).toEqual(
      at(2026, 10, 25, 3, 30),
    );
  });

  it('fall-back: the repeated 03:30 does not fire a second time that day', () => {
    const firstPass = toInstant(at(2026, 10, 25, 3, 30));

    expect(occurrenceAfter(daily(3 * 60 + 30), firstPass)).toEqual(at(2026, 10, 26, 3, 30));
    expect(occurrenceAfter(daily(3 * 60 + 30), firstPass + HOUR_MS)).toEqual(
      at(2026, 10, 26, 3, 30),
    );
  });

  it.each([
    ['spring-forward', local(2027, 3, 26)],
    ['fall-back', local(2026, 10, 23)],
  ])(
    '%s: consecutive daily occurrences are one per calendar day, in increasing instants',
    (_name, from) => {
      const occurrences = consecutiveOccurrences(daily(3 * 60 + 30), from, 5);
      const instants = occurrences.map(toInstant);

      expect(occurrences.map((occurrence) => occurrence.hour * 60 + occurrence.minute)).toEqual([
        210, 210, 210, 210, 210,
      ]);
      expect(
        occurrences
          .slice(1)
          .map((occurrence, position) =>
            calendarDaysBetween(instants[position] as number, occurrence),
          ),
      ).toEqual([1, 1, 1, 1]);
      expect(
        instants.slice(1).every((instant, position) => instant > (instants[position] as number)),
      ).toBe(true);
    },
  );

  it('calendarDaysBetween counts whole days across the spring-forward', () => {
    expect(calendarDaysBetween(local(2027, 3, 27, 12), at(2027, 3, 29, 12, 0))).toBe(2);
    expect(calendarDaysBetween(local(2027, 3, 27, 23, 30), at(2027, 3, 28, 0, 30))).toBe(1);
  });

  it('calendarDaysBetween counts whole days across the fall-back', () => {
    expect(calendarDaysBetween(local(2026, 10, 24, 12), at(2026, 10, 26, 12, 0))).toBe(2);
    expect(calendarDaysBetween(local(2026, 10, 25, 0, 30), at(2026, 10, 25, 23, 30))).toBe(0);
  });
});
