import type { FC } from 'react';
import { Modal, Pressable, ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../../design-system/components/box';
import PressableButton from '../../../design-system/components/pressable-button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import type { IconPickerModalProps } from './icon-picker-modal.props';
import { styles } from './icon-picker-modal.styles';

// A fixed, curated set of SF Symbol names offered by the icon picker. Editing
// an icon is deliberately a pick from this closed list rather than free text:
// the app renders every category icon through SymbolIcon/SFSymbolView, whose
// tint path (see symbol.color.ts) only handles known-good names, so an
// arbitrary user string could resolve to an invisible/blank glyph. The seed
// icons (see __fixtures__/seeded-categories) are all included so a category's
// current icon always appears selected. Grouped by personal-finance theme for
// readability; every entry is a real SF Symbol identifier. Lives here, the
// modal that is the pool's only consumer, so the list has one home.
const CURATED_ICONS = [
  // Food & dining
  'cart',
  'basket',
  'fork.knife',
  'cup.and.saucer',
  'wineglass',
  'takeoutbag.and.cup.and.straw',
  // Transport & travel
  'car',
  'fuelpump',
  'bus',
  'tram',
  'bicycle',
  'airplane',
  'suitcase',
  'map',
  'globe',
  // Home & utilities
  'house',
  'bolt',
  'lightbulb',
  'drop',
  'flame',
  'wifi',
  // Health & fitness
  'cross.case',
  'pills',
  'stethoscope',
  'heart',
  'dumbbell',
  'figure.run',
  // Education
  'book',
  'graduationcap',
  'backpack',
  // Entertainment & subscriptions
  'gamecontroller',
  'tv',
  'film',
  'music.note',
  'headphones',
  'ticket',
  'calendar',
  // Shopping & clothing
  'bag',
  'tshirt',
  'handbag',
  'gift',
  'giftcard',
  // Family & pets
  'pawprint',
  'teddybear',
  // Money, finance & bills
  'banknote',
  'creditcard',
  'dollarsign.circle',
  'chart.line.uptrend.xyaxis',
  'building.columns',
  'percent',
  'briefcase',
  'shield',
  'wallet.pass',
  'chart.pie',
  // Transfers & other
  'arrow.left.arrow.right',
  'hands.sparkles',
  'wrench.and.screwdriver',
  'tag',
  'square.grid.2x2',
] as const;

// A bottom-sheet modal presenting the full curated icon pool in a scrollable
// grid. The pool outgrew an inline row-expanding grid, so it lives here behind
// a real Modal: a dimmed backdrop tap, the Cancel control, and a
// hardware/gesture back (onRequestClose) all dismiss without selecting, while
// tapping a swatch selects it and lets the caller close.
const IconPickerModal: FC<IconPickerModalProps> = ({
  visible,
  selectedIcon,
  onSelect,
  onDismiss,
  onRemove,
}) => {
  const { theme } = useUnistyles();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}
    >
      <Box style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss icon picker"
          onPress={onDismiss}
          style={styles.backdrop}
        />

        <Box background="surfaceHigh" gap={3} style={styles.sheet}>
          <Box direction="row" gap={3} style={styles.header}>
            <Text variant="heading">Choose Icon</Text>

            <Box direction="row" gap={2}>
              {onRemove !== undefined && (
                <PressableButton onPress={onRemove} backgroundColor={theme.colors.surface}>
                  <Text variant="body">Remove</Text>
                </PressableButton>
              )}

              <PressableButton onPress={onDismiss} backgroundColor={theme.colors.surface}>
                <Text variant="body">Cancel</Text>
              </PressableButton>
            </Box>
          </Box>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            <Box direction="row" gap={2} style={styles.grid}>
              {CURATED_ICONS.map((icon) => (
                <Pressable
                  key={icon}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose icon ${icon}`}
                  accessibilityState={{ selected: icon === selectedIcon }}
                  onPress={() => onSelect(icon)}
                  style={[
                    styles.option,
                    {
                      backgroundColor:
                        icon === selectedIcon ? theme.colors.accent : theme.colors.surface,
                    },
                  ]}
                >
                  <SymbolIcon name={icon} tone="textSecondary" />
                </Pressable>
              ))}
            </Box>
          </ScrollView>
        </Box>
      </Box>
    </Modal>
  );
};

export default IconPickerModal;
