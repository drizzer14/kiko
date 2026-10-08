import type { FC } from 'react';
import { View } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import SymbolIcon from '@kiko/design-system/components/symbol';

import { styles } from './empty-state.styles';
import type { EmptyStateProps } from './empty-state.props';

// Apple's ContentUnavailableView pattern: a centered glyph, a headline, an
// explanatory line, then an optional primary action. It sits directly on the
// screen, no card or glass surface. The headline is a semibold `body`, not the
// `heading` variant, because it is sentence case rather than a title-case heading.
const EmptyState: FC<EmptyStateProps> = ({ icon, title, message, action, testID }) => {
  const { theme } = useUnistyles();
  const iconTestID = foldMap(maybe(testID), (value) => `${value}-icon`);
  const actionTestID = foldMap(maybe(testID), (value) => `${value}-action`);

  return (
    <View style={styles.container} testID={testID}>
      <SymbolIcon
        name={icon}
        size={theme.iconSizes.display}
        tone="textSecondary"
        testID={iconTestID}
      />

      <Text variant="body" tone="textPrimary" style={styles.title}>
        {title}
      </Text>

      <Text variant="caption" tone="textSecondary" style={styles.message}>
        {message}
      </Text>

      {foldMap(maybe(action), (resolved) => (
        <View style={styles.action}>
          <Button
            variant="primary"
            fullWidth={false}
            icon={resolved.icon}
            onPress={resolved.onPress}
            testID={actionTestID}
          >
            {resolved.label}
          </Button>
        </View>
      ))}
    </View>
  );
};

export default EmptyState;
