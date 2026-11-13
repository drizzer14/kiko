import type { FC } from 'react';
import { match } from 'ts-pattern';
import {
  relativeTablePeriodsOf,
  type TablePeriod,
  tablePeriodKey,
} from '@kiko/statistics/table-period';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import SelectField from '@kiko/design-system/components/select-field';

import type { TablePeriodFieldProps } from './table-period-field.props';

// The quarters and the year that `now` is in, or just before, read by their place in time ("This
// quarter", "Last year"); every other quarter reads by its number and year.
const labelOf = (period: TablePeriod, now: number, t: TFunction): string => {
  const { thisQuarter, lastQuarter, thisYear, lastYear } = relativeTablePeriodsOf(now);
  const key = tablePeriodKey(period);

  return match(period)
    .with({ kind: 'quarter' }, ({ quarter, year }) =>
      match(key)
        .with(tablePeriodKey(thisQuarter), () => t('tables.period.thisQuarter'))
        .with(tablePeriodKey(lastQuarter), () => t('tables.period.lastQuarter'))
        .otherwise(() => t('tables.period.quarter', { quarter, year })),
    )
    .with({ kind: 'half', half: 1 }, () => t('tables.period.firstHalf'))
    .with({ kind: 'half', half: 2 }, () => t('tables.period.secondHalf'))
    .with({ kind: 'year' }, ({ year }) =>
      match(key)
        .with(tablePeriodKey(thisYear), () => t('tables.period.thisYear'))
        .with(tablePeriodKey(lastYear), () => t('tables.period.lastYear'))
        .otherwise(() => String(year)),
    )
    .exhaustive();
};

// The period is a pick among several named spans, so it is a select that opens a sheet, not a row
// of chips. It draws as a filter pill ("Period: This year"), so it sits with the other filters.
const TablePeriodField: FC<TablePeriodFieldProps> = ({
  period,
  options,
  now,
  onSelect,
  testID,
}) => {
  const { t } = useTranslation();
  const labels = Object.fromEntries(
    options.map((option) => [tablePeriodKey(option), labelOf(option, now, t)]),
  );

  return (
    <SelectField
      label={t('tables.period.label')}
      sheetTitle={t('tables.period.sheetTitle')}
      options={options.map(tablePeriodKey)}
      selected={tablePeriodKey(period)}
      onSelect={(key) =>
        foldMap(maybe(options.find((option) => tablePeriodKey(option) === key)), onSelect)
      }
      labels={labels}
      placeholder={t('tables.period.label')}
      appearance="pill"
      capped
      testID={testID}
    />
  );
};

export default TablePeriodField;
