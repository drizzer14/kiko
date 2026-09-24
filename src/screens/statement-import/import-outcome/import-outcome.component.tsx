import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../../../design-system/components/text';

import type { ImportOutcomeProps } from './import-outcome.props';

/**
 * The `importStatement` action's own SUCCESS result block — the imported/
 * total count, and (Task 3 review, CRITICAL fix) an honest "N rows in a
 * different currency were skipped" line, naming WHICH currencies (F4 item 9)
 * whenever `result.skippedWrongCurrency` is non-zero. A caught failure is no
 * longer rendered here — see this component's own props doc comment.
 * Extracted out of `statement-import.screen.tsx` to keep that screen's own
 * cognitive complexity under the project's Biome cap, not because this block
 * is reused elsewhere.
 */
const ImportOutcome: FC<ImportOutcomeProps> = ({ result }) => {
  const { t } = useTranslation();

  return (
    <>
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

      {result && result.skippedWrongCurrencyCodes.length > 0 && (
        <Text variant="body" tone="textSecondary">
          {t('statementImport.skippedWrongCurrencyCodes', {
            currencies: result.skippedWrongCurrencyCodes.join(', '),
          })}
        </Text>
      )}
    </>
  );
};

export default ImportOutcome;
