import { type ReactElement, useState } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import FieldTrigger from '../../../design-system/components/field-trigger';
import SelectableRow from '../../../design-system/components/selectable-row';

import type { PaymentHoldingFieldProps } from './payment-holding-field.props';

// The glyph for the synthetic "None" row — mirrors `LoanPaymentField`'s own
// `NONE_ICON`, a neutral "no link" mark distinct from any real holding's own
// entity icon.
const NONE_ICON = 'xmark.circle';

// A single-select, clearable holding picker: the same field-plus-sheet
// chrome `LoanPaymentField`/`HoldingSelectField` use, with a synthetic
// "None" row prepended so the pick can be explicitly cleared back to no
// selection — unlike `HoldingSelectField`, whose own `onSelect` never
// reports `null` (that field is always REQUIRED once a mode needs it).
// Extracted out of `LoanPaymentField` (which wraps this and adds its own
// auto-link caption/Undo) so the loan form's own "Paid from" field — an
// optional holding link with no auto-link state of its own — can reuse the
// same picker chrome without carrying transaction-form-only props it would
// never use. Purely presentational: the caller builds and filters `options`.
const PaymentHoldingField = ({
  label,
  sheetTitle,
  noneLabel,
  options,
  selectedId,
  onSelect,
  testID,
}: PaymentHoldingFieldProps): ReactElement => {
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.id === selectedId) ?? null;

  const handleSelect = (id: string | null): void => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        testID={testID}
        onPress={() => setOpen(true)}
        icon={selected?.icon ?? NONE_ICON}
        iconColor={selected?.color}
        value={selected?.name ?? noneLabel}
        valueTone={selected ? 'textPrimary' : 'textSecondary'}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{sheetTitle}</Text>}
      >
        <SelectableRow
          selected={selectedId === null}
          onPress={() => handleSelect(null)}
          label={noneLabel}
          icon={NONE_ICON}
          testID={testID ? `${testID}-option-none` : undefined}
        />

        {options.map((option) => {
          const isSelected = option.id === selectedId;

          return (
            <SelectableRow
              key={option.id}
              selected={isSelected}
              onPress={() => handleSelect(option.id)}
              label={option.name}
              icon={option.icon}
              iconColor={option.color}
              accessibilityLabel={`${option.name}, ${option.accountName}`}
              testID={testID ? `${testID}-option-${option.id}` : undefined}
              description={
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                  {`${option.accountName} · ${option.currency}`}
                </Text>
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default PaymentHoldingField;
