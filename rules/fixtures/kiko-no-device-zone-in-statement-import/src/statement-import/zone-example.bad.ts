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

export const fixtureBadLocalDate = (text: string): number =>
  // EXPECT-FINDING
  parseLocalDate(text);

export const fixtureBadDayStart = (milliseconds: number): number =>
  // EXPECT-FINDING
  startOfLocalDay(milliseconds);

export const fixtureBadDayEnd = (milliseconds: number): number =>
  // EXPECT-FINDING
  endOfLocalDay(milliseconds);
