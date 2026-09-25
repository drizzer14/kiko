import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { ActivityIndicator, View } from 'react-native';

import { styles } from './loading-state.styles';
import type { LoadingStateProps } from './loading-state.props';

/**
 * The shared "this screen's own data has not loaded yet" visual: a plain
 * centered native spinner, no text at all — a `useDataReady` consumer
 * (`kiko-architecture`'s useLiveQuery consumer rule) renders this in place
 * of its own empty state (empty list text, empty chart, zero balance)
 * while any of its live queries is still on its first load, and a spinner
 * needs no i18n string, so gating a screen this way never adds one.
 */
const LoadingState: FC<LoadingStateProps> = ({ testID }) => {
  const { theme } = useUnistyles();

  return (
    <View testID={testID} style={styles.container}>
      <ActivityIndicator color={theme.colors.textSecondary} />
    </View>
  );
};

export default LoadingState;
