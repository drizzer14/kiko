// Semgrep fixture (NEGATIVE): reads wall-clock digits in a fixed zone, reads
// a stored instant's digits through the UTC getters, renders through a
// display formatter, and formats with an explicit zone.
// `kiko-no-device-zone-in-statement-import` MUST report nothing here.
import { formatDate, utcDigitsOf, kyivWallClockToUtcMilliseconds } from '@kiko/dates';

export const fixtureGoodKyivMilliseconds = (milliseconds: number): number | undefined =>
  kyivWallClockToUtcMilliseconds(utcDigitsOf(milliseconds));

export const fixtureGoodUtcHour = (milliseconds: number): number =>
  new Date(milliseconds).getUTCHours();

export const fixtureGoodLabel = (milliseconds: number): string => formatDate(milliseconds);

export const fixtureGoodNumberText = (amount: number): string => amount.toString();

export const fixtureGoodAmountLocaleString = (amount: number): string =>
  amount.toLocaleString('uk-UA');

export const fixtureGoodZonedLocaleString = (date: Date): string =>
  date.toLocaleString('uk-UA', { timeZone: 'UTC' });

export const fixtureGoodAmountStringCall = (amount: number): string => String(amount);

export const fixtureGoodAmountTemplate = (amount: number): string => `${amount} UAH`;

export const fixtureGoodAmountConcatenation = (amount: number): string => '' + amount;

export const fixtureGoodInstantCopy = (milliseconds: number): Date => new Date(milliseconds);

export const fixtureGoodZonedFormat = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('uk-UA', { timeZone: 'UTC' });
