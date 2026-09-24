import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import ImportOutcome from '../import-outcome';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import BottomSheet from '../../../design-system/components/bottom-sheet';

import type { ImportResultSheetProps } from './import-result-sheet.props';

/**
 * Item 15 (F3 device feedback): a completed Import used to leave its result
 * text sitting passively at the bottom of the scroll — easy to miss. This
 * shows it as a themed `BottomSheet` MODAL instead (the same sheet
 * primitive `ConfirmSheet` is built on), reusing `ImportOutcome` verbatim
 * for the body so the text is identical to what the screen used to render
 * inline. One "Done" action (`common.done`) — there is nothing to cancel
 * post-success — dismisses the sheet; the caller's `onDone` navigates back
 * to the account screen. Shown ONLY on success (the caller never sets
 * `visible` true while `result` is undefined) — an import ERROR stays the
 * screen's existing inline `ImportOutcome` text so the user can retry
 * without a modal in the way. `visible` and `result` are DECOUPLED props
 * (N4, fix round 2): the caller closes this sheet (`visible={false}`)
 * before navigating away, while still passing the last `result` so the
 * body's content is correct for whatever the sheet's own closing animation
 * shows.
 *
 * `onClosed` (R2-1, fix round 3) is `BottomSheet`'s own pass-through of RN
 * `Modal`'s real `onDismiss` — fired once the close animation has actually
 * finished, unlike `onDone` (a mere close REQUEST: the Done button, or a
 * scrim tap). The caller navigates from `onClosed`, not from `onDone`, so a
 * native-stack pop never lands while this sheet is still visually closing —
 * no guessed delay needed.
 */
const ImportResultSheet: FC<ImportResultSheetProps> = ({ visible, result, onDone, onClosed }) => {
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDone}
      onClosed={onClosed}
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
