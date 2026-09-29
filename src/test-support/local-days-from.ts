/**
 * `time` moved by `days` local calendar days, keeping its local time of day.
 *
 * WHY THIS EXISTS: a test fixture built as the real clock plus a fixed
 * `days * DAY_MS` lands on the wrong local day across a DST change (a 23- or
 * 25-hour day) or when the suite runs late at night, so the test fails only at
 * some hours. Stepping the calendar fields never does.
 */
export const localDaysFrom = (time: number, days: number): number => {
  const date = new Date(time);
  date.setDate(date.getDate() + days);

  return date.getTime();
};
