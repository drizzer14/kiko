import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { useWindowDimensions, View } from 'react-native';
import { useFoldRegion, useLayoutMode } from '@kiko/display-regions';
import { resolvePaneGeometry } from '@kiko/design-system/pane-geometry';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import { styles } from './two-pane-layout.styles';
import type { TwoPaneLayoutProps } from './two-pane-layout.props';

// The pane frames are in window coordinates (useWindowDimensions) and the root is never measured,
// so this must mount at the window origin, at the full window size. It positions the panes and
// nothing else: each pane child fills its frame, so native bars span the pane. It tells each child
// which pane it is in, for the screen content to cap and inset itself.
const TwoPaneLayout: FC<TwoPaneLayoutProps> = ({ companion, primary, mode: pinnedMode }) => {
  const { theme } = useUnistyles();
  const windowMode = useLayoutMode();
  const mode = pinnedMode ?? windowMode;
  const foldRegion = useFoldRegion();
  const window = useWindowDimensions();

  if (mode === 'single') {
    return <>{primary}</>;
  }

  const geometry = resolvePaneGeometry(mode, window, foldRegion, theme.layout.hairline);

  return (
    <View style={styles.root}>
      <View style={styles.pane(geometry.companion)} testID="two-pane-companion">
        <PaneContext.Provider value={paneContextOf(mode, 'companion')}>
          {companion}
        </PaneContext.Provider>
      </View>
      {!geometry.isFolded && (
        <View
          style={[styles.pane(geometry.divider), styles.dividerColor]}
          testID="two-pane-divider"
        />
      )}
      <View style={styles.pane(geometry.primary)} testID="two-pane-primary">
        <PaneContext.Provider value={paneContextOf(mode, 'primary')}>
          {primary}
        </PaneContext.Provider>
      </View>
    </View>
  );
};

export default TwoPaneLayout;
