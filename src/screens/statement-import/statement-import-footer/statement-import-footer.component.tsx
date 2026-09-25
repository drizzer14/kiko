import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';

import type { StatementImportFooterProps } from './statement-import-footer.props';

// The screen's shared footer slot content: Import and "Map columns manually"
// both live in `Screen`'s own `footer`, the same slot every other main-action
// button in the app uses. Import only shows once a recognized preview
// (`hasStats`) exists; Map-columns-manually shows anywhere `input` resolved
// at all. Renders `null` when NEITHER applies, so the caller passes
// `undefined` to `Screen` instead of an empty footer.
const StatementImportFooter: FC<StatementImportFooterProps> = ({
  hasStats,
  hasInput,
  importing,
  onImport,
  onMapColumnsManually,
}) => {
  const { t } = useTranslation();

  if (!hasStats && !hasInput) {
    return null;
  }

  return (
    <Box gap={2}>
      {hasStats && (
        <Button variant="primary" onPress={onImport} disabled={importing}>
          {t('statementImport.importButton')}
        </Button>
      )}

      {hasInput && (
        <Button variant="secondaryTonal" onPress={onMapColumnsManually}>
          {t('statementImport.mapColumnsManually')}
        </Button>
      )}
    </Box>
  );
};

export default StatementImportFooter;
