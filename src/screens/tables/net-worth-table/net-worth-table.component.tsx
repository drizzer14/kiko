import { type FC, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import DataTable, {
  type DataTableColumn,
  type DataTableRow,
} from '@kiko/design-system/components/data-table';
import Box from '@kiko/design-system/components/box';
import { activeLocale } from '@kiko/i18n/active-locale';
import EmptyState from '@kiko/design-system/components/empty-state';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import LoadingState from '@kiko/design-system/components/loading-state';
import { transactionsByHolding } from '@kiko/statistics/net-worth-series';
import { buildNetWorthByAccount } from '@kiko/statistics/net-worth-by-account';

import { monthTitle } from '../month-column-label';
import { cellOf, monthColumnsOf, openingColumnIndexOf, type Spoken } from '../table-cells';

import { styles } from './net-worth-table.styles';
import type { NetWorthTableProps } from './net-worth-table.props';

type Amounts = {
  key: string;
  label: string;
  isSummary?: boolean;
  /** One per month, in the base currency's minor units. */
  cells: number[];
  change: number;
};

const rowOf = (
  amounts: Amounts,
  months: NetWorthTableProps['months'],
  spoken: Spoken,
): DataTableRow => ({
  key: amounts.key,
  label: amounts.label,
  isSummary: amounts.isSummary,
  cells: [
    ...amounts.cells.map((amount, index) =>
      cellOf(amount, `${amounts.label}, ${monthTitle(months[index], spoken.t)}`, spoken),
    ),
    cellOf(amounts.change, `${amounts.label}, ${spoken.t('tables.netWorth.change')}`, spoken),
  ],
});

const NetWorthTable: FC<NetWorthTableProps> = ({
  accounts,
  holdings,
  transactions,
  historyRows,
  months,
  now,
  rateTable,
  priceBook,
  baseCurrency,
  backfillState,
  topContent,
  barInset,
  barMinimization,
}) => {
  const { t } = useTranslation();
  const locale = activeLocale();
  const currentIsPartial = (months.at(-1)?.end ?? 0) >= now;
  const byHolding = useMemo(() => transactionsByHolding(transactions), [transactions]);
  const netWorth = useMemo(
    () =>
      buildNetWorthByAccount({
        accounts,
        holdings,
        transactionsByHolding: byHolding,
        historyRows,
        baseCurrency,
        months,
        liveRateTable: rateTable,
        now,
        book: priceBook,
      }),
    [accounts, holdings, byHolding, historyRows, baseCurrency, months, rateTable, now, priceBook],
  );

  const columns = useMemo<DataTableColumn[]>(
    () => [
      ...monthColumnsOf(months, t),
      { key: 'change', header: t('tables.netWorth.change'), isSum: true },
    ],
    [months, t],
  );

  const rows = useMemo<DataTableRow[]>(() => {
    const spoken = { baseCurrency, locale, t };
    const labelById = new Map(
      accounts.map((account) => [account.id, accountDisplayName(account, t)]),
    );

    return [
      ...netWorth.rows.map((row) =>
        rowOf(
          {
            key: `account-${row.accountId}`,
            label: labelById.get(row.accountId) ?? row.accountId,
            cells: row.cells,
            change: row.change,
          },
          months,
          spoken,
        ),
      ),
      rowOf(
        {
          key: 'all',
          label: t('tables.all'),
          isSummary: true,
          cells: netWorth.allCells,
          change: netWorth.allChange,
        },
        months,
        spoken,
      ),
    ];
  }, [netWorth, accounts, months, baseCurrency, locale, t]);

  const caption = t('tables.netWorth.caption', { currency: baseCurrency });
  // A table with no value yet waits on the shared run, as the line does; one with values shows
  // them while the run goes on. Both states go through the table, so the controls above stay one
  // mounted tree: a filter sheet open in them survives a pick that empties the table.
  const emptyContent =
    netWorth.rows.length === 0 ? (
      <Box style={styles.empty}>
        {backfillState === 'loading' ? (
          <LoadingState testID="tables-net-worth-loading" />
        ) : (
          <EmptyState
            icon="tablecells"
            title={t('tables.netWorth.empty.title')}
            message={t('tables.netWorth.empty.message')}
            testID="net-worth-table-empty"
          />
        )}
      </Box>
    ) : undefined;

  return (
    <DataTable
      columns={columns}
      rows={rows}
      caption={currentIsPartial ? `${caption} ${t('tables.netWorth.partialMonth')}` : caption}
      topContent={topContent}
      emptyContent={emptyContent}
      initialColumnIndex={openingColumnIndexOf(months)}
      barInset={barInset}
      barMinimization={barMinimization}
      testID="net-worth-table"
    />
  );
};

export default NetWorthTable;
