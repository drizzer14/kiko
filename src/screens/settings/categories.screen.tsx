import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import type { CategoryRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import Screen from '../../design-system/components/screen';
import type { SettingsStackParamList } from '../../navigation/types';
import { categoriesRepo } from '../../repositories/categories.repo';
import HoldingIdentityField from '../forms/holding-identity-field';
import AddCategoryRow from './add-category-row';
import { styles } from './categories.styles';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

// One editable category row: the shared identity field pairs the leading icon
// (which doubles as the picker toggle) with an inline title-rename field, in
// its caption-free (dense list) mode so the two controls line up at equal
// height. A category always keeps an icon, so no Remove is offered (no
// onRemoveIcon). Local title state is seeded from the row so keystrokes show
// immediately, while the persisted value flows back through the live query.
const CategoryListRow: FC<{ category: CategoryRow; isLast: boolean }> = ({ category, isLast }) => {
  const [title, setTitle] = useState(category.title);

  const commitTitle = (): void => {
    const trimmed = title.trim();

    if (trimmed !== '' && trimmed !== category.title) {
      categoriesRepo.updateTitle(category.key, trimmed);
    }
  };

  const selectIcon = (icon: string): void => {
    if (icon !== category.icon) {
      categoriesRepo.updateIcon(category.key, icon);
    }
  };

  return (
    <Box style={[styles.row, isLast && styles.rowLast]}>
      <HoldingIdentityField
        captioned={false}
        icon={category.icon}
        fallbackIcon={category.icon}
        iconAccessibilityLabel={`Change ${category.title} icon`}
        onSelectIcon={selectIcon}
        name={title}
        onChangeName={setTitle}
        nameAccessibilityLabel={`${category.title} title`}
        // Commit once on end-of-editing only. `onEndEditing` fires on both a
        // return-key submit and a blur, so a rename that loses focus without
        // pressing return still saves — and it never double-writes the way
        // wiring both `onSubmitEditing` and `onEndEditing` would.
        onEndEditingName={commitTitle}
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
