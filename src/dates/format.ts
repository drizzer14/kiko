// Explicit, locale-independent date formatting. The device locale would
// otherwise reorder fields (MM/DD vs DD/MM) or switch to 12-hour time, so every
// component is read off the Date and assembled by hand into a fixed layout.

const pad2 = (value: number): string => value.toString().padStart(2, '0');

const toDate = (input: number | Date): Date => {
  return input instanceof Date ? input : new Date(input);
};

// "DD.MM.YYYY" in the device's local timezone, every field zero-padded.
export const formatDate = (input: number | Date): string => {
  const date = toDate(input);

  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
};

// "HH:MM" in the device's local timezone, 24-hour time, both fields
// zero-padded (e.g. 09:05, 00:00, 23:59). The time-of-day component only —
// used to stamp a transaction row with when it happened.
export const formatTime = (input: number | Date): string => {
  const date = toDate(input);

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

// "DD.MM.YYYY HH:mm" in the device's local timezone, 24-hour time.
export const formatDateTime = (input: number | Date): string => {
  const date = toDate(input);

  return `${formatDate(date)} ${formatTime(date)}`;
};

// Parses a 'YYYY-MM-DD' calendar day into a LOCAL-midnight timestamp, matching
// DateField (new Date(y, m-1, d)) and the interest-boundary arithmetic. Plain
// Date.parse reads the string as UTC midnight, which lands on the previous or
// next local day in a non-UTC zone (e.g. +02:00/+03:00 Kyiv). Returns NaN for a
// malformed string or an out-of-range day so callers can reject invalid input.
export const parseLocalDate = (value: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    return Number.NaN;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  // Reject rollover (e.g. 2026-13-01 or 2026-02-30): the components must survive
  // the round-trip unchanged.
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) {
    return Number.NaN;
  }
  return date.getTime();
};
