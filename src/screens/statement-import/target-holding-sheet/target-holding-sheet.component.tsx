import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import SelectableRow from '../../../design-system/components/selectable-row';

import { styles } from './target-holding-sheet.styles';
import type { TargetHoldingOption, TargetHoldingSheetProps } from './target-holding-sheet.props';

// One account's holdings, grouped for the unscoped (cross-account) list.
type HoldingGroup = { accountId: string; accountName: string; holdings: TargetHoldingOption[] };

// Groups `holdings` by `accountId`, preserving the FIRST-SEEN order of each
// account (not a re-sort) — the unscoped picker's own display order.
const groupByAccount = (holdings: TargetHoldingOption[]): HoldingGroup[] => {
  const groups: HoldingGroup[] = [];

  for (const holding of holdings) {
    const existing = groups.find((group) => group.accountId === holding.accountId);

    if (existing) {
      existing.holdings.push(holding);
    } else {
      groups.push({
        accountId: holding.accountId,
        accountName: holding.accountName,
        holdings: [holding],
      });
    }
  }

  return groups;
};

/**
 * The `BottomSheet` + `SelectableRow` holding picker (docs/plans/statement-
 * import.md section B), mirroring `AddBankProviderSheet`'s shape: a plain
 * `onSelect`/`onCreateNew` callback pair, no navigation of its own. Scoped to
 * one account's holdings when `accountId` is given (entry point 1); lists
 * every holding grouped by account name otherwise (entry point 2).
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
      testID={`target-holding-option-${holding.id}`}
    />
  );

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      header={<Text variant="heading">{t('statementImport.chooseHolding')}</Text>}
      testID="target-holding-sheet"
    >
      {accountId
        ? holdings.filter((holding) => holding.accountId === accountId).map(row)
        : groupByAccount(holdings).map((group) => (
            <Box key={group.accountId} gap={1}>
              <Box style={styles.groupHeader}>
                <Text variant="caption" tone="textSecondary">
                  {group.accountName}
                </Text>
              </Box>
              {group.holdings.map(row)}
            </Box>
          ))}

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
