import type { TFunction } from 'i18next';
import { type FC, useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';
import SelectableRow from '@kiko/design-system/components/selectable-row';
import { bankCatalog, type BankId, OTHER_BANK_ID } from '@kiko/bank-sync/bank-catalog';

import type { BankTypeFieldProps } from './bank-type-field.props';

// The column-mapping capability glyph, shared by every named bank's row and
// the "Other bank" row so the two can never drift apart.
const COLUMN_MAPPING_SYMBOL = 'increase.indent';

// The caption a bank's row shows in the picker: a live-sync bank shows
// `bankConnectable`; an import-only bank with its own dedicated
// `statement-import` parser shows `bankImportOnly`; an import-only bank with
// NO dedicated parser (PUMB, Oschadbank, Ukrgasbank) shows
// `bankColumnMappingOnly` instead, honestly naming its actual import path —
// the generic column-mapping screen — rather than implying a format-specific
// preview that doesn't exist for it. A pure helper (no hook access), so the
// translator function is threaded in from the component's own
// `useTranslation()`, the same pattern `sensorHint`
// (`app-lock-setting.component.tsx`) uses.
const captionFor = (entry: (typeof bankCatalog)[number], t: TFunction): string => {
  if (entry.connectable) {
    return t('forms.account.bankConnectable');
  }

  if (entry.statementFormatId === undefined) {
    return t('forms.account.bankColumnMappingOnly');
  }

  return t('forms.account.bankImportOnly');
};

// The "which bank is this account" picker: a labeled trigger
// (FieldTrigger, the same family CurrencyField
// and CategoryField use) that opens a BottomSheet listing every
// `bankCatalog` entry — ALWAYS every entry, never conditionally hidden
// (Guideline 5.6). Selecting a row reports the id and closes the sheet; the
// trigger stays visible and re-openable afterward (no vanish-after-select,
// the same guard the account-detail BankSyncSection keeps).
const BankTypeField: FC<BankTypeFieldProps> = ({
  label,
  sheetTitle,
  selected,
  onSelect,
  required,
  disabled,
  error,
  testID,
}) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const labelFor = (entry: (typeof bankCatalog)[number]): string =>
    entry.displayName ?? t('forms.account.otherBank');

  const selectedEntry = foldMap(maybe(selected), (id) =>
    bankCatalog.find((entry) => entry.id === id),
  );

  const handleSelect = (bankId: BankId): void => {
    onSelect(bankId);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        disabled={disabled}
        onPress={() => setOpen(true)}
        value={foldMap(maybe(selectedEntry), labelFor) ?? t('forms.account.bankTypePlaceholder')}
        valueTone={selected === null ? 'textSecondary' : 'textPrimary'}
        error={error}
        testID={testID}
      />

      {/* Guideline 5.6 "not a bank" disclaimer, and the third-party-trademark
          clause (kiko-compliance) the broker field carries under its trigger:
          every bank is named in plain text, so the field says Kiko is not a
          bank and not affiliated with any of them, whether or not the sheet
          is open. */}
      <Text variant="caption" tone="textSecondary">
        {t('forms.account.bankDisclaimer')}
      </Text>

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{sheetTitle}</Text>}
        testID="bank-type-sheet"
      >
        {bankCatalog.map((entry) => {
          const isSelected = entry.id === selected;

          // The catalog's last entry covers any bank not listed, so it shows
          // no capability caption and no connect or statement-format icon.
          // It has no parser, so its statements come in through the
          // column-mapping screen: it carries the one column-mapping glyph
          // the banks with no dedicated parser show, in the capability
          // icons' own tone and size, and VoiceOver reads it out with the
          // description those banks use.
          if (entry.id === OTHER_BANK_ID) {
            return (
              <SelectableRow
                key={entry.id}
                selected={isSelected}
                onPress={() => handleSelect(entry.id)}
                label={labelFor(entry)}
                accessibilityLabel={`${labelFor(entry)}. ${captionFor(entry, t)}`}
                testID={`bank-type-option-${entry.id}`}
                trailing={
                  <SymbolIcon
                    name={COLUMN_MAPPING_SYMBOL}
                    size={theme.iconSizes.caption}
                    tone={isSelected ? 'onAccent' : 'textPrimary'}
                    testID={`bank-type-option-${entry.id}-column-mapping-icon`}
                  />
                }
              />
            );
          }

          const caption = captionFor(entry, t);
          // The compliance-load-bearing branch: `entry.connectable` (a plain
          // catalog data field, never a build/env flag — see bank-catalog.ts)
          // is the ONLY thing gating the live-sync icon. An import-only bank
          // NEVER renders it, so its description stays honestly
          // statements-only (Guideline 5.6 — no fake connect affordance).
          const descriptionTone = isSelected ? 'onAccent' : 'textSecondary';
          // The capability icons sit in `trailing` (far right of the option,
          // aligned with the title), so they reuse the TITLE's own tone,
          // stepped down to `caption` — one size smaller than the label's
          // `body` type step, so they never read as too big next to the
          // title text — while `titleRow`'s
          // `alignItems: 'flex-start'` still keeps them top-aligned with the
          // title's first line.
          const titleTone = isSelected ? 'onAccent' : 'textPrimary';

          return (
            <SelectableRow
              key={entry.id}
              selected={isSelected}
              onPress={() => handleSelect(entry.id)}
              label={labelFor(entry)}
              accessibilityLabel={`${labelFor(entry)}. ${caption}`}
              testID={`bank-type-option-${entry.id}`}
              trailing={
                <Box direction="row" gap={1}>
                  {entry.connectable && (
                    <SymbolIcon
                      name="arrow.trianglehead.2.clockwise.rotate.90"
                      size={theme.iconSizes.caption}
                      tone={titleTone}
                      testID={`bank-type-option-${entry.id}-connect-icon`}
                    />
                  )}
                  {/* One capability icon per real capability (the design
                      system's transparency principle): `receipt` means "this
                      bank has a known, dedicated statement format" — gated on
                      `statementFormatId`, so a column-mapping-only bank (no
                      dedicated parser) does not show it; that bank still
                      offers import, but only through the generic
                      column-mapping screen, which `increase.indent` below
                      already names. */}
                  {entry.statementFormatId !== undefined && (
                    <SymbolIcon
                      name="receipt"
                      size={theme.iconSizes.caption}
                      tone={titleTone}
                      testID={`bank-type-option-${entry.id}-import-icon`}
                    />
                  )}
                  {/* Column-mapping import is a capability EVERY catalog bank
                      offers — a bank with a dedicated `statementFormatId`
                      still falls through to the generic column-mapping
                      screen for anything its own parser doesn't recognize,
                      and a bank with none uses it exclusively
                      (`bankColumnMappingOnly` above) — so this renders
                      unconditionally, not gated on `entry.statementFormatId`. */}
                  <SymbolIcon
                    name={COLUMN_MAPPING_SYMBOL}
                    size={theme.iconSizes.caption}
                    tone={titleTone}
                    testID={`bank-type-option-${entry.id}-column-mapping-icon`}
                  />
                </Box>
              }
              // No `numberOfLines`/truncation — a caption must wrap onto a
              // second line rather than clip.
              description={
                <Text variant="caption" tone={descriptionTone}>
                  {caption}
                </Text>
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default BankTypeField;
