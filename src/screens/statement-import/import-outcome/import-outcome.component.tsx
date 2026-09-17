import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../../../design-system/components/text';

import type { ImportOutcomeProps } from './import-outcome.props';

/**
 * The `importStatement` action's own result block — a caught error, the
 * imported/total count, and (Task 3 review, CRITICAL fix) an honest
 * "N rows in a different currency were skipped" line whenever
 * `result.skippedWrongCurrency` is non-zero. Extracted out of
 * `statement-import.screen.tsx` to keep that screen's own cognitive
 * complexity under the project's Biome cap, not because this block is reused
 * elsewhere.
 */
const ImportOutcome: FC<ImportOutcomeProps> = ({ error, result }) => {
  const { t } = useTranslation();

  return (
    <>
      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}

      {result && (
        <Text variant="body">
          {t('statementImport.importedCount', {
            imported: result.imported,
            total: result.total,
          })}
        </Text>
      )}

      {result && result.skippedWrongCurrency > 0 && (
        <Text variant="body" tone="textSecondary">
          {t('statementImport.skippedWrongCurrency', { count: result.skippedWrongCurrency })}
        </Text>
      )}
    </>
  );
};

export default ImportOutcome;
