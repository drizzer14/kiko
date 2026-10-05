/**
 * Local midnight of the calendar day `time` falls on.
 *
 * Three near-identical copies of this used to live in `dates/default-range.ts`,
 * `statistics.screen.tsx` and `home.screen.tsx` — which is how the DST bug in
 * `endOfLocalDay` below came to be duplicated across two screens.
 */
export const startOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/**
 * The last millisecond of the calendar day `time` falls on.
 *
 * Computed as the start of the NEXT local calendar day minus 1 ms, never as
 * `startOfLocalDay(time) + 86_400_000 - 1`. A local day is not always 24
 * hours: on Europe/Kyiv's fall-back Sunday it is 25, so the fixed offset cut
 * the last hour off the range and silently dropped every 23:00–24:00
 * transaction from the charts and the Home filter; on spring-forward (a
 * 23-hour day) it spilled an hour into the next day. `new Date(y, m, d + 1)`
 * normalizes a day past the month's end, so no month/year wrap is needed.
 */
export const endOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;
};
