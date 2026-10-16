import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { DEFAULT_CATEGORY_SYMBOL } from '@kiko/categories/category-display';
import EntityIconTile from '@kiko/design-system/components/entity-icon-tile';

import { styles } from './category-card.styles';
import type { CategoryCardProps } from './category-card.props';

// One category as a wide row card, the Accounts card's layout: the icon tile and title with the
// rule count under it, and the default star where an account shows its balance. Holding and
// deleting belong to the enclosing grid and `CardContextMenu`, so the card has only a tap.
const CategoryCard: FC<CategoryCardProps> = ({
  title,
  icon,
  color,
  ruleCount,
  isDefault,
  onPress,
}) => {
  const { t } = useTranslation();

  return (
    <Card testID="category-card" padding={4}>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
        <Box direction="row" gap={3} style={styles.rowLead}>
          <EntityIconTile name={icon} color={color} />

          <Box gap={1} style={styles.rowDescription}>
            <Text variant="body">{title}</Text>

            <Text variant="caption" tone="textSecondary">
              {ruleCount === 0
                ? t('categories.noRules')
                : t('categories.rulesCount', { count: ruleCount })}
            </Text>
          </Box>
        </Box>

        {isDefault && (
          <Box style={styles.rowTrailing}>
            <SymbolIcon
              name={DEFAULT_CATEGORY_SYMBOL}
              tone="textSecondary"
              accessibilityLabel={t('categories.default')}
            />
          </Box>
        )}
      </Pressable>
    </Card>
  );
};

export default CategoryCard;
