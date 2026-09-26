import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../text';
import BottomSheet from '../bottom-sheet';
import SelectableRow from '../selectable-row';

import type { TargetHoldingOption, TargetHoldingSheetProps } from './target-holding-sheet.props';

/**
 * The `BottomSheet` + `SelectableRow` holding picker (docs/plans/statement-
 * import.md section B), mirroring `AddBankProviderSheet`'s shape: a plain
 * `onSelect`/`onCreateNew` callback pair, no navigation of its own. Scoped to
 * `accountId`'s own holdings — the document-picker entry point always knows
 * its own account.
 */
const TargetHoldingSheet: FC<TargetHoldingSheetProps> = ({
  visible,
  onDismiss,
  holdings,
  accountId,
  onSelect,
  onCreateNew,
}) => {
  const { t } = useTranslation();

  const handleSelect = (holdingId: string): void => {
    onSelect(holdingId);
    onDismiss();
  };

  const handleCreateNew = (): void => {
    onCreateNew();
    onDismiss();
  };

  const row = (holding: TargetHoldingOption) => (
    <SelectableRow
      key={holding.id}
      selected={false}
      onPress={() => handleSelect(holding.id)}
      label={holding.name}
      icon={holding.icon}
      iconColor={holding.color}
      testID={`target-holding-option-${holding.id}`}
    />
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      header={<Text variant="heading">{t('statementImport.chooseHoldingSheetTitle')}</Text>}
      testID="target-holding-sheet"
    >
      {holdings.filter((holding) => holding.accountId === accountId).map(row)}

      <SelectableRow
        selected={false}
        onPress={handleCreateNew}
        label={t('statementImport.createNewHolding')}
        icon="plus"
        testID="target-holding-create-new"
      />
    </BottomSheet>
  );
};

export default TargetHoldingSheet;
