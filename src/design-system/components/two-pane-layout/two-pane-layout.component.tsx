import type { FC } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFoldRegion, useLayoutMode } from '@kiko/display-regions';
import { resolvePaneGeometry } from '@kiko/design-system/pane-geometry';

import { styles } from './two-pane-layout.styles';
import type { TwoPaneLayoutProps } from './two-pane-layout.props';

// Each pane reserves the safe area on its OUTER sides only, so the side facing the other pane (the
// gap) reserves nothing. Columns: the companion is left, the primary right. Rows: the companion is
// top, the primary bottom.
const COLUMNS_EDGES = {
  companion: ['top', 'left', 'bottom'],
  primary: ['top', 'right', 'bottom'],
} as const;
const ROWS_EDGES = {
  companion: ['top', 'left', 'right'],
  primary: ['left', 'right', 'bottom'],
} as const;

const TwoPaneLayout: FC<TwoPaneLayoutProps> = ({ companion, primary }) => {
  const { theme } = useUnistyles();
  const mode = useLayoutMode();
  const foldRegion = useFoldRegion();
  const window = useWindowDimensions();

  if (mode === 'single') {
    return <>{primary}</>;
  }

  const geometry = resolvePaneGeometry(mode, window, foldRegion, theme.layout.hairline);
  const edges = mode === 'columns' ? COLUMNS_EDGES : ROWS_EDGES;

  return (
    <View style={styles.root} testID="two-pane-root">
      <View style={styles.pane(geometry.companion)} testID="two-pane-companion">
        <SafeAreaView
          edges={edges.companion}
          style={styles.safeArea}
          testID="two-pane-companion-safe-area"
        >
          <View style={styles.content} testID="two-pane-companion-content">
            {companion}
          </View>
        </SafeAreaView>
      </View>
      {!geometry.isFolded && (
        <View style={styles.divider(geometry.divider)} testID="two-pane-divider" />
      )}
      <View style={styles.pane(geometry.primary)} testID="two-pane-primary">
        <SafeAreaView
          edges={edges.primary}
          style={styles.safeArea}
          testID="two-pane-primary-safe-area"
        >
          <View style={styles.content} testID="two-pane-primary-content">
            {primary}
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
};

export default TwoPaneLayout;
