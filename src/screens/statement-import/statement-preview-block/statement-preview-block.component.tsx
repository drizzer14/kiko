import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import SummaryTable from '@kiko/design-system/components/summary-table';

import PreviewDetailList from '../preview-detail-list';
import ExampleTransaction from '../example-transaction';
import TargetHoldingField from '../target-holding-field';

import { styles } from './statement-preview-block.styles';
import type { StatementPreviewBlockProps } from './statement-preview-block.props';

// The recognized-preview block: the shared `SummaryTable` (the deposit/bond
// value-breakdown table's own layout, never its columns), the shared
// `ExampleTransaction`, the optional masked-card/unresolved-row/multi-currency
// details, and the holding SELECT field — its own component (the same reason
// `StatementImportFooter` is one) so this branching doesn't count against the
// screen's own cognitive-complexity budget.
const StatementPreviewBlock: FC<StatementPreviewBlockProps> = ({
  stats,
  holdingOptions,
  accountId,
  selectedHoldingId,
  onSelectHolding,
  onCreateNewHolding,
  targetHoldingError,
  targetHoldingFieldRef,
}) => {
  const { t } = useTranslation();
  const selectedHoldingName = holdingOptions.find(
    (holding) => holding.id === selectedHoldingId,
  )?.name;

  return (
    <Box gap={3} style={styles.previewBlock}>
      {/* The same plain-first-child-of-gap={3} heading pattern
          `column-mapping-form.component.tsx`'s sections use — `SummaryTable`
          gets no `title` here either, so this screen's preview heading sits at
          the SAME 12pt spacing every column-mapping section heading does, not
          `SummaryTable`'s own `gap={1}` (4pt) internal spacing. */}
      <Text variant="heading">{stats.displayName}</Text>

      <SummaryTable
        rows={[
          {
            key: 'transactionCount',
            label: t('statementImport.transactionCountLabel'),
            value: <Text variant="body">{stats.transactionCount}</Text>,
            testID: 'statement-import-transaction-count',
          },
          {
            key: 'currency',
            label: t('statementImport.currencyLabel'),
            value: <Text variant="body">{stats.currency}</Text>,
            testID: 'statement-import-currency',
          },
          {
            key: 'dateSpan',
            label: t('statementImport.dateSpanLabel'),
            value: <Text variant="body">{stats.dateSpan}</Text>,
            testID: 'statement-import-date-span',
          },
        ]}
      />

      {stats.firstTransaction && (
        <ExampleTransaction
          transaction={stats.firstTransaction}
          holdingName={selectedHoldingName}
        />
      )}

      {stats.maskedCardHints.length > 0 && (
        <PreviewDetailList items={stats.maskedCardHints} testID="statement-import-masked-cards" />
      )}

      {stats.unresolvedRowCount > 0 && (
        <Text variant="body" tone="textSecondary">
          {t('statementImport.unresolvedRowsSkipped', { count: stats.unresolvedRowCount })}
        </Text>
      )}

      {stats.detectedCurrencies.length > 1 && (
        <PreviewDetailList
          items={stats.detectedCurrencies}
          label={t('statementImport.detectedCurrenciesLabel')}
          testID="statement-import-detected-currencies"
        />
      )}

      <View ref={targetHoldingFieldRef}>
        <TargetHoldingField
          label={t('statementImport.chooseHolding')}
          required
          holdings={holdingOptions}
          accountId={accountId}
          selectedId={selectedHoldingId}
          onSelect={onSelectHolding}
          onCreateNew={onCreateNewHolding}
          placeholder={t('statementImport.chooseHoldingPlaceholder')}
          error={targetHoldingError}
          testID="target-holding-field"
        />
      </View>
    </Box>
  );
};

export default StatementPreviewBlock;
