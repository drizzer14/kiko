import type { CompoundingFrequency } from './holding-metadata';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;

export const periodsPerYear = (frequency: CompoundingFrequency): number => {
  switch (frequency) {
    case 'daily':
      return 365;
    case 'monthly':
      return 12;
    case 'quarterly':
      return 4;
    case 'annually':
      return 1;
  }
};

export const addMonths = (start: number, months: number): number => {
  const date = new Date(start);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
};

export const daysBetween = (start: number, end: number): number =>
  Math.max(0, Math.floor((end - start) / DAY_MS));

export const periodDays = (frequency: CompoundingFrequency): number =>
  DAYS_PER_YEAR / periodsPerYear(frequency);

export const compoundedMajor = (
  principalMajor: number,
  annualRatePct: number,
  frequency: CompoundingFrequency,
  daysElapsed: number,
): number => {
  const ppy = periodsPerYear(frequency);
  const completed = Math.floor(daysElapsed / periodDays(frequency));
  return principalMajor * (1 + annualRatePct / 100 / ppy) ** completed;
};

export const accruedMajor = (
  baseMajor: number,
  annualRatePct: number,
  daysElapsed: number,
): number => (baseMajor * (annualRatePct / 100) * daysElapsed) / DAYS_PER_YEAR;
