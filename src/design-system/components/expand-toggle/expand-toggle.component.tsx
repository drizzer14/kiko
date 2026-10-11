import type { FC } from 'react';
import { Pressable } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './expand-toggle.styles';
import type { ExpandToggleProps } from './expand-toggle.props';

// The toggle's caption line plus its own padding sits below the 44pt floor; it has no
// neighbouring target within reach, so vertical hitSlop restores it.
const TOGGLE_HIT_SLOP = { top: 10, bottom: 10 } as const;

/**
 * The one "Show all" / "Show less" link that expands or collapses a bounded list: the pie
 * legend, the statement-import raw preview, and the loan's upcoming payments share it.
 */
const ExpandToggle: FC<ExpandToggleProps> = ({ expanded, onPress, testID }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      hitSlop={TOGGLE_HIT_SLOP}
      onPress={onPress}
      style={styles.toggle}
      testID={testID}
    >
      <Box direction="row" gap={1} style={styles.toggleContent}>
        <Text variant="caption" tone="accent">
          {expanded ? t('components.pieChart.showLess') : t('components.pieChart.showAll')}
        </Text>

        <SymbolIcon
          testID={foldMap(maybe(testID), (id) => `${id}-chevron`)}
          name={expanded ? 'chevron.up' : 'chevron.down'}
          tone="accent"
          size={theme.iconSizes.caption}
        />
      </Box>
    </Pressable>
  );
};

export default ExpandToggle;
