import { View } from 'react-native';
import type { ReactElement } from 'react';
import HoldingSelectField from '@kiko/screens/forms/holding-select-field';

import type { PrimaryHoldingFieldProps } from './primary-holding-field.props';

// The primary-leg holding picker, rendered ONLY in the empty-create (global-add,
// B) case — the one mode where no holding is fixed by navigation, so the user
// picks the leg here (its currency/category/exchange eligibility then flow
// automatically through the shared `primaryHoldingId` seam). Returns null on
// every other path. A component of its own (returns `ReactElement | null`) so
// the screen's JSX gates on a single element rather than its own
// `isEmptyCreate &&`, keeping that branch out of the screen's cognitive-
// complexity budget — the same shape as `ReadOnlyNotice`. Wrapped in a plain
// `View` for `fieldRef`, so a blocked Save can scroll to it: the select field
// does not forward a ref of its own.
const PrimaryHoldingField = ({
  visible,
  label,
  sheetTitle,
  placeholder,
  options,
  selectedId,
  onSelect,
  onCreateNew,
  error,
  fieldRef,
}: PrimaryHoldingFieldProps): ReactElement | null => {
  if (!visible) {
    return null;
  }

  return (
    <View ref={fieldRef}>
      <HoldingSelectField
        label={label}
        sheetTitle={sheetTitle}
        placeholder={placeholder}
        options={options}
        selectedId={selectedId}
        onSelect={onSelect}
        onCreateNew={onCreateNew}
        required
        error={error}
      />
    </View>
  );
};

export default PrimaryHoldingField;
