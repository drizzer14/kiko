import {
  PaneContext,
  type PaneName,
  PaneWidthContext,
  paneContextOf,
} from '@kiko/design-system/pane-context';
import {
  belowTopBand,
  type PaneFrame,
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
  isLayer?: boolean;
  children: ReactNode;
};

// A pane that starts below the top-bar band already clears it, so it must not reserve the window's
// top inset a second time: its screens read the inset from the context. The provider is always
// rendered and only its value switches, so a band flip never changes the element type and the
// screens below keep their state. The layer is the window to its screens, which size themselves
// as outside any pane, so it tells them no pane and no width.
const Pane: FC<PaneProps> = ({ mode, pane, width, isBelowTopBand, isLayer = false, children }) => {
  const insets = useSafeAreaInsets();
  const value = useMemo(
    () => (isBelowTopBand ? { ...insets, top: 0 } : insets),
    [insets, isBelowTopBand],
  );

  return (
    <SafeAreaInsetsContext.Provider value={value}>
      <PaneContext.Provider value={isLayer ? null : paneContextOf(mode, pane, isBelowTopBand)}>
        <PaneWidthContext.Provider value={isLayer ? null : width}>
          {children}
        </PaneWidthContext.Provider>
      </PaneContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
};

type LayerProps = Pick<PaneProps, 'mode' | 'isBelowTopBand' | 'children'> & {
  frame: PaneFrame;
  isShown: boolean;
};

// The window over both panes. Its flag-driven props are why the view is never collapsed: a view
// that has no native node one moment and one the next would re-parent the stack inside it. While
// it holds no screen it takes no touch; while it holds one, the screen reader skips its siblings.
const Layer: FC<LayerProps> = ({ mode, frame, isShown, isBelowTopBand, children }) => {
  return (
    <View
      style={styles.pane(frame)}
      pointerEvents={isShown ? undefined : 'none'}
      accessibilityViewIsModal={isShown ? true : undefined}
      collapsable={false}
      testID="two-pane-layer"
    >
      <Pane mode={mode} pane="primary" width={frame.width} isBelowTopBand={isBelowTopBand} isLayer>
        {children}
      </Pane>
    </View>
  );
};

// The pane frames are in window coordinates (useWindowDimensions) and the root is never measured,
// so this must mount at the window origin, at the full window size. It positions the panes and
// nothing else: each pane child fills its frame, so native bars span the pane. It tells each child
// which pane it is in, for the screen content to cap and inset itself. A layer takes the window
// below the band, over both panes, which never change their frame, their screens or their
// context: a pane that moved or was told another size would lay its screens out again.
const TwoPaneLayout: FC<TwoPaneLayoutProps> = ({
  companion,
  primary,
  mode: pinnedMode,
  companionShare,
  layer,
  isLayerShown = false,
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
  // Whether a pane starts below the band: by the move the band made to its frame.
  const isCompanionBelowBand = geometry.companion.y !== flat.companion.y;
  const isPrimaryBelowBand = geometry.primary.y !== flat.primary.y;

  return (
    <View style={styles.root}>
      <View style={styles.pane(geometry.companion)} testID="two-pane-companion">
        <Pane
          mode={mode}
          pane="companion"
          width={geometry.companion.width}
          isBelowTopBand={isCompanionBelowBand}
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
          isBelowTopBand={isPrimaryBelowBand}
        >
          {primary}
        </Pane>
      </View>
      {layer !== undefined && (
        <Layer
          mode={mode}
          frame={wholeWindowFrame(window, band)}
          isShown={isLayerShown}
          isBelowTopBand={band > 0}
        >
          {layer}
        </Layer>
      )}
    </View>
  );
};

export default TwoPaneLayout;
