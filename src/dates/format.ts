// Explicit, locale-independent date formatting. The device locale would
// otherwise reorder fields (MM/DD vs DD/MM) or switch to 12-hour time, so every
// component is read off the Date and assembled by hand into a fixed layout.

const pad2 = (value: number): string => value.toString().padStart(2, '0');

const toDate = (input: number | Date): Date => (input instanceof Date ? input : new Date(input));

// "DD.MM.YYYY" in the device's local timezone, every field zero-padded.
export const formatDate = (input: number | Date): string => {
  const date = toDate(input);

  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
};

// "DD.MM.YYYY HH:mm" in the device's local timezone, 24-hour time.
export const formatDateTime = (input: number | Date): string => {
  const date = toDate(input);

  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};
