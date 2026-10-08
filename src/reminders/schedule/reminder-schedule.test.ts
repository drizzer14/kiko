import { isReminderSchedule } from './reminder-schedule';

const ANCHOR_DAY = { year: 2026, month: 9, day: 1 };

describe('isReminderSchedule', () => {
  it.each([
    { frequency: 'daily', minuteOfDay: 0 },
    { frequency: 'daily', minuteOfDay: 1439 },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: [1, 4] },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: [0, 6] },
    { frequency: 'monthly', minuteOfDay: 1140, dayOfMonth: 1 },
    { frequency: 'monthly', minuteOfDay: 1140, dayOfMonth: 31 },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 2, anchorDay: ANCHOR_DAY },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 365, anchorDay: ANCHOR_DAY },
    {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 9,
      anchorDay: { year: 2028, month: 2, day: 29 },
    },
  ])('accepts %j', (schedule) => {
    expect(isReminderSchedule(schedule)).toBe(true);
  });

  it.each([
    null,
    undefined,
    'daily',
    42,
    [],
    {},
    { frequency: 'yearly', minuteOfDay: 0 },
    { frequency: 'daily' },
    { frequency: 'daily', minuteOfDay: -1 },
    { frequency: 'daily', minuteOfDay: 1440 },
    { frequency: 'daily', minuteOfDay: 600.5 },
    { frequency: 'daily', minuteOfDay: '600' },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: [] },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: [7] },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: [1.5] },
    { frequency: 'weekly', minuteOfDay: 540, weekdays: '1,4' },
    { frequency: 'weekly', minuteOfDay: 540 },
    { frequency: 'monthly', minuteOfDay: 1140, dayOfMonth: 0 },
    { frequency: 'monthly', minuteOfDay: 1140, dayOfMonth: 32 },
    { frequency: 'monthly', minuteOfDay: 1140 },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 1, anchorDay: ANCHOR_DAY },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 366, anchorDay: ANCHOR_DAY },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 2.5, anchorDay: ANCHOR_DAY },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 9 },
    {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 9,
      anchorDay: { year: 2026, month: 13, day: 1 },
    },
    {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 9,
      anchorDay: { year: 2026, month: 9, day: 31 },
    },
    {
      frequency: 'interval',
      minuteOfDay: 480,
      everyDays: 9,
      anchorDay: { year: 2027, month: 2, day: 29 },
    },
    { frequency: 'interval', minuteOfDay: 480, everyDays: 9, anchorDay: '2026-09-01' },
  ])('rejects %j', (value) => {
    expect(isReminderSchedule(value)).toBe(false);
  });
});
