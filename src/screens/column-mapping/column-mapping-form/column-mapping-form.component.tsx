import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import RawPreview from '../raw-preview';
import AmountFields from '../amount-fields';
import MappingResult from '../mapping-result';
import CurrencyFields from '../currency-fields';
import ColumnSelectField from '../column-select-field';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Divider from '../../../design-system/components/divider';
import ChipRow from '../../../design-system/components/chip-row';
import TargetHoldingField from '../../statement-import/target-holding-field';
import type { TableDelimiter } from '../../../statement-import/column-mapping';

import { styles } from './column-mapping-form.styles';
import type { Encoding, ColumnMappingFormProps } from './column-mapping-form.props';

// Literal technical labels, not translated — the same treatment the
// delimiter pills give a bare "," / ";" (only "Tab", which has no visible
// symbol, gets a translated label).
const encodingLabel = (encoding: Encoding): string =>
  encoding === 'utf-8' ? 'UTF-8' : 'Windows-1251';

const delimiterLabel = (translate: TFunction, delimiter: TableDelimiter): string =>
  delimiter === '\t' ? translate('columnMapping.delimiterTab') : delimiter;

// Every prop the `ready`-state form needs — its own component so this large,
// mostly-static form tree doesn't count against the screen's own
// cognitive-complexity budget. Groups sections with the shared `Divider`:
// encoding/separators, dates, amounts/currency, description/counterparty
// (moved to the bottom), then the result.
const ColumnMappingForm: FC<ColumnMappingFormProps> = ({
  isXlsx,
  savedApplied,
  rows,
  headerRowIndex,
  onSelectHeaderRow,
  encoding,
  onEncodingChange,
  effectiveDelimiter,
  onDelimiterChange,
  decimalSeparator,
  onDecimalSeparatorChange,
  columnOptions,
  dateColumn,
  onDateColumnChange,
  dateFormatOptions,
  dateFormat,
  onDateFormatChange,
  amountMode,
  onAmountModeChange,
  amountColumn,
  onAmountColumnChange,
  debitColumn,
  onDebitColumnChange,
  creditColumn,
  onCreditColumnChange,
  currencyMode,
  onCurrencyModeChange,
  currencyColumn,
  onCurrencyColumnChange,
  fixedCurrency,
  onFixedCurrencyChange,
  descriptionColumn,
  onDescriptionColumnChange,
  counterpartyColumn,
  onCounterpartyColumnChange,
  balanceColumn,
  onBalanceColumnChange,
  stats,
  rowErrors,
  mappingIncomplete,
  holdingOptions,
  accountId,
  selectedHoldingId,
  onSelectHolding,
  onCreateNewHolding,
  validation,
  fieldRefs,
}) => {
  const { t } = useTranslation();
  const encodingLabels: Partial<Record<Encoding, string>> = {
    'utf-8': encodingLabel('utf-8'),
    'windows-1251': encodingLabel('windows-1251'),
  };
  const delimiterLabels: Partial<Record<TableDelimiter, string>> = {
    ',': ',',
    ';': ';',
    '\t': delimiterLabel(t, '\t'),
  };

  return (
    <Box gap={3}>
      {savedApplied && (
        <Text variant="body" tone="textSecondary">
          {t('columnMapping.savedApplied')}
        </Text>
      )}

      <Box gap={3}>
        {/* A stronger, more visible hint — `heading` instead of the former
            muted `body`/`textSecondary` caption; this line doubles as the
            raw-preview section's own heading. */}
        <Text variant="heading">{t('columnMapping.rawPreview')}</Text>

        <RawPreview
          rows={rows}
          headerRowIndex={headerRowIndex}
          onSelectHeaderRow={onSelectHeaderRow}
        />
      </Box>

      <Divider testID="column-mapping-divider-encoding" />

      {/* Group (a): encoding/separators. The tabs-vs-chips rule: none of
          encoding, delimiter, or decimal separator changes which fields the
          form shows — picking a value just re-parses the same preview with
          the same fields — so all three are `ChipRow`, never
          `SegmentedControl` (that control is reserved for a choice that
          swaps the visible form, e.g. the amount/currency mode selectors
          below). */}
      <Box gap={3}>
        <Text variant="heading">{t('columnMapping.sectionFileFormat')}</Text>

        {!isXlsx && (
          <>
            <Box testID="column-mapping-encoding">
              <ChipRow<Encoding>
                label={t('columnMapping.encoding')}
                options={['utf-8', 'windows-1251']}
                selected={encoding}
                onSelect={onEncodingChange}
                labels={encodingLabels}
              />
            </Box>

            <Box testID="column-mapping-delimiter">
              <ChipRow<TableDelimiter>
                label={t('columnMapping.delimiter')}
                options={[',', ';', '\t']}
                selected={effectiveDelimiter ?? ','}
                onSelect={onDelimiterChange}
                labels={delimiterLabels}
              />
            </Box>
          </>
        )}

        <Box testID="column-mapping-decimal-separator">
          <ChipRow<',' | '.'>
            label={t('columnMapping.decimalSeparator')}
            options={[',', '.']}
            selected={decimalSeparator}
            onSelect={onDecimalSeparatorChange}
          />
        </Box>
      </Box>

      <Divider testID="column-mapping-divider-dates" />

      {/* Group (b): dates. */}
      <Box gap={3} style={styles.fieldGroup}>
        <Text variant="heading">{t('columnMapping.sectionDates')}</Text>

        <View ref={fieldRefs.dateColumnFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.dateColumn')}
            options={columnOptions}
            selected={dateColumn}
            onSelect={onDateColumnChange}
            required
            placeholder={t('columnMapping.dateColumnPlaceholder')}
            error={validation.dateColumnError}
            testID="column-mapping-date-column"
          />
        </View>

        <View ref={fieldRefs.dateFormatFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.dateFormat')}
            options={dateFormatOptions}
            selected={dateFormat}
            onSelect={onDateFormatChange}
            required
            placeholder={t('columnMapping.dateFormatPlaceholder')}
            error={validation.dateFormatError}
            testID="column-mapping-date-format"
          />
        </View>
      </Box>

      <Divider testID="column-mapping-divider-amounts" />

      {/* Group (c): amounts/currency. */}
      <View ref={fieldRefs.amountGroupFieldRef}>
        <Box gap={3} testID="column-mapping-amount-mode" style={styles.fieldGroup}>
          <Text variant="heading">{t('columnMapping.sectionAmount')}</Text>

          <AmountFields
            columnOptions={columnOptions}
            mode={amountMode}
            onModeChange={onAmountModeChange}
            amountColumn={amountColumn}
            onAmountColumnChange={onAmountColumnChange}
            debitColumn={debitColumn}
            onDebitColumnChange={onDebitColumnChange}
            creditColumn={creditColumn}
            onCreditColumnChange={onCreditColumnChange}
            amountColumnError={validation.amountColumnError}
            debitColumnError={validation.debitColumnError}
            creditColumnError={validation.creditColumnError}
          />
        </Box>
      </View>

      <View ref={fieldRefs.currencyGroupFieldRef}>
        <Box gap={3} testID="column-mapping-currency-mode" style={styles.fieldGroup}>
          <Text variant="heading">{t('columnMapping.sectionCurrency')}</Text>

          <CurrencyFields
            columnOptions={columnOptions}
            mode={currencyMode}
            onModeChange={onCurrencyModeChange}
            currencyColumn={currencyColumn}
            onCurrencyColumnChange={onCurrencyColumnChange}
            fixedCurrency={fixedCurrency}
            onFixedCurrencyChange={onFixedCurrencyChange}
            currencyColumnError={validation.currencyColumnError}
          />
        </Box>
      </View>

      <Divider testID="column-mapping-divider-description" />

      {/* Group (d): description/counterparty/balance — moved to the bottom,
          in their own divided group, now sharing ONE section heading. */}
      <Box gap={3} style={styles.fieldGroup}>
        <Text variant="heading">{t('columnMapping.sectionDetails')}</Text>

        <View ref={fieldRefs.descriptionColumnFieldRef}>
          <ColumnSelectField
            label={t('columnMapping.descriptionColumn')}
            options={columnOptions}
            selected={descriptionColumn}
            onSelect={onDescriptionColumnChange}
            required
            placeholder={t('columnMapping.descriptionColumnPlaceholder')}
            error={validation.descriptionColumnError}
            testID="column-mapping-description-column"
          />
        </View>

        <ColumnSelectField
          label={t('columnMapping.counterpartyColumn')}
          options={columnOptions}
          selected={counterpartyColumn}
          onSelect={onCounterpartyColumnChange}
          allowNotUsed
          placeholder={t('columnMapping.counterpartyColumnPlaceholder')}
          testID="column-mapping-counterparty-column"
        />

        <ColumnSelectField
          label={t('columnMapping.balanceColumn')}
          options={columnOptions}
          selected={balanceColumn}
          onSelect={onBalanceColumnChange}
          allowNotUsed
          placeholder={t('columnMapping.balanceColumnPlaceholder')}
          testID="column-mapping-balance-column"
        />
      </Box>

      <Divider testID="column-mapping-divider-result" />

      {/* Group (e): result — MappingResult renders its OWN heading
          (`columnMapping.result`) in both its complete and incomplete
          states, at the same gap-driven spacing every other section uses. */}
      <View ref={fieldRefs.resultFieldRef}>
        <MappingResult
          stats={stats}
          rowErrors={rowErrors}
          holdingName={holdingOptions.find((holding) => holding.id === selectedHoldingId)?.name}
          noRowsResolvedError={validation.noRowsResolvedError}
          mappingIncomplete={mappingIncomplete}
        />
      </View>

      <View ref={fieldRefs.targetHoldingFieldRef}>
        <TargetHoldingField
          label={t('statementImport.chooseHolding')}
          required
          holdings={holdingOptions}
          accountId={accountId}
          selectedId={selectedHoldingId}
          onSelect={onSelectHolding}
          onCreateNew={onCreateNewHolding}
          placeholder={t('statementImport.chooseHoldingPlaceholder')}
          error={validation.targetHoldingError}
          testID="target-holding-field"
        />
      </View>
    </Box>
  );
};

export default ColumnMappingForm;
