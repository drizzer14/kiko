import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { CategoryRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import type { SettingsStackParamList } from '../../navigation/types';
import { categoriesRepo } from '../../repositories/categories.repo';
import { styles } from './categories.styles';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

// A fixed, curated set of SF Symbol names offered by the icon picker. Editing
// an icon is deliberately a pick from this closed list rather than free text:
// the app renders every category icon through SymbolIcon/SFSymbolView, whose
// tint path (see symbol.color.ts) only handles known-good names, so an
// arbitrary user string could resolve to an invisible/blank glyph. The seed
// icons (see __fixtures__/seeded-categories) are all included so a category's
// current icon always appears selected. Grouped by personal-finance theme for
// readability; every entry is a real SF Symbol identifier.
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

// One editable category row: the leading icon doubles as the picker toggle,
// and the title is an inline rename field committed on submit/blur. Local
// title state is seeded from the row so keystrokes show immediately, while the
// persisted value flows back through the live query.
const CategoryListRow: FC<{ category: CategoryRow; isLast: boolean }> = ({ category, isLast }) => {
  const { theme } = useUnistyles();
  const [title, setTitle] = useState(category.title);
  const [pickerOpen, setPickerOpen] = useState(false);

  const commitTitle = (): void => {
    const trimmed = title.trim();

    if (trimmed !== '' && trimmed !== category.title) {
      void categoriesRepo.updateTitle(category.key, trimmed);
    }
  };

  const selectIcon = (icon: string): void => {
    setPickerOpen(false);

    if (icon !== category.icon) {
      void categoriesRepo.updateIcon(category.key, icon);
    }
  };

  return (
    <Box gap={3} style={[styles.row, isLast && styles.rowLast]}>
      <Box direction="row" gap={3} style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change ${category.title} icon`}
          accessibilityState={{ expanded: pickerOpen }}
          onPress={() => setPickerOpen(open => !open)}
          style={styles.iconChip}
        >
          <SymbolIcon name={category.icon} tone="textSecondary" />
          {/* A pencil badge overlapping the chip's corner makes the icon read
              as editable at a glance, matching the bordered rename field beside
              it. Marked with a testID (not an accessibility label) so it stays
              a decorative cue inside the already-labelled button rather than a
              second focus target for VoiceOver. */}
          <Box style={styles.editBadge} testID="category-icon-edit-badge">
            <SymbolIcon name="pencil" size={12} tone="textPrimary" />
          </Box>
        </Pressable>
        <TextInput
          accessibilityLabel={`${category.title} title`}
          value={title}
          onChangeText={setTitle}
          // Commit once on end-of-editing only. `onEndEditing` fires on both a
          // return-key submit and a blur, so a rename that loses focus without
          // pressing return still saves — and it never double-writes the way
          // wiring both `onSubmitEditing` and `onEndEditing` would.
          onEndEditing={commitTitle}
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border },
          ]}
        />
      </Box>
      {pickerOpen && (
        <Box direction="row" gap={2} style={styles.iconGrid}>
          {CURATED_ICONS.map(icon => (
            <Pressable
              key={icon}
              accessibilityRole="button"
              accessibilityLabel={`Choose icon ${icon}`}
              accessibilityState={{ selected: icon === category.icon }}
              onPress={() => selectIcon(icon)}
              style={[
                styles.iconOption,
                {
                  backgroundColor:
                    icon === category.icon ? theme.colors.accent : theme.colors.surface,
                },
              ]}
            >
              <SymbolIcon name={icon} tone="textSecondary" />
            </Pressable>
          ))}
        </Box>
      )}
    </Box>
  );
};

// The Categories settings sub-screen: a live-queried grouped list of every
// category, each row renaming its title and re-picking its icon in place.
const CategoriesScreen: FC<CategoriesScreenProps> = () => {
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);

  return (
    <Screen scroll>
      <Box gap={4}>
        <GlassSurface>
          {categories.map((category, index) => (
            <CategoryListRow
              key={category.key}
              category={category}
              isLast={index === categories.length - 1}
            />
          ))}
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default CategoriesScreen;
