import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import type { ScrollView } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import type { CategoryRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import GlassSurface from '../../design-system/components/glass-surface';
import Screen from '../../design-system/components/screen';
import type { SettingsStackParamList } from '../../navigation/types';
import { categoriesRepo } from '../../repositories/categories.repo';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import ColorPicker from '../forms/color-picker';
import HoldingIdentityField from '../forms/holding-identity-field';
import AddCategoryRow from './add-category-row';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

// One category, rendered as its own glass card — the same GlassSurface
// treatment (padding, bordered edge) the account and holding cards use, so
// the categories list reads as a vertical stack of cards rather than rows
// inside one shared surface. The card itself carries no entity-color tint —
// only the row icon and the color picker's ringed swatch reflect the
// category's color. Inside the card, the shared identity field pairs the
// leading icon (which doubles as the picker toggle) with an inline
// title-rename field, in its caption-free (dense list) mode so the two
// controls line up at equal height. A category always keeps an icon, so no
// Remove is offered (no onRemoveIcon). Local title state is seeded from the
// row so keystrokes show immediately, while the persisted value flows back
// through the live query.
const CategoryListRow: FC<{ category: CategoryRow }> = ({ category }) => {
  const [title, setTitle] = useState(category.title);
  // The category's EFFECTIVE color: its stored hex when picked, else the
  // stable per-key palette hash — computed once and shared by the row icon
  // and the color picker's ringed swatch, so both always agree on what "this
  // category's color" means.
  const color = resolveCategoryColor(category.color, category.key);

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

  const selectColor = (hex: string): void => {
    if (hex !== category.color) {
      categoriesRepo.updateColor(category.key, hex);
    }
  };

  return (
    <GlassSurface testID="category-card" padding={4} bordered>
      <Box gap={2}>
        <HoldingIdentityField
          captioned={false}
          icon={category.icon}
          fallbackIcon={category.icon}
          // The row icon carries the category's effective color: its stored hex
          // when picked, else the stable per-key palette hash — so a colored
          // category reads its color at a glance, and an uncolored category's icon
          // still gets a hue (the same stable hash the chart already uses for it)
          // rather than staying neutral.
          iconColor={color}
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

        {/* Ring the swatch of the category's EFFECTIVE color — its stored hex when
            picked, else the stable per-key palette hash (always a real entityColors
            swatch, same hue the row icon and chart already use) —
            so the color the category actually renders in reads as selected, rather
            than nothing being ringed for a default-colored category. Picking a
            swatch still stores the chosen hex via onSelect. The per-row prefix
            scopes each swatch's a11y label to its category, so many pickers on one
            screen never collide (e.g. "Groceries color yellow"). */}
        <ColorPicker
          value={color}
          onSelect={selectColor}
          accessibilityLabelPrefix={`${category.title} color`}
        />
      </Box>
    </GlassSurface>
  );
};

// The Categories settings sub-screen: a live-queried vertical stack of every
// category, each rendered as its own card (matching the account/holding card
// treatment) so it renames its title and re-picks its icon in place. The
// inline add-category affordance renders as the final card in the same stack.
const CategoriesScreen: FC<CategoriesScreenProps> = () => {
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);

  // The scroll-mode ScrollView's ref, so expanding the inline add-category form
  // (appended below the last category card) can bring its revealed fields into
  // view.
  const scrollableRef = useAnimatedRef<ScrollView>();

  // Scroll to the form once it expands. The icon/name/color fields and the
  // Save/Cancel pair are only measured after this render commits, so defer the
  // scroll to the next frame — otherwise `scrollToEnd` targets the pre-expand
  // (shorter) content size and stops short of the freshly revealed, auto-focused
  // name field.
  const scrollToAddCategoryForm = (): void => {
    requestAnimationFrame(() => {
      scrollableRef.current?.scrollToEnd({ animated: true });
    });
  };

  return (
    <Screen scroll scrollableRef={scrollableRef}>
      <Box gap={4}>
        {categories.map((category) => (
          <CategoryListRow key={category.key} category={category} />
        ))}

        <AddCategoryRow onExpand={scrollToAddCategoryForm} />
      </Box>
    </Screen>
  );
};

export default CategoriesScreen;
