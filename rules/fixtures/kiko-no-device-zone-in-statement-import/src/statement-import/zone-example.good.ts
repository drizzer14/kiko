// Semgrep fixture (NEGATIVE): reads wall-clock digits as Kyiv time, reads a
// stored instant's digits through the UTC getters, and renders through a
// display formatter. `kiko-no-device-zone-in-statement-import` MUST report
// nothing here.
import { formatDate, utcDigitsOf, kyivWallClockToUtcMilliseconds } from '@kiko/dates';

export const fixtureGoodKyivMilliseconds = (milliseconds: number): number | undefined =>
  kyivWallClockToUtcMilliseconds(utcDigitsOf(milliseconds));

export const fixtureGoodUtcHour = (milliseconds: number): number =>
  new Date(milliseconds).getUTCHours();

export const fixtureGoodLabel = (milliseconds: number): string => formatDate(milliseconds);
