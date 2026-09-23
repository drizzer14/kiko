import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';

import { styles } from './mapping-result.styles';
import type { MappingResultProps } from './mapping-result.props';

const ROW_ERROR_PREVIEW_COUNT = 20;

/**
 * The column-mapping screen's own "Result" block: the incomplete hint while
 * a required field is still unmapped, or the parsed transaction count/date
 * span plus the first `ROW_ERROR_PREVIEW_COUNT` row errors (then a count of
 * the rest) once the mapping is structurally complete — extracted out of the
 * screen so its own branching doesn't count against that component's
 * cognitive-complexity budget.
 */
const MappingResult: FC<MappingResultProps> = ({ stats, rowErrors }) => {
  const { t } = useTranslation();
  const visibleRowErrors = rowErrors.slice(0, ROW_ERROR_PREVIEW_COUNT);
  const overflowCount = rowErrors.length - visibleRowErrors.length;

  return (
    <Box gap={2} style={styles.resultBlock}>
      <Text variant="heading">{t('columnMapping.result')}</Text>

      {stats === undefined && (
        <Text variant="body" tone="textSecondary">
          {t('columnMapping.incomplete')}
        </Text>
      )}

      {stats !== undefined && (
        <>
          {/* `Text` (the design-system wrapper) does not forward `testID` —
              each data row's testID lives on a wrapping `Box` instead, the
              same convention `statement-import.screen.tsx` uses. */}
          <Box testID="column-mapping-transaction-count">
            <Text variant="body">{stats.transactionCount}</Text>
          </Box>
          <Box testID="column-mapping-date-span">
            <Text variant="body">{stats.dateSpan}</Text>
          </Box>

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
