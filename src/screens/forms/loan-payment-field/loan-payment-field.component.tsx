import { type ReactElement, useState } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import FieldTrigger from '../../../design-system/components/field-trigger';
import SelectableRow from '../../../design-system/components/selectable-row';

import type { LoanPaymentFieldProps } from './loan-payment-field.props';

// The glyph for the synthetic "None" row — a neutral "no link" mark,
// deliberately distinct from a real loan holding's own entity icon (a loan
// holding's own icon is `minus.circle.fill` — see `entity-symbols.ts` — so
// this must never read as one).
const NONE_ICON = 'xmark.circle';

// A single-select loan-holding picker for an existing debit transaction's
// "loan payment" link — the same field-plus-sheet chrome every other Kiko
// picker with per-option entity colors uses (mirrors `CategoryField`/
// `HoldingSelectField`), with one synthetic extra row, "None", prepended
// ahead of the caller's OPEN-loan-holding options so the link can be
// explicitly cleared. Purely presentational: the caller (the transaction
// form) builds and filters `options` and persists every pick AT ONCE
// through `transactionsRepo.setLoanPayment` — there is no local pending
// state and no Save-button gating here, unlike the category picker, which
// only stages a change until Save.
const LoanPaymentField = ({
  label,
  noneLabel,
  options,
  selectedId,
  onSelect,
  linkSource,
  autoLinkedCaption,
  undoLabel,
  onUndo,
  testID,
}: LoanPaymentFieldProps): ReactElement => {
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

      {/* An auto-suggested link (the matcher's own `setAutoLoanLinks` path)
        surfaces its own caption + an Undo action here. A manual link (the
        user's own pick, above) needs neither — it was already an explicit
        choice, so undoing it is just picking a different option. */}
      {linkSource === 'auto' && (
        <Box gap={1}>
          <Text variant="caption" tone="textSecondary">
            {autoLinkedCaption}
          </Text>
          <Button
            variant="secondaryTonal"
            size="small"
            fullWidth={false}
            onPress={onUndo}
            testID={testID ? `${testID}-undo` : undefined}
          >
            {undoLabel}
          </Button>
        </Box>
      )}

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{label}</Text>}
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

export default LoanPaymentField;
