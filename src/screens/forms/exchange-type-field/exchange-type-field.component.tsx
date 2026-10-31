import { type FC, useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import {
  type ExchangeCatalogId,
  exchangeCatalog,
  exchangeLabelOf,
} from '@kiko/crypto-sync/exchange-catalog';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';
import SelectableRow from '@kiko/design-system/components/selectable-row';

import type { ExchangeTypeFieldProps } from './exchange-type-field.props';

// The "which exchange or wallet is this crypto account" picker: a labeled trigger
// (FieldTrigger, the family BankTypeField uses) that opens a BottomSheet listing every
// `exchangeCatalog` entry — ALWAYS every entry, never conditionally hidden (Guideline 2.5.19).
// Selecting a row reports the id and closes the sheet; the trigger stays visible and re-openable.
const ExchangeTypeField: FC<ExchangeTypeFieldProps> = ({
  label,
  sheetTitle,
  selected,
  onSelect,
  disabled,
  testID,
}) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const selectedEntry = foldMap(maybe(selected), (id) =>
    exchangeCatalog.find((entry) => entry.id === id),
  );

  const handleSelect = (exchangeId: ExchangeCatalogId): void => {
    onSelect(exchangeId);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        value={
          foldMap(maybe(selectedEntry), (entry) => exchangeLabelOf(entry, t)) ??
          t('forms.account.exchangeTypePlaceholder')
        }
        valueTone={selected === null ? 'textSecondary' : 'textPrimary'}
        testID={testID}
      />

      {/* Guideline 5.2.1 third-party-trademark clause (kiko-compliance): every exchange is named
          in plain text, so the field says Kiko is not affiliated with any of them, whether or not
          the sheet is open. */}
      <Text variant="caption" tone="textSecondary">
        {t('forms.account.exchangeDisclaimer')}
      </Text>

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        header={<Text variant="heading">{sheetTitle}</Text>}
        testID="exchange-type-sheet"
      >
        {exchangeCatalog.map((entry) => {
          const isSelected = entry.id === selected;
          const caption = t(entry.captionKey);
          const name = exchangeLabelOf(entry, t);

          return (
            <SelectableRow
              key={entry.id}
              selected={isSelected}
              onPress={() => handleSelect(entry.id)}
              label={name}
              accessibilityLabel={`${name}. ${caption}`}
              testID={`exchange-type-option-${entry.id}`}
              trailing={
                // The compliance-load-bearing branch: `entry.connectable` (a plain catalog data
                // field, never a build/env flag) is the ONLY thing gating the live-sync icon, so
                // an entry added by hand never shows a fake connect affordance.
                entry.connectable ? (
                  <SymbolIcon
                    name="arrow.trianglehead.2.clockwise.rotate.90"
                    size={theme.iconSizes.caption}
                    tone={isSelected ? 'onAccent' : 'textPrimary'}
                    testID={`exchange-type-option-${entry.id}-connect-icon`}
                  />
                ) : undefined
              }
              // No `numberOfLines`/truncation — a caption must wrap onto a second line rather
              // than clip.
              description={
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
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

export default ExchangeTypeField;
