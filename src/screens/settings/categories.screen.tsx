import Sortable from 'react-native-sortables';
import { useTranslation } from 'react-i18next';
import { categoriesRepo } from '@kiko/categories/repo';
import type { ScrollViewInstance } from 'react-native';
import { useAnimatedRef } from 'react-native-reanimated';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { type FC, useCallback, useRef, useState } from 'react';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import ColorPicker from '../forms/color-picker';
import type { CategoryRow } from '../../db/schema';
import Box from '../../design-system/components/box';
import { useLiveQuery } from '../../db/use-live-query';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import HoldingIdentityField from '../forms/holding-identity-field';
import type { SettingsStackParamList } from '../../navigation/types';
import GlassSurface from '../../design-system/components/glass-surface';
import { DEFAULT_CATEGORY_KEY } from '../../categories/category-display';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import { resolveDefaultCategoryTitle } from '../../i18n/default-category-title';
import { onGridDragEnd, openDeleteMenu } from '../../design-system/grid-interaction';

import AddCategoryRow from './add-category-row';

type CategoriesScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Categories'>;

const styles = StyleSheet.create(() => ({
  // The card's top row: the identity field (icon + rename) stretches, and the
  // trailing slot (the "set as default" star, or the default-category filled
  // star on the default card) sits at its right edge, vertically centered
  // against it.
  header: {
    alignItems: 'center',
  },
  // Bounds the identity field to the space left of the trailing control so a
  // long title wraps within the card instead of pushing the control off-screen.
  identity: {
    flex: 1,
  },
  // The card's bottom row: the labelled Delete (left, disabled on the default
  // card) and the reorder cluster (right), split by `space-between` and centered
  // against each other. The controls themselves are the shared compact ghost
  // Button, which owns its own 44pt touch target, so this row sets only the
  // layout.
  bottomRow: {
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The move-to-top / move-to-bottom reorder cluster, sharing the bottom row
  // with the Delete control. `marginLeft: 'auto'` pins it to the row's right
  // edge; the Delete now renders on every card (disabled on the default), so the
  // row's layout is identical across all cards.
  reorderButtons: {
    marginLeft: 'auto',
  },
}));

// One category, rendered as its own glass card — the same GlassSurface
// treatment (padding, bordered edge) the account and holding cards use, so
// the categories list reads as a vertical stack of cards rather than rows
// inside one shared surface. Inside the card, the shared identity field pairs
// the leading icon (which doubles as the picker toggle) with an inline
// title-rename field, in its caption-free (dense list) mode. The default
// category's card shows a filled star marker in the header's trailing slot
// (SF Symbol `star.fill`, tinted white via `textPrimary`) as a DISABLED
// secondaryTonal Button at the `compact` size — the SAME control shape as the
// "Set as default" star it replaces (it is the catch-all — it is already the
// default), so the two stars line up. Both stars use `compact` (44pt visible
// height) so they align with the fixed 44pt name input beside them
// (HoldingIdentityField's nameField), rather than the shorter 34pt `small`.
// Every other card puts an icon-only "Set as default" affordance
// in that same header slot (a bare OUTLINE `star`, so a non-default card
// previews what picking it will fill in). The labelled destructive delete at the
// card's bottom (a trash icon beside a "Delete" label, confirmed via the native
// action sheet since it moves this category's transactions to the default)
// renders on EVERY card, but is DISABLED on the default card — the default can
// never be deleted, and the disabled control keeps the bottom row's layout
// identical across all cards. Local title state is seeded from the row so
// keystrokes show immediately, while the persisted value flows back through the
// live query.
const CategoryListRow: FC<{
  category: CategoryRow;
  isDefault: boolean;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
}> = ({ category, isDefault, onMoveToTop, onMoveToBottom }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  // Local edit state is the RAW stored title, never the translated display —
  // this is the source of truth `commitTitle` diffs against and persists, so
  // the translated string it is shown as (see `displayTitle` below) can never
  // itself be saved as a rename.
  const [title, setTitle] = useState(category.title);
  // Tracks whether the field currently has focus. While unfocused, an
  // un-renamed default shows its translated label (`resolveDefaultCategoryTitle`
  // is a no-op for a renamed/custom row, so those always show `title`
  // verbatim); the instant the field gains focus — before any keystroke can
  // land — it swaps back to the raw `title` so the user edits (and the field's
  // controlled `value` stays in sync with) the real stored text, not the
  // translated one.
  const [isEditing, setIsEditing] = useState(false);
  const displayTitle = isEditing ? title : resolveDefaultCategoryTitle(category.key, title);
  // The category's EFFECTIVE color: its stored hex when picked, else the
  // stable per-key palette hash — computed once and shared by the row icon
  // and the color picker's ringed swatch, so both always agree on what "this
  // category's color" means.
  const color = resolveCategoryColor(category.color, category.key);

  const startEditingTitle = (): void => setIsEditing(true);

  const commitTitle = (): void => {
    const trimmed = title.trim();

    if (trimmed !== '' && trimmed !== category.title) {
      categoriesRepo.updateTitle(category.key, trimmed);
    }

    setIsEditing(false);
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

  // Delete moves this category's transactions (and any name→category overrides)
  // onto the default category, so it confirms first via the shared native
  // destructive action sheet — the same confirm the deletable grid cards use.
  const confirmDelete = (): void => {
    openDeleteMenu(category.title, () => {
      categoriesRepo.delete(category.key);
    });
  };

  const setAsDefault = (): void => {
    settingsRepo.setDefaultCategoryKey(category.key);
  };

  return (
    <GlassSurface testID="category-card" padding={4} bordered transparent>
      <Box gap={2}>
        <Box direction="row" gap={2} style={styles.header}>
          <Box style={styles.identity}>
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
              iconAccessibilityLabel={t('categories.changeIconLabel', { title: category.title })}
              onSelectIcon={selectIcon}
              name={displayTitle}
              onChangeName={setTitle}
              nameAccessibilityLabel={t('categories.titleFieldLabel', { title: category.title })}
              // Swap to the raw stored title the instant the field gains focus —
              // before any keystroke can land — so what the user actually edits
              // (and what `commitTitle` diffs and persists) is always the raw
              // title, never the translated `displayTitle` above.
              onFocus={startEditingTitle}
              // Commit once on end-of-editing only. `onEndEditing` fires on both a
              // return-key submit and a blur, so a rename that loses focus without
              // pressing return still saves — and it never double-writes the way
              // wiring both `onSubmitEditing` and `onEndEditing` would. It also
              // ends the "editing" window opened by `onFocus` above, so the field
              // reverts to showing the translated `displayTitle` once blurred.
              onEndEditingName={commitTitle}
            />
          </Box>

          {isDefault ? (
            // The default marker is the SAME faint-tint compact Button shape as
            // the set-default star below, but filled (`star.fill`) and disabled so
            // it reads as a static "this is the default" marker while keeping the
            // identical geometry — unifying the two stars into one faint-tinted
            // control. The `compact` size gives it a 44pt visible height that
            // lines up with the fixed 44pt name input beside it.
            <Button
              variant="secondaryTonal"
              size="compact"
              fullWidth={false}
              disabled
              icon="star.fill"
              accessibilityLabel={t('categories.isDefaultLabel', { title: category.title })}
              // A permanently-disabled static marker: the press never fires, so
              // it carries an inert no-op rather than the dead `setAsDefault`.
              onPress={() => {}}
            />
          ) : (
            <Button
              variant="secondaryTonal"
              size="compact"
              fullWidth={false}
              icon="star"
              accessibilityLabel={t('categories.setAsDefaultLabel', { title: category.title })}
              onPress={setAsDefault}
            />
          )}
        </Box>

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
          accessibilityLabelPrefix={t('categories.rowColorPrefix', { title: category.title })}
        />

        {/* The card's bottom row: the labelled destructive Delete on the left
            and the move-to-top / move-to-bottom reorder cluster on the right,
            split by `space-between`. The Delete renders on EVERY card, but is
            disabled on the default card — the default can never be deleted, and
            the disabled control keeps the bottom row's layout identical across
            all cards rather than shifting when the Delete is absent. */}
        <Box direction="row" style={styles.bottomRow}>
          {/* The category Delete REUSES the contributions "Remove" treatment
              (holding-form.screen.tsx): the same tinted-destructive variant, the
              same small size, and the same trash glyph. The destructiveTonal
              variant supplies the red `negative` label itself, so no textColor
              override is needed. Disabled on the default card (it can never be
              deleted) for layout parity across cards. */}
          <Button
            variant="destructiveTonal"
            size="small"
            fullWidth={false}
            disabled={isDefault}
            icon="trash"
            accessibilityLabel={t('categories.deleteLabel', { title: category.title })}
            onPress={confirmDelete}
          >
            {t('common.delete')}
          </Button>

          {/* Move-to-top / move-to-bottom: bare (transparent ghost) icon buttons
              at the row's right edge, kept muted `textSecondary` so they read as
              minor utilities beside the tinted Delete rather than competing with
              it. Each immediately rewrites the whole list order (the parent
              computes the new key array and persists it via
              categoriesRepo.reorder); because the list is a live query, the write
              re-renders it with this card at its new position. These are a
              keyboard-free alternative to the drag-to-reorder gesture the
              enclosing Sortable.Grid provides. `arrow.up.to.line` /
              `arrow.down.to.line` are long-standing SF Symbols (iOS 13+). The
              small size makes them the same height as the small Delete beside
              them; the 44pt tap target is restored via hitSlop. */}
          <Box direction="row" gap={1} style={styles.reorderButtons}>
            <Button
              variant="ghost"
              size="small"
              fullWidth={false}
              icon="arrow.up.to.line"
              textColor={theme.colors.textSecondary}
              accessibilityLabel={t('categories.moveToTopLabel', { title: category.title })}
              onPress={onMoveToTop}
            />

            <Button
              variant="ghost"
              size="small"
              fullWidth={false}
              icon="arrow.down.to.line"
              textColor={theme.colors.textSecondary}
              accessibilityLabel={t('categories.moveToBottomLabel', { title: category.title })}
              onPress={onMoveToBottom}
            />
          </Box>
        </Box>
      </Box>
    </GlassSurface>
  );
};

// Above iOS's text-selection hold threshold, so a long-press inside a card's
// rename TextInput belongs to the text field, not to the grid's drag. Retune
// on-device (see kiko-gestures: gesture thresholds are tuned on hardware, not
// guessed).
const CATEGORY_DRAG_ACTIVATION_MS = 600;

// A pure projection with no closure, hoisted to module scope per
// kiko-code-style's "Helper placement" rule. This ALSO fixes the root cause of
// the flaky category-card backgrounds: `Sortable.Grid`'s underlying item store
// (`react-native-sortables`' `ItemsProvider`/`createItemsStore`) invalidates
// and RE-RENDERS EVERY row — not just the one whose data changed — the moment
// either `keyExtractor` or `renderItem` is a NEW function reference, regardless
// of whether any row's actual data changed (its `apply()` sets
// `rendererChanged = renderItem !== currentRenderer` and treats that alone as
// "every row changed"). An inline arrow literal
// (`keyExtractor={(category) => category.key}`) is a fresh reference on every
// render of `CategoriesScreen` — and this screen re-renders on every category
// mutation anywhere in the list (a rename, an icon pick, a color pick, a
// reorder, a delete — each writes the `categories` table, which re-fires this
// screen's `useLiveQuery`). So editing ONE category's color used to force
// every OTHER unaffected card through a full node recompute too: each
// `GlassSurface` card here renders a real Liquid-Glass material (see
// `glass-surface.component.tsx`) that samples its backdrop from the app's actual
// current visual state — a card that is unnecessarily torn down and rebuilt by
// this churn can resample a transient, not-yet-settled backdrop and paint
// visibly wrong until something else (a drag, a remount) forces a correct
// resample. Hoisting this extractor (it closes over nothing) makes it
// referentially stable forever, the same fix class `renderCategoryRow` below
// applies to `renderItem`.
const categoryKeyExtractor = (category: CategoryRow): string => category.key;

// The Categories settings sub-screen: a live-queried vertical stack of every
// category, each rendered as its own card (matching the account/holding card
// treatment) so it renames its title and re-picks its icon in place. The
// current default category (read from settings) is marked and shielded from
// deletion. The inline add-category affordance renders as the final card.
const CategoriesScreen: FC<CategoriesScreenProps> = () => {
  const { theme } = useUnistyles();
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  // The full current top-to-bottom order, the basis for both reorder buttons.
  // Moving a category to the top (or bottom) rebuilds this array with that key
  // relocated and every other key kept in its existing relative order, then
  // persists it in one write — the live query re-renders the list with the card
  // at its new position, which is the "immediately jump" behavior.
  const orderedKeys = categories.map((category) => category.key);

  // `orderedKeys` is a plain render-scoped value — a fresh array on every
  // render, since `categories` itself is a fresh array on every live-query fire
  // (a write to any one row re-executes the whole `SELECT`, and every row comes
  // back as a brand-new object; see `useLiveQuery`). `moveToTop`/`moveToBottom`
  // read it through this ref rather than closing over it directly, so the two
  // callbacks below can stay referentially STABLE (see `categoryKeyExtractor`'s
  // doc above for why a stable identity here is the actual fix, not a
  // micro-optimization) while still always reordering against the CURRENT
  // list, not a stale snapshot captured at some earlier render.
  const orderedKeysRef = useRef(orderedKeys);
  orderedKeysRef.current = orderedKeys;

  const moveToTop = useCallback((key: string): void => {
    categoriesRepo.reorder([key, ...orderedKeysRef.current.filter((other) => other !== key)]);
  }, []);

  const moveToBottom = useCallback((key: string): void => {
    categoriesRepo.reorder([...orderedKeysRef.current.filter((other) => other !== key), key]);
  }, []);

  // Memoized on the same principle as `categoryKeyExtractor` above: with
  // `moveToTop`/`moveToBottom` now stable and `defaultCategoryKey` changing
  // only when the actual default changes, this function is a stable reference
  // across every render this screen does NOT need to rebuild every card for —
  // so `Sortable.Grid`'s item store only recomputes a row when that row's own
  // data actually changed, instead of on every unrelated edit anywhere in the
  // list.
  const renderCategoryRow = useCallback(
    ({ item }: { item: CategoryRow }) => (
      <CategoryListRow
        category={item}
        isDefault={item.key === defaultCategoryKey}
        onMoveToTop={() => moveToTop(item.key)}
        onMoveToBottom={() => moveToBottom(item.key)}
      />
    ),
    [defaultCategoryKey, moveToTop, moveToBottom],
  );

  // The scroll-mode ScrollView's ref, so expanding the inline add-category form
  // (appended below the last category card) can bring its revealed fields into
  // view.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();

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
        {/* A single-column drag-and-drop stack of category cards, mirroring the
            accounts/holdings grids: a hold-and-move reorders (routed through the
            shared `onGridDragEnd`, which persists only a real move), while a
            quick tap still falls through to a card's own fields. `overDrag`
            keeps a dragged card on its vertical axis; `scrollableRef` +
            `autoScrollActivationOffset` let a drag near an edge scroll the parent
            ScrollView; `sortEnabled` is off with a single category (nothing to
            reorder). Each card also carries move-to-top/bottom buttons for a
            gesture-free reorder. */}
        <Sortable.Grid
          data={categories}
          sortEnabled={categories.length > 1}
          activeItemScale={1.03}
          columns={1}
          overDrag="vertical"
          // Unlike the accounts and holdings grids, EVERY card here contains a
          // live TextInput (the rename field). react-native-sortables' default
          // 200 ms activation is shorter than iOS's own text-selection hold,
          // so a hold meant to place the cursor or open Paste started a card
          // drag instead. A longer delay is preferred over `customHandle`
          // because the other two grids deliberately expose no handle
          // (kiko-gestures) and diverging one screen's interaction model for
          // this would be worse; the cards also already offer gesture-free
          // move-to-top / move-to-bottom buttons.
          dragActivationDelay={CATEGORY_DRAG_ACTIVATION_MS}
          rowGap={theme.spacing(4)}
          scrollableRef={scrollableRef}
          autoScrollActivationOffset={75}
          keyExtractor={categoryKeyExtractor}
          renderItem={renderCategoryRow}
          onDragEnd={({ fromIndex, toIndex, indexToKey }) =>
            onGridDragEnd({ fromIndex, toIndex, indexToKey }, categoriesRepo.reorder)
          }
        />

        <AddCategoryRow onExpand={scrollToAddCategoryForm} />
      </Box>
    </Screen>
  );
};

export default CategoriesScreen;
