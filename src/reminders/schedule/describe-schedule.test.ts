import { i18n } from '@kiko/i18n/init';

import { describeSchedule } from './describe-schedule';

const english = i18n.getFixedT('en');
const ukrainian = i18n.getFixedT('uk');

const MONDAY_FIRST = 1;
const SUNDAY_FIRST = 0;

const ANCHOR_DAY = { year: 2026, month: 9, day: 1 };

describe('describeSchedule', () => {
  it('describes a daily reminder with a zero-padded 24-hour time', () => {
    const schedule = { frequency: 'daily', minuteOfDay: 9 * 60 + 5 } as const;

    expect(describeSchedule(schedule, english, MONDAY_FIRST)).toBe('Every day at 09:05');
    expect(describeSchedule(schedule, ukrainian, MONDAY_FIRST)).toBe('Щодня о 09:05');
  });

  it('reads midnight and the last minute of the day', () => {
    const daily = (minuteOfDay: number) => ({ frequency: 'daily', minuteOfDay }) as const;

    expect(describeSchedule(daily(0), english, MONDAY_FIRST)).toBe('Every day at 00:00');
    expect(describeSchedule(daily(1439), english, MONDAY_FIRST)).toBe('Every day at 23:59');
  });

  it('lists the weekdays Monday first when the week starts on Monday', () => {
    const schedule = { frequency: 'weekly', minuteOfDay: 20 * 60, weekdays: [0, 1, 5] } as const;

    expect(describeSchedule(schedule, english, MONDAY_FIRST)).toBe('Mon, Fri, Sun at 20:00');
    expect(describeSchedule(schedule, ukrainian, MONDAY_FIRST)).toBe('Пн, Пт, Нд о 20:00');
  });

  it('lists the weekdays Sunday first when the week starts on Sunday', () => {
    const schedule = { frequency: 'weekly', minuteOfDay: 20 * 60, weekdays: [5, 1, 0] } as const;

    expect(describeSchedule(schedule, english, SUNDAY_FIRST)).toBe('Sun, Mon, Fri at 20:00');
    expect(describeSchedule(schedule, ukrainian, SUNDAY_FIRST)).toBe('Нд, Пн, Пт о 20:00');
  });

  it('describes a monthly reminder by its day of the month', () => {
    const schedule = { frequency: 'monthly', minuteOfDay: 19 * 60, dayOfMonth: 31 } as const;

    expect(describeSchedule(schedule, english, MONDAY_FIRST)).toBe(
      'Day 31 of every month at 19:00',
    );
    expect(describeSchedule(schedule, ukrainian, MONDAY_FIRST)).toBe(
      '31-го числа щомісяця о 19:00',
    );
  });

  it('describes an interval with the plural form of its length', () => {
    const interval = (everyDays: number) =>
      ({ frequency: 'interval', minuteOfDay: 8 * 60, everyDays, anchorDay: ANCHOR_DAY }) as const;

    expect(describeSchedule(interval(2), english, MONDAY_FIRST)).toBe('Every 2 days at 08:00');
    expect(describeSchedule(interval(21), english, MONDAY_FIRST)).toBe('Every 21 days at 08:00');
    expect(describeSchedule(interval(21), ukrainian, MONDAY_FIRST)).toBe('Кожен 21 день о 08:00');
    expect(describeSchedule(interval(3), ukrainian, MONDAY_FIRST)).toBe('Кожні 3 дні о 08:00');
    expect(describeSchedule(interval(7), ukrainian, MONDAY_FIRST)).toBe('Кожні 7 днів о 08:00');
  });
});
