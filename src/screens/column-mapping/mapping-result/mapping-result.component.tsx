import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import FieldError from '../../../design-system/components/field-error';
import SummaryTable from '../../../design-system/components/summary-table';
import ExampleTransaction from '../../statement-import/example-transaction';

import { styles } from './mapping-result.styles';
import type { MappingResultProps } from './mapping-result.props';

const ROW_ERROR_PREVIEW_COUNT = 20;

/**
 * The column-mapping screen's own "Result" block: the incomplete hint while
 * a required field is still unmapped, or the SAME summary table item 3 shows
 * plus the shared `ExampleTransaction`,
 * then the first `ROW_ERROR_PREVIEW_COUNT` row errors (then a count of the
 * rest) once the mapping is structurally complete — extracted out of the
 * screen so its own branching doesn't count against that component's
 * cognitive-complexity budget. Renders its OWN `columnMapping.result`
 * heading in BOTH branches — `SummaryTable` gets no
 * `title` — so the heading sits at the exact same spot and spacing whether
 * the mapping is complete or not, instead of jumping when the last required
 * column gets mapped.
 */
const MappingResult: FC<MappingResultProps> = ({
  stats,
  rowErrors,
  holdingName,
  mappingIncomplete,
  noRowsResolvedError,
}) => {
  const { t } = useTranslation();
  const visibleRowErrors = rowErrors.slice(0, ROW_ERROR_PREVIEW_COUNT);
  const overflowCount = rowErrors.length - visibleRowErrors.length;
  // Zero transactions parsed even though `stats` resolved (the mapping is
  // structurally complete and `applyColumnMapping` succeeded) — every row
  // failed its OWN per-row check, so there is nothing meaningful to show in
  // the count/date-span summary below.
  const hasResolvedTransactions = stats !== undefined && stats.transactionCount > 0;

  return (
    <Box gap={3} style={styles.resultBlock}>
      <Text variant="heading">{t('columnMapping.result')}</Text>

      {mappingIncomplete && (
        <Text variant="body" tone="textSecondary">
          {t('columnMapping.incomplete')}
        </Text>
      )}

      {!hasResolvedTransactions && noRowsResolvedError !== undefined && (
        <FieldError message={noRowsResolvedError} testID="column-mapping-no-rows-error" />
      )}

      {stats !== undefined && (
        <>
          {hasResolvedTransactions && (
            <>
              {/* The deposit/bond value-breakdown table's own UI layout
                  (item 3), reused here via the shared `SummaryTable` — this
                  screen's own columns, never the deposit table's own
                  value/percent/tax ones. */}
              <SummaryTable
                rows={[
                  {
                    key: 'transactionCount',
                    label: t('statementImport.transactionCountLabel'),
                    value: <Text variant="body">{stats.transactionCount}</Text>,
                    testID: 'column-mapping-transaction-count',
                  },
                  {
                    key: 'dateSpan',
                    label: t('statementImport.dateSpanLabel'),
                    value: <Text variant="body">{stats.dateSpan}</Text>,
                    testID: 'column-mapping-date-span',
                  },
                ]}
              />

              {stats.firstTransaction && (
                <ExampleTransaction
                  transaction={stats.firstTransaction}
                  holdingName={holdingName}
                />
              )}
            </>
          )}

          {visibleRowErrors.length > 0 && (
            <Box gap={1} testID="column-mapping-row-errors">
              {visibleRowErrors.map((rowError) => (
                <Box
                  key={`${rowError.rowNumber}-${rowError.reason}`}
                  testID={`column-mapping-row-error-${rowError.rowNumber}-${rowError.reason}`}
                >
                  <Text variant="body" tone="negative">
                    {t(`columnMapping.rowError.${rowError.reason}`, {
                      row: rowError.rowNumber,
                      value: rowError.value,
                    })}
                  </Text>
                </Box>
              ))}

              {overflowCount > 0 && (
                <Text variant="body" tone="textSecondary">
                  {t('columnMapping.rowsSkipped', { count: overflowCount })}
                </Text>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default MappingResult;
