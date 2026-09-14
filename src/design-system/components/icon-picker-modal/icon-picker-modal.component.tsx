import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import Button from '../button';
import SymbolIcon from '../symbol';
import BottomSheet from '../bottom-sheet';
import SheetFooter from '../sheet-footer';

import { styles } from './icon-picker-modal.styles';
import type { IconPickerModalProps } from './icon-picker-modal.props';

// A bottom-sheet modal presenting the caller-supplied icon pool in a scrollable
// grid. The picker is POOL-DRIVEN: the caller passes `icons` (KIKO_ENTITIES_ICONS
// for the account/holding IconEditor, KIKO_CATEGORIES_ICONS for the category
// picker — see ./icon-pools), rather than the modal hardcoding a single pool.
// Editing an icon is deliberately a pick from a closed list rather than free
// text: the app renders every icon through SymbolIcon/SFSymbolView, whose tint
// path (see symbol.color.ts) only handles known-good names, so an arbitrary user
// string could resolve to an invisible/blank glyph. A row seeded with a default
// that predates its pool still renders its own icon fine via SymbolIcon; it just
// will not show as a selected swatch inside this picker's grid. The pool lives
// behind a real Modal: a dimmed backdrop tap, the Cancel control, and a
// hardware/gesture back (onRequestClose) all dismiss without selecting, while
// tapping a swatch selects it and lets the caller close.
const IconPickerModal: FC<IconPickerModalProps> = ({
  visible,
  icons,
  selectedIcon,
  onSelect,
  onDismiss,
  onRemove,
}) => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  return (
    // `scrollable={false}`: the Remove/Cancel footer below must stay pinned at
    // the body end regardless of scroll position — BottomSheet's shared
    // ScrollView (F5 fix) would otherwise sweep it into the same scrollable
    // region as the grid above it, along with nesting a second same-axis
    // ScrollView around this component's own. The title renders through the
    // shared `header` prop instead (see below); the actions used to sit in a
    // top-right row beside it (this sheet's former outlier footer pattern —
    // see `explore-bottomsheet.md`'s action-button inventory) and now render
    // through the shared `SheetFooter` at the body end instead, the same
    // placement every other choice sheet uses.
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      animationType="slide"
      backdropAccessibilityLabel={t('categories.dismissIconPicker')}
      scrollable={false}
      header={<Text variant="heading">{t('categories.chooseIconHeading')}</Text>}
    >
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
        <Box direction="row" gap={2} style={styles.grid}>
          {icons.map((icon) => {
            const isSelected = icon === selectedIcon;

            return (
              <Pressable
                key={icon}
                accessibilityRole="button"
                accessibilityLabel={t('categories.iconOptionLabel', { icon })}
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelect(icon)}
                style={[
                  styles.option,
                  {
                    // The grid renders inside the shared BottomSheet, whose
                    // base is the grouped `sheetBackground` (= `surface`). An
                    // unselected tile therefore uses `surfaceHigh` — one level
                    // ABOVE the sheet base — so it reads as a raised control
                    // instead of blending into the sheet (the same grouped-
                    // elevation convention as an OptionPills pill). Selected
                    // keeps the accent fill.
                    backgroundColor: isSelected ? theme.colors.accent : theme.colors.surfaceHigh,
                  },
                ]}
              >
                {/* Selected sits on the filled accent surface, so it needs the
                    always-white `onAccent` tone the same way Button's
                    primary/destructive variants do — `textSecondary` would
                    render black-on-blue and disappear. Unselected keeps the
                    normal adapting `textSecondary` tone. */}
                <SymbolIcon name={icon} tone={isSelected ? 'onAccent' : 'textSecondary'} />
              </Pressable>
            );
          })}
        </Box>
      </ScrollView>

      <SheetFooter>
        {onRemove !== undefined && (
          <Button variant="destructiveTonal" fullWidth={false} onPress={onRemove}>
            {t('forms.holding.remove')}
          </Button>
        )}

        <Button variant="secondary" fullWidth={false} onPress={onDismiss}>
          {t('common.cancel')}
        </Button>
      </SheetFooter>
    </BottomSheet>
  );
};

export default IconPickerModal;
