import {
  PaneContext,
  type PaneName,
  PaneWidthContext,
  paneContextOf,
} from '@kiko/design-system/pane-context';
import { useUnistyles } from 'react-native-unistyles';
import { type FC, type ReactNode, useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useFoldRegion, useLayoutMode } from '@kiko/display-regions';
import { useTopBarBand } from '@kiko/design-system/components/screen';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { EQUAL_SHARE, belowTopBand, resolvePaneGeometry } from '@kiko/design-system/pane-geometry';

import { styles } from './two-pane-layout.styles';
import type { TwoPaneLayoutProps } from './two-pane-layout.props';

type PaneProps = {
  mode: Exclude<NonNullable<TwoPaneLayoutProps['mode']>, 'single'>;
  pane: PaneName;
  width: number;
  isBelowTopBand: boolean;
  children: ReactNode;
};

// A pane that starts below the top-bar band already clears it, so it must not reserve the window's
// top inset a second time: its screens read the inset from the context. The provider is always
// rendered and only its value switches, so a band flip never changes the element type and the
// screens below keep their state.
const Pane: FC<PaneProps> = ({ mode, pane, width, isBelowTopBand, children }) => {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => (isBelowTopBand ? { ...insets, top: 0 } : insets),
    [insets, isBelowTopBand],
  );

  return (
    <SafeAreaInsetsContext.Provider value={value}>
      <PaneContext.Provider value={paneContextOf(mode, pane, isBelowTopBand)}>
        <PaneWidthContext.Provider value={width}>{children}</PaneWidthContext.Provider>
      </PaneContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
};

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
  const band = useTopBarBand();

  if (mode === 'single') {
    return <>{primary}</>;
  }

  const flat = resolvePaneGeometry(mode, window, foldRegion, theme.layout.hairline, EQUAL_SHARE);
  const geometry = belowTopBand(flat, band);

  return (
    <View style={styles.root}>
      <View style={styles.pane(geometry.companion)} testID="two-pane-companion">
        <Pane
          mode={mode}
          pane="companion"
          width={geometry.companion.width}
          isBelowTopBand={geometry.companion.y !== flat.companion.y}
        >
          {companion}
        </Pane>
      </View>
      {!geometry.isFolded && (
        <View
          style={[styles.pane(geometry.divider), styles.dividerColor]}
          testID="two-pane-divider"
        />
      )}
      <View style={styles.pane(geometry.primary)} testID="two-pane-primary">
        <Pane
          mode={mode}
          pane="primary"
          width={geometry.primary.width}
          isBelowTopBand={geometry.primary.y !== flat.primary.y}
        >
          {primary}
        </Pane>
      </View>
    </View>
  );
};

export default TwoPaneLayout;
