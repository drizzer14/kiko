import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import type { FC } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
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
 *
 * The scrim itself is a frosted dim, not opaque black: a real Liquid Glass
 * blur (`LiquidGlassView`, `effect="regular"`, tinted with `theme.colors.scrim`)
 * on iOS 26+, a flat translucent-black `View` everywhere else, structurally
 * branched on `isLiquidGlassSupported` the same way `GlassSurface` branches —
 * see `pff-design-system`'s "GlassSurface `isLiquidGlassSupported` branch".
 * `LiquidGlassView` never blocks the dismiss tap: it is a non-interactive
 * (`pointerEvents="none"`) child of the `Pressable` that owns the tap/testID/
 * a11y, not the pressable target itself.
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
  const { theme } = useUnistyles();

  return (
    <Modal transparent visible={visible} animationType={animationType} onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          testID={backdropTestID}
          accessibilityRole={backdropAccessibilityLabel === undefined ? undefined : 'button'}
          accessibilityLabel={backdropAccessibilityLabel}
        >
          {isLiquidGlassSupported ? (
            <LiquidGlassView
              effect="regular"
              colorScheme="dark"
              tintColor={theme.colors.scrim}
              style={styles.backdropFill}
              pointerEvents="none"
            />
          ) : (
            <View style={[styles.backdropFill, styles.backdropFallback]} pointerEvents="none" />
          )}
        </Pressable>

        <Box gap={gap} style={styles.sheet(insets.bottom, maxHeight)} testID={testID}>
          {children}
        </Box>
      </View>
    </Modal>
  );
};

export default BottomSheet;
