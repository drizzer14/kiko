import { Pressable } from 'react-native';
import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';

import { styles } from './provider-sheet.styles';
import type { ProviderSheetProps } from './provider-sheet.props';

/**
 * The "pick a provider" sheet: a `BottomSheet` listing the rows its caller
 * passes. The bank and the crypto sections each build their own rows, so a new
 * provider adds a row on the caller's side with no change to this component.
 */
const ProviderSheet = <Id extends string>({
  visible,
  title,
  entries,
  onDismiss,
  onSelect,
  testIDPrefix,
}: ProviderSheetProps<Id>): ReactElement => {
  const handleSelect = (id: Id): void => {
    onSelect(id);
    // Selecting a row both reports the choice AND closes the sheet — a single
    // self-contained action, so a caller wires only `onSelect` for its own
    // state and gets the dismiss behavior for free.
    onDismiss();
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      header={<Text variant="heading">{title}</Text>}
      testID={`${testIDPrefix}-sheet`}
    >
      {entries.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          accessibilityLabel={[entry.label, ...entry.captions].join('. ')}
          onPress={() => handleSelect(entry.id)}
          style={styles.option}
          testID={`${testIDPrefix}-option-${entry.id}`}
        >
          <Box gap={1}>
            <Text variant="body" tone="textPrimary">
              {entry.label}
            </Text>

            {entry.captions.map((caption) => (
              <Text key={caption} variant="caption" tone="textSecondary">
                {caption}
              </Text>
            ))}
          </Box>
        </Pressable>
      ))}
    </BottomSheet>
  );
};

export default ProviderSheet;
