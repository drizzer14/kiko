import type { FC } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Box from '../box';
import type { BottomSheetProps } from './bottom-sheet.props';
import { styles } from './bottom-sheet.styles';

/**
 * The one bottom-sheet primitive: a transparent Modal, a full-bleed dismiss
 * scrim, and a bottom-anchored sheet card that owns the correct bottom padding
 * (a single base step plus the bottom safe-area inset, since a Modal renders
 * outside any SafeAreaView). Every hand-rolled `Modal + backdrop + Box` sheet
 * routes through here so the safe-area inset and base padding can never drift
 * (or, as with the filter menu, go missing) per sheet again.
 *
 * The scrim and the sheet are siblings inside the overlay, not parent/child, so
 * a tap on the sheet never reaches the scrim's dismiss handler — the opaque
 * sheet simply sits on top of the scrim, and an inner ScrollView scrolls freely
 * (no `onStartShouldSetResponder` guard is needed).
 */
const BottomSheet: FC<BottomSheetProps> = ({
  visible,
  onDismiss,
  children,
  gap = 3,
  animationType = 'fade',
  maxHeight,
  testID,
  backdropTestID,
  backdropAccessibilityLabel,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType={animationType} onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          testID={backdropTestID}
          accessibilityRole={backdropAccessibilityLabel === undefined ? undefined : 'button'}
          accessibilityLabel={backdropAccessibilityLabel}
        />

        <Box gap={gap} style={styles.sheet(insets.bottom, maxHeight)} testID={testID}>
          {children}
        </Box>
      </View>
    </Modal>
  );
};

export default BottomSheet;
