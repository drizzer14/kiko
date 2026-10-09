import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { useWindowDimensions, View } from 'react-native';
import { useFoldRegion, useLayoutMode } from '@kiko/display-regions';
import { resolvePaneGeometry } from '@kiko/design-system/pane-geometry';

import { styles } from './two-pane-layout.styles';
import type { TwoPaneLayoutProps } from './two-pane-layout.props';

// The pane frames are in window coordinates (useWindowDimensions) and the root is never measured,
// so this must mount at the window origin, at the full window size. It positions the panes and
// nothing else: each pane child fills its frame, so native bars span the pane.
const TwoPaneLayout: FC<TwoPaneLayoutProps> = ({ companion, primary }) => {
  const { theme } = useUnistyles();
  const mode = useLayoutMode();
  const foldRegion = useFoldRegion();
  const window = useWindowDimensions();

  if (mode === 'single') {
    return <>{primary}</>;
  }

  const geometry = resolvePaneGeometry(mode, window, foldRegion, theme.layout.hairline);

  return (
    <View style={styles.root}>
      <View style={styles.pane(geometry.companion)} testID="two-pane-companion">
        {companion}
      </View>
      {!geometry.isFolded && (
        <View
          style={[styles.pane(geometry.divider), styles.dividerColor]}
          testID="two-pane-divider"
        />
      )}
      <View style={styles.pane(geometry.primary)} testID="two-pane-primary">
        {primary}
      </View>
    </View>
  );
};

export default TwoPaneLayout;
