import {
  PaneContext,
  type PaneName,
  PaneWidthContext,
  paneContextOf,
} from '@kiko/design-system/pane-context';
import {
  belowTopBand,
  resolveCompanionShare,
  resolvePaneGeometry,
  wholeWindowFrame,
} from '@kiko/design-system/pane-geometry';
import { useUnistyles } from 'react-native-unistyles';
import { type FC, type ReactNode, useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useFoldRegion, useLayoutMode } from '@kiko/display-regions';
import { useTopBarBand } from '@kiko/design-system/components/screen';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { styles } from './two-pane-layout.styles';
import type { TwoPaneLayoutProps } from './two-pane-layout.props';

type PaneProps = {
  mode: Exclude<NonNullable<TwoPaneLayoutProps['mode']>, 'single'>;
  pane: PaneName;
  width: number;
  isBelowTopBand: boolean;
  isExpanded: boolean;
  children: ReactNode;
};

// A pane that starts below the top-bar band already clears it, so it must not reserve the window's
// top inset a second time: its screens read the inset from the context. The provider is always
// rendered and only its value switches, so a band flip never changes the element type and the
// screens below keep their state. An expanded pane is the window to its screens, which size
// themselves as outside any pane, so it tells them no pane and no width.
const Pane: FC<PaneProps> = ({ mode, pane, width, isBelowTopBand, isExpanded, children }) => {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => (isBelowTopBand ? { ...insets, top: 0 } : insets),
    [insets, isBelowTopBand],
  );

  return (
    <SafeAreaInsetsContext.Provider value={value}>
      <PaneContext.Provider value={isExpanded ? null : paneContextOf(mode, pane, isBelowTopBand)}>
        <PaneWidthContext.Provider value={isExpanded ? null : width}>
          {children}
        </PaneWidthContext.Provider>
      </PaneContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
};

// The pane frames are in window coordinates (useWindowDimensions) and the root is never measured,
// so this must mount at the window origin, at the full window size. It positions the panes and
// nothing else: each pane child fills its frame, so native bars span the pane. It tells each child
// which pane it is in, for the screen content to cap and inset itself. The expanded pane takes the
// window below the band, over the other one, which keeps its frame and its screens but is hidden
// and out of reach: a `display: none` or a zero width would lay it out again and make its screens
// measure themselves anew, and a pane taken out of the tree would lose their state. Each pane view
// is never collapsed away: the hidden pane's opacity and hidden flags would otherwise turn a view
// that has no native node into one on each swap, and re-parent the stack inside it.
const TwoPaneLayout: FC<TwoPaneLayoutProps> = ({
  companion,
  primary,
  mode: pinnedMode,
  companionShare,
  expandedPane = null,
}) => {
  const { theme } = useUnistyles();
  const windowMode = useLayoutMode();
  const mode = pinnedMode ?? windowMode;
  const foldRegion = useFoldRegion();
  const window = useWindowDimensions();
  const band = useTopBarBand();

  if (mode === 'single') {
    return <>{primary}</>;
  }

  const { hairline } = theme.layout;
  const share = resolveCompanionShare(mode, window.width, hairline, companionShare);
  const flat = resolvePaneGeometry(mode, window, foldRegion, hairline, share);
  const geometry = belowTopBand(flat, band);
  const expanded = wholeWindowFrame(window, band);
  const companionFrame = expandedPane === 'companion' ? expanded : geometry.companion;
  const primaryFrame = expandedPane === 'primary' ? expanded : geometry.primary;
  // Whether a pane starts below the band: the expanded one by the band alone, because its frame
  // moves from the pane's place to the window top, and the other by the move the band made.
  const isCompanionBelowBand =
    expandedPane === 'companion' ? band > 0 : geometry.companion.y !== flat.companion.y;
  const isPrimaryBelowBand =
    expandedPane === 'primary' ? band > 0 : geometry.primary.y !== flat.primary.y;

  return (
    <View style={styles.root}>
      <View
        style={[styles.pane(companionFrame), expandedPane === 'primary' && styles.hidden]}
        pointerEvents={expandedPane === 'primary' ? 'none' : undefined}
        accessibilityElementsHidden={expandedPane === 'primary' ? true : undefined}
        collapsable={false}
        testID="two-pane-companion"
      >
        <Pane
          mode={mode}
          pane="companion"
          width={geometry.companion.width}
          isBelowTopBand={isCompanionBelowBand}
          isExpanded={expandedPane === 'companion'}
        >
          {companion}
        </Pane>
      </View>
      {!geometry.isFolded && expandedPane === null && (
        <View
          style={[styles.pane(geometry.divider), styles.dividerColor]}
          testID="two-pane-divider"
        />
      )}
      <View
        style={[styles.pane(primaryFrame), expandedPane === 'companion' && styles.hidden]}
        pointerEvents={expandedPane === 'companion' ? 'none' : undefined}
        accessibilityElementsHidden={expandedPane === 'companion' ? true : undefined}
        collapsable={false}
        testID="two-pane-primary"
      >
        <Pane
          mode={mode}
          pane="primary"
          width={geometry.primary.width}
          isBelowTopBand={isPrimaryBelowBand}
          isExpanded={expandedPane === 'primary'}
        >
          {primary}
        </Pane>
      </View>
    </View>
  );
};

export default TwoPaneLayout;
