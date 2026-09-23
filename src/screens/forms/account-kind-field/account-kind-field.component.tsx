import { type FC, useState } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import SelectableRow from '../../../design-system/components/selectable-row';

import FieldTrigger from '../field-trigger';

import type { AccountKind, AccountKindFieldProps } from './account-kind-field.props';

// The account-kind selector: a labeled select FIELD (FieldTrigger + a
// BottomSheet of SelectableRow options) replacing the former inline ChipRow
// (T15), the same select-sheet family ModeSelectField and BankTypeField
// already established — the trigger shows the current kind's glyph + label,
// and the sheet lists every offered kind with a one-line subtitle
// (device-feedback: a bare label like "Property" does not say what belongs
// there). Selecting a row reports the kind and closes the sheet.
const AccountKindField: FC<AccountKindFieldProps> = ({
  label,
  options,
  selected,
  onSelect,
  labels,
  subtitles,
  icons,
  disabled,
  testID,
}) => {
  const [open, setOpen] = useState(false);

  const handleSelect = (kind: AccountKind): void => {
    setOpen(false);
    onSelect(kind);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        disabled={disabled}
        onPress={() => setOpen(true)}
        icon={icons[selected]}
        value={labels[selected]}
        valueTone="textPrimary"
        testID={testID}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        header={<Text variant="heading">{label}</Text>}
        testID="account-kind-sheet"
      >
        {options.map((kind) => {
          const isSelected = kind === selected;

          return (
            <SelectableRow
              key={kind}
              selected={isSelected}
              onPress={() => handleSelect(kind)}
              label={labels[kind]}
              icon={icons[kind]}
              accessibilityLabel={`${labels[kind]}. ${subtitles[kind]}`}
              testID={`account-kind-option-${kind}`}
              description={
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                  {subtitles[kind]}
                </Text>
              }
            />
          );
        })}
      </BottomSheet>
    </Box>
  );
};

export default AccountKindField;
