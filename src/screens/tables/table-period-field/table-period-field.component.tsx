import type { FC } from 'react';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import SelectField from '@kiko/design-system/components/select-field';
import { type TablePeriod, tablePeriodKey } from '@kiko/statistics/table-period';

import type { TablePeriodFieldProps } from './table-period-field.props';

const labelOf = (period: TablePeriod, t: TFunction): string =>
  match(period)
    .with({ kind: 'last12' }, () => t('tables.period.last12'))
    .with({ kind: 'year' }, ({ year }) => String(year))
    .exhaustive();

// The period is a pick among long labels ("Last 12 months", a year), so it is a select that opens
// a sheet, not a row of chips.
const TablePeriodField: FC<TablePeriodFieldProps> = ({ period, options, onSelect, testID }) => {
  const { t } = useTranslation();
  const labels = Object.fromEntries(
    options.map((option) => [tablePeriodKey(option), labelOf(option, t)]),
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
      testID={testID}
    />
  );
};

export default TablePeriodField;
