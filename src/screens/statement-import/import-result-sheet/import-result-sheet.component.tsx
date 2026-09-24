import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import BottomSheet from '../../../design-system/components/bottom-sheet';

import ImportOutcome from '../import-outcome';
import type { ImportResultSheetProps } from './import-result-sheet.props';

/**
 * Item 15 (F3 device feedback): a completed Import used to leave its result
 * text sitting passively at the bottom of the scroll — easy to miss. This
 * shows it as a themed `BottomSheet` MODAL instead (the same sheet
 * primitive `ConfirmSheet` is built on), reusing `ImportOutcome` verbatim
 * for the body so the text is identical to what the screen used to render
 * inline. One "Done" action (`common.done`) — there is nothing to cancel
 * post-success — dismisses the sheet; the caller's `onDone` navigates back
 * to the account screen. Shown ONLY on success: the caller passes
 * `visible={false}` (or simply never sets it) on an import ERROR, which
 * stays the screen's existing inline `ImportOutcome` text so the user can
 * retry without a modal in the way.
 */
const ImportResultSheet: FC<ImportResultSheetProps> = ({ visible, result, onDone }) => {
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDone}
      gap={3}
      header={<Text variant="heading">{t('statementImport.importResultTitle')}</Text>}
      testID="import-result-sheet"
      backdropTestID="import-result-sheet-backdrop"
    >
      <ImportOutcome result={result} />

      <Button onPress={onDone}>{t('common.done')}</Button>
    </BottomSheet>
  );
};

export default ImportResultSheet;
