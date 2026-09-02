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
import AddCategoryRow from './add-category-row';
import { styles } from './categories.styles';
import IconPickerModal from './icon-picker-modal';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

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
      categoriesRepo.updateTitle(category.key, trimmed);
    }
  };

  const selectIcon = (icon: string): void => {
    setPickerOpen(false);

    if (icon !== category.icon) {
      categoriesRepo.updateIcon(category.key, icon);
    }
  };

  return (
    <Box gap={3} style={[styles.row, isLast && styles.rowLast]}>
      <Box direction="row" gap={3} style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change ${category.title} icon`}
          accessibilityState={{ expanded: pickerOpen }}
          onPress={() => setPickerOpen(true)}
          style={styles.iconChip}
        >
          {/* The bordered chip is itself the edit affordance — no overlaid
              pencil badge; the border reads as a tappable control. */}
          <SymbolIcon name={category.icon} tone="textSecondary" />
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
      <IconPickerModal
        visible={pickerOpen}
        selectedIcon={category.icon}
        onSelect={selectIcon}
        onDismiss={() => setPickerOpen(false)}
      />
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

          <AddCategoryRow />
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default CategoriesScreen;
