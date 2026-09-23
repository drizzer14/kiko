import { type ReactElement, useState } from 'react';

import FieldTrigger from '../field-trigger';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import SelectableRow from '../../../design-system/components/selectable-row';

import type { FormMode, ModeSelectFieldProps } from './mode-select-field.props';

// The transaction-TYPE selector: a labeled select FIELD (a FieldTrigger that
// opens a BottomSheet of options) rather than the former inline ChipRow, so it
// reads as one family with the form's other pickers (HoldingSelectField,
// CategoryField). It renders directly under the Holding select. The trigger
// shows the current mode's glyph + label; the sheet lists every available mode
// as a shared `SelectableRow`, closing on pick. On a read-only (synced) row the
// trigger is `disabled`: the press is inert and it dims, matching how the other
// fields render locked, so a synced transaction's bank-owned sign cannot be
// toggled here.
const ModeSelectField = ({
  visible,
  label,
  options,
  selected,
  onSelect,
  labels,
  icons,
  disabled,
}: ModeSelectFieldProps): ReactElement | null => {
  const [open, setOpen] = useState(false);

  const handleSelect = (mode: FormMode): void => {
    setOpen(false);
    onSelect(mode);
  };

  if (!visible) {
    return null;
  }

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        icon={icons[selected]}
        value={labels[selected]}
        valueTone="textPrimary"
        testID="transaction-type-field"
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{label}</Text>}
      >
        {options.map((option) => (
          <SelectableRow
            key={option}
            selected={option === selected}
            onPress={() => handleSelect(option)}
            label={labels[option]}
            icon={icons[option]}
            accessibilityLabel={labels[option]}
            testID={`transaction-type-option-${option}`}
          />
        ))}
      </BottomSheet>
    </Box>
  );
};

export default ModeSelectField;
