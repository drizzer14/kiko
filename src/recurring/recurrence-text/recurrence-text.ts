import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { formatDate, formatDayMonth } from '@kiko/dates';
import type { Recurrence, RecurringPeriod, RecurringSeries } from '@kiko/recurring/detection';

// Indexed as `Date.prototype.getDay` numbers a weekday, Sunday first.
const WEEKDAY_KEYS = [
  'recurringCharges.weeklyOn.sunday',
  'recurringCharges.weeklyOn.monday',
  'recurringCharges.weeklyOn.tuesday',
  'recurringCharges.weeklyOn.wednesday',
  'recurringCharges.weeklyOn.thursday',
  'recurringCharges.weeklyOn.friday',
  'recurringCharges.weeklyOn.saturday',
] as const;

const periodLine = (period: RecurringPeriod, t: TFunction): string =>
  match(period)
    .with('weekly', () => t('recurringCharges.weekly'))
    .with('monthly', () => t('recurringCharges.monthly'))
    .with('yearly', () => t('recurringCharges.yearly'))
    .exhaustive();

export const recurrenceLine = (
  period: RecurringPeriod,
  recurrence: Recurrence,
  t: TFunction,
): string =>
  match(recurrence)
    .with({ kind: 'onDay' }, ({ day }) => t('recurringCharges.monthlyOnDay', { day }))
    .with({ kind: 'aroundDay' }, ({ day }) => t('recurringCharges.monthlyAroundDay', { day }))
    .with({ kind: 'lastDay' }, () => t('recurringCharges.monthlyLastDay'))
    .with({ kind: 'onWeekday' }, ({ weekday }) => t(WEEKDAY_KEYS[weekday]))
    .with({ kind: 'onDate' }, ({ time }) =>
      t('recurringCharges.yearlyOn', { date: formatDayMonth(time) }),
    )
    .with({ kind: 'none' }, () => periodLine(period, t))
    .exhaustive();

export const lastChargeLine = (series: RecurringSeries, t: TFunction): string => {
  if (series.quiet !== null) {
    return t('recurringCharges.holdingQuietSince', {
      holding: series.quiet.holdingName,
      date: formatDate(series.quiet.since),
    });
  }

  const date = formatDate(series.lastChargeTime);

  return series.isStopped
    ? t('recurringCharges.noChargeSince', { date })
    : t('recurringCharges.lastCharge', { date });
};
