import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { IconPickerModalProps } from './icon-picker-modal.props';
import { styles } from './icon-picker-modal.styles';

// A fixed, curated set of SF Symbol names offered by the icon picker. Editing
// an icon is deliberately a pick from this closed list rather than free text:
// the app renders every category icon through SymbolIcon/SFSymbolView, whose
// tint path (see symbol.color.ts) only handles known-good names, so an
// arbitrary user string could resolve to an invisible/blank glyph. This is
// the user's final "Kiko" curation (138 symbols; a handful of the original
// 153 were dropped after rendering empty on device, including 8 very-new SF
// Symbols — the *.building.classical variants (including
// building.classical.columns.fill, confirmed invisible on this device),
// numero.sign, number.sign, and pizza.slice — that render blank on the
// device's older iOS) — a category seeded with
// an icon that predates this set (see __fixtures__/seeded-categories) still
// renders its own icon fine via SymbolIcon; it just will not show as the
// selected swatch inside this picker's grid. Grouped by theme for
// readability; every entry is a real SF Symbol identifier. Lives here, the
// modal that is the pool's only consumer, so the list has one home.
const CURATED_ICONS = [
  // Money & finance
  'building.columns.fill',
  'banknote',
  'creditcard',
  'wallet.bifold',
  'dollarsign',
  'eurosign',
  'hryvniasign',
  'bitcoinsign',
  'percent',
  'paragraphsign',
  'sum',
  'receipt',
  'giftcard',
  'gift',
  'arrow.left.arrow.right',
  // Transport & travel
  'airplane',
  'airplane.ticket',
  'car',
  'bus',
  'bicycle',
  'scooter',
  'moped',
  'motorcycle',
  'tram',
  'tram.card',
  'lightrail',
  'cablecar',
  'ferry',
  'sailboat',
  'truck.box',
  'fuelpump',
  'ev.charger',
  'parkingsign',
  'skateboard',
  'ticket',
  // Shopping & bags
  'cart',
  'basket',
  'bag',
  'handbag',
  'duffle.bag',
  'backpack',
  'shoe.2',
  'tshirt',
  'sunglasses',
  'eyeglasses',
  // Home & office
  'house',
  'building',
  'bed.double',
  'sofa',
  'key',
  'lock',
  'hammer',
  'lightbulb',
  'printer',
  'scanner',
  'faxmachine',
  'clipboard',
  'document',
  'list.bullet',
  'shippingbox',
  'server.rack',
  'cable.connector',
  // Tech & electronics
  'laptopcomputer',
  'pc',
  'display',
  'keyboard',
  'headphones',
  'headset',
  'av.remote',
  'cellularbars',
  'simcard',
  'camera',
  'mediastick',
  // Food & drink
  'fork.knife',
  'cup.and.saucer',
  'cup.and.heat.waves',
  'wineglass',
  'popcorn',
  // Health & body
  'heart',
  'stethoscope',
  'pill',
  'bandage',
  'cross',
  'cross.case',
  'thermometer.variable',
  'mouth',
  'mustache',
  'dumbbell',
  'figure.run',
  // Animals
  'cat',
  'dog',
  'bird',
  'fish',
  'hare',
  'pawprint',
  // Sports & recreation
  'basketball',
  'soccerball',
  'tennisball',
  'tennis.racket',
  'volleyball',
  'hockey.puck',
  'skis',
  'snowboard',
  'dice',
  'gamecontroller',
  'formfitting.gamecontroller',
  'puzzlepiece',
  'tent',
  'trophy',
  // Arts, work & misc.
  'book.closed',
  'briefcase',
  'pencil',
  'paintbrush',
  'paintbrush.pointed',
  'paintpalette',
  'scissors',
  'wand.and.sparkles',
  'movieclapper',
  'pianokeys',
  'tv',
  'phone',
  'photo',
  'envelope',
  'envelope.front',
  'calendar',
  'alarm',
  'hourglass',
  'clock.arrow.trianglehead.2.counterclockwise.rotate.90',
  'map',
  'pin',
  'person',
  'person.line.dotted.person',
  'infinity',
  'repeat',
  'trash',
  'nosign',
  'scope',
  'xmark.triangle.circle.square',
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
  const { t } = useTranslation();

  return (
    // `scrollable={false}`: the Remove/Cancel header below must stay pinned
    // above the grid regardless of scroll position — BottomSheet's shared
    // ScrollView (F5 fix) would otherwise sweep the header into the same
    // scrollable region as the grid below it, along with nesting a second
    // same-axis ScrollView around this component's own.
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      animationType="slide"
      backdropAccessibilityLabel={t('categories.dismissIconPicker')}
      scrollable={false}
    >
      <Box direction="row" gap={3} style={styles.header}>
        <Text variant="heading">{t('categories.chooseIconHeading')}</Text>

        <Box direction="row" gap={2}>
          {onRemove !== undefined && (
            <Button variant="secondary" size="compact" fullWidth={false} onPress={onRemove}>
              {t('forms.holding.remove')}
            </Button>
          )}

          <Button variant="secondary" size="compact" fullWidth={false} onPress={onDismiss}>
            {t('common.cancel')}
          </Button>
        </Box>
      </Box>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        <Box direction="row" gap={2} style={styles.grid}>
          {CURATED_ICONS.map((icon) => (
            <Pressable
              key={icon}
              accessibilityRole="button"
              accessibilityLabel={t('categories.iconOptionLabel', { icon })}
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
    </BottomSheet>
  );
};

export default IconPickerModal;
