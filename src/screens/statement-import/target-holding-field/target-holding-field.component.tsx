import type { FC } from 'react';
import { useState } from 'react';

import TargetHoldingSheet from '../target-holding-sheet';
import FieldTrigger from '../../../design-system/components/field-trigger';

import type { TargetHoldingFieldProps } from './target-holding-field.props';

/**
 * The statement-import "choose a holding" control as a labeled SELECT FIELD
 * (device-feedback-round-F1, item 2) — a `FieldTrigger` that opens the
 * existing `TargetHoldingSheet`, mirroring the app's shared "field-plus-
 * sheet" picker family (`ModeSelectField`, `HoldingSelectField` — see
 * `kiko-design-system`'s "Component set" section) — rather than the former
 * plain `Button` that opened the same sheet. `TargetHoldingSheet` itself is
 * unchanged: it already calls `onDismiss` after a row is picked (or "Create
 * new holding" is pressed), so this component's own `onDismiss` only needs
 * to close ITS trigger state. Shared by `statement-import.screen.tsx` and
 * `column-mapping.screen.tsx`, which both used to duplicate the identical
 * Button-plus-sheet pair.
 */
const TargetHoldingField: FC<TargetHoldingFieldProps> = ({
  label,
  required,
  holdings,
  accountId,
  selectedId,
  onSelect,
  onCreateNew,
  testID,
}) => {
  const [open, setOpen] = useState(false);
  const selected = holdings.find((holding) => holding.id === selectedId);

  return (
    <>
      <FieldTrigger
        label={label}
        required={required}
        onPress={() => setOpen(true)}
        icon={selected?.icon}
        iconColor={selected?.color}
        value={selected?.name ?? label}
        valueTone={selected ? 'textPrimary' : 'textSecondary'}
        testID={testID}
      />

      <TargetHoldingSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        holdings={holdings}
        accountId={accountId}
        onSelect={onSelect}
        onCreateNew={onCreateNew}
      />
    </>
  );
};

export default TargetHoldingField;
