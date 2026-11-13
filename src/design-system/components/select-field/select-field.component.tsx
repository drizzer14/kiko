import maybe, { foldMap } from 'fnts/maybe';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useScrollToSelected } from '@kiko/design-system/use-scroll-to-selected';

import Box from '../box';
import Text from '../text';
import FilterPill from '../filter-pill';
import BottomSheet from '../bottom-sheet';
import FieldTrigger from '../field-trigger';
import SelectableRow from '../selectable-row';

import { styles } from './select-field.styles';
import type { SelectFieldProps } from './select-field.props';

// The generic "labeled field that opens a picker sheet" family
// (`FieldTrigger` + `BottomSheet` + a `SelectableRow` per option) — a NEW
// long-list select (property category, loan kind, bond coupon frequency,
// account kind, transaction type) reaches for this rather than hand-rolling
// its own copy. Generic over the option type, so it is a plain function
// component (an `FC` cannot carry a type parameter) — mirrors `ChipRow`'s
// own shape.
const SelectField = <Option extends string>({
  label,
  sheetTitle,
  options,
  selected,
  onSelect,
  onSelectClosed,
  closesWithoutAnimation,
  labels,
  subtitles,
  icons,
  placeholder,
  appearance = 'field',
  active,
  required,
  disabled,
  capped,
  error,
  emptyAction,
  emptyOption,
  testID,
}: SelectFieldProps<Option>): ReactElement => {
  const [open, setOpen] = useState(false);
  const { scrollRef, onContentSizeChange, onRowLayout } = useScrollToSelected(open, selected);
  const selectedOption = maybe(selected);
  // What the sheet is closing for (a pick or the empty action), held until the
  // close has finished: a sheet closed by a scrim tap leaves it empty, so
  // nothing fires without a pick or the action. A pick keeps only the option,
  // so the close runs the LATEST `onSelectClosed`, which sees the state the
  // pick just set, not the one the pick rendered with.
  const pendingClose = useRef<{ option: Option } | { action: () => void } | undefined>(undefined);
  const latestSelectClosed = useRef(onSelectClosed);

  // The host re-renders on the pick with a callback that closes over the picked state, and the
  // sheet reports its close with the handler it was last given, which may be older still.
  useEffect(() => {
    latestSelectClosed.current = onSelectClosed;
  });
  // Set in the same batch that hides the sheet, so the one render that hides
  // it hands the Modal `'none'` (native reads the animation flag again on that
  // very commit); the next open clears it, so the next open fades in.
  const [closingWithoutAnimation, setClosingWithoutAnimation] = useState(false);

  const handleSelect = (option: Option): void => {
    pendingClose.current = { option };
    setClosingWithoutAnimation(closesWithoutAnimation?.(option) ?? false);
    setOpen(false);
    onSelect(option);
  };

  // The action leaves the screen, so it waits for the close like a pick that
  // navigates, and skips the fade: the fade is only a wait.
  const handleEmptyAction = (onPress: () => void): void => {
    pendingClose.current = { action: onPress };
    setClosingWithoutAnimation(true);
    setOpen(false);
  };

  const handleOpen = (): void => {
    setClosingWithoutAnimation(false);
    setOpen(true);
  };

  const handleClosed = (): void => {
    foldMap(maybe(pendingClose.current), (pending) => {
      pendingClose.current = undefined;

      if ('action' in pending) {
        pending.action();
      } else {
        latestSelectClosed.current?.(pending.option);
      }
    });
  };

  const selectedLabel = foldMap(selectedOption, (option) => labels[option]) ?? placeholder;

  return (
    <Box gap={1} style={appearance === 'pill' && styles.pillRoot}>
      {appearance === 'pill' ? (
        <FilterPill
          label={label}
          accessibilityLabel={label}
          value={selectedLabel}
          active={active}
          capped={capped}
          onPress={handleOpen}
          testID={testID}
        />
      ) : (
        <FieldTrigger
          label={label}
          required={required}
          disabled={disabled}
          capped={capped}
          onPress={handleOpen}
          icon={foldMap(selectedOption, (option) => icons?.[option])}
          value={selectedLabel}
          valueTone={
            selected === null || selected === emptyOption ? 'textSecondary' : 'textPrimary'
          }
          error={error}
          testID={testID}
        />
      )}

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        onClosed={handleClosed}
        animationType={closingWithoutAnimation ? 'none' : undefined}
        testID={testID && `${testID}-sheet`}
        gap={2}
        scrollRef={scrollRef}
        onContentSizeChange={onContentSizeChange}
        header={<Text variant="heading">{sheetTitle}</Text>}
      >
        {options.map((option) => {
          const isSelected = option === selected;
          const subtitle = subtitles?.[option];

          return (
            <SelectableRow
              key={option}
              selected={isSelected}
              onPress={() => handleSelect(option)}
              onLayout={(event) => onRowLayout(option, event)}
              label={labels[option]}
              icon={icons?.[option]}
              accessibilityLabel={
                subtitle === undefined ? labels[option] : `${labels[option]}. ${subtitle}`
              }
              testID={testID ? `${testID}-option-${option}` : undefined}
              description={foldMap(maybe(subtitle), (found) => (
                <Text variant="caption" tone={isSelected ? 'onAccent' : 'textSecondary'}>
                  {found}
                </Text>
              ))}
            />
          );
        })}

        {emptyAction && options.length === 0 && (
          <SelectableRow
            selected={false}
            onPress={() => handleEmptyAction(emptyAction.onPress)}
            label={emptyAction.label}
            icon="plus"
            testID={testID ? `${testID}-empty-action` : undefined}
          />
        )}
      </BottomSheet>
    </Box>
  );
};

export default SelectField;
