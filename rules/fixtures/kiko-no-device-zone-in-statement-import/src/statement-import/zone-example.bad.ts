// Semgrep fixture (POSITIVE): every way a statement-import read can pick up
// the device's own zone. `kiko-no-device-zone-in-statement-import` MUST report
// a finding on each pinned line below. Never "fix" this file.
import { endOfLocalDay, parseLocalDate, startOfLocalDay } from '@kiko/dates';

export const fixtureBadLocalHour = (milliseconds: number): number =>
  // EXPECT-FINDING
  new Date(milliseconds).getHours();

export const fixtureBadLocalSetter = (date: Date): number =>
  // EXPECT-FINDING
  date.setHours(12, 0, 0, 0);

export const fixtureBadZoneOffset = (date: Date): number =>
  // EXPECT-FINDING
  date.getTimezoneOffset();

export const fixtureBadParse = (text: string): number =>
  // EXPECT-FINDING
  Date.parse(text);

export const fixtureBadStringDate = (): Date =>
  // EXPECT-FINDING
  new Date('2026-09-15T14:30:00');

export const fixtureBadTemplateDate = (day: string): Date =>
  // EXPECT-FINDING
  new Date(`2026-09-${day}T14:30:00`);

export const fixtureBadStringVariableDate = (text: string): Date =>
  // EXPECT-FINDING
  new Date(text);

export const fixtureBadLocaleString = (date: Date): string =>
  // EXPECT-FINDING
  date.toLocaleString('uk-UA');

export const fixtureBadLocaleDateString = (date: Date): string =>
  // EXPECT-FINDING
  date.toLocaleDateString();

export const fixtureBadLocaleTimeString = (date: Date): string =>
  // EXPECT-FINDING
  date.toLocaleTimeString();

export const fixtureBadToString = (date: Date): string =>
  // EXPECT-FINDING
  date.toString();

export const fixtureBadNewDateToString = (milliseconds: number): string =>
  // EXPECT-FINDING
  new Date(milliseconds).toString();

export const fixtureBadDateString = (date: Date): string =>
  // EXPECT-FINDING
  date.toDateString();

export const fixtureBadTimeString = (date: Date): string =>
  // EXPECT-FINDING
  date.toTimeString();

export const fixtureBadDateTimeFormat = (): Intl.DateTimeFormat =>
  // EXPECT-FINDING
  new Intl.DateTimeFormat('uk-UA', { hour: '2-digit' });

export const fixtureBadLocalDate = (text: string): number =>
  // EXPECT-FINDING
  parseLocalDate(text);

export const fixtureBadDayStart = (milliseconds: number): number =>
  // EXPECT-FINDING
  startOfLocalDay(milliseconds);

export const fixtureBadDayEnd = (milliseconds: number): number =>
  // EXPECT-FINDING
  endOfLocalDay(milliseconds);
