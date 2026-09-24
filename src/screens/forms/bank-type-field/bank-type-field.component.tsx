import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import SymbolIcon from '../../../design-system/components/symbol';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import { bankCatalog, type BankId } from '../../../bank-sync/bank-catalog';
import FieldTrigger from '../../../design-system/components/field-trigger';
import SelectableRow from '../../../design-system/components/selectable-row';

import type { BankTypeFieldProps } from './bank-type-field.props';

// The caption a bank's row shows in the picker (T22): a live-sync bank shows
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

// The Option A "which bank is this account" picker (device-feedback-round-1
// item 3): a labeled trigger (FieldTrigger, the same family CurrencyField
// and CategoryField use) that opens a BottomSheet listing every
// `bankCatalog` entry — ALWAYS every entry, never conditionally hidden
// (Guideline 5.6). Selecting a row reports the id and closes the sheet; the
// trigger stays visible and re-openable afterward (no vanish-after-select —
// see the account-detail BankSyncSection fix this plan also ships for the
// SAME class of bug there).
const BankTypeField: FC<BankTypeFieldProps> = ({ label, selected, onSelect, testID }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const selectedEntry = foldMap(maybe(selected), (id) =>
    bankCatalog.find((entry) => entry.id === id),
  );

  const handleSelect = (bankId: BankId): void => {
    onSelect(bankId);
    setOpen(false);
  };

  const handleSelectNone = (): void => {
    onSelect(null);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        onPress={() => setOpen(true)}
        // "Free" (`selected === null`) IS the default selection, not an
        // unset placeholder state — `noBank` renders as a real, textPrimary
        // value, the same as any other picked bank.
        value={selectedEntry?.displayName ?? t('forms.account.noBank')}
        valueTone="textPrimary"
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{label}</Text>}
        testID="bank-type-sheet"
      >
        {/* Guideline 5.6 "not a bank" disclaimer: a footer caption visible
            while the user is actively choosing a bank, the least-intrusive
            spot on this surface per the design system's existing hint
            pattern (see `forms.account.importOnlyBankHint`). */}
        <Text variant="caption" tone="textSecondary">
          {t('forms.account.bankDisclaimer')}
        </Text>

        {/* The explicit "no bank" row (F2 fix): a plain manual bank account
            with no specific bank identity is a valid, tested state
            (kiko-domain: `bankId` is identity-only, independent of
            `institution`) — this is how a user PICKS that state on purpose,
            or returns to it from an already-tagged account in edit mode. */}
        <SelectableRow
          selected={selected === null}
          onPress={handleSelectNone}
          label={t('forms.account.noBank')}
          testID="bank-type-option-none"
        />

        {bankCatalog.map((entry) => {
          const isSelected = entry.id === selected;
          const caption = captionFor(entry, t);
          // The compliance-load-bearing branch: `entry.connectable` (a plain
          // catalog data field, never a build/env flag — see bank-catalog.ts)
          // is the ONLY thing gating the live-sync icon. An import-only bank
          // NEVER renders it, so its description stays honestly
          // statements-only (Guideline 5.6 — no fake connect affordance).
          const descriptionTone = isSelected ? 'onAccent' : 'textSecondary';
          // The capability icons now sit in `trailing` (device-feedback-round-3
          // item 7: far right of the option, aligned with the title), so they
          // reuse the TITLE's own tone. Round-3 sized them at `body` (paired
          // with the label's `body` type step); device-feedback-round-4 item 3
          // found that one step too big next to the title text, so they now
          // step down to `caption` — one size smaller, while `titleRow`'s
          // `alignItems: 'flex-start'` still keeps them top-aligned with the
          // title's first line.
          const titleTone = isSelected ? 'onAccent' : 'textPrimary';

          return (
            <SelectableRow
              key={entry.id}
              selected={isSelected}
              onPress={() => handleSelect(entry.id)}
              label={entry.displayName}
              accessibilityLabel={`${entry.displayName}. ${caption}`}
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
                  {/* `increase.indent`: column-mapping import is a capability
                      EVERY catalog bank offers — a bank with a dedicated
                      `statementFormatId` still falls through to the generic
                      column-mapping screen for anything its own parser
                      doesn't recognize, and a bank with none uses it
                      exclusively (`bankColumnMappingOnly` above) — so this
                      renders unconditionally, not gated on
                      `entry.statementFormatId`. */}
                  <SymbolIcon
                    name="increase.indent"
                    size={theme.iconSizes.caption}
                    tone={titleTone}
                    testID={`bank-type-option-${entry.id}-column-mapping-icon`}
                  />
                </Box>
              }
              // No `numberOfLines`/truncation — a caption must wrap onto a
              // second line rather than clip (device-feedback-round-3 item 7).
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
