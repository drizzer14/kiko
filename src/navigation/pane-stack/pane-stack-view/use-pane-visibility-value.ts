import { useMemo } from 'react';
import { useIsFocused } from '@react-navigation/native';

import type { DetailPaneRoute } from '../pane-visibility';

import type { LayerSlice } from './pane-slice';

type PaneVisibilityInput = {
  isSplit: boolean;
  // The layer over both panes, or null when the navigator has none.
  layer: Pick<LayerSlice, 'topKey'> | null;
  companionTopKey: string;
  primaryTopKey: string;
  detailRoute: DetailPaneRoute | null;
};

/**
 * What `PaneVisibilityContext` holds: null in one pane, otherwise the route on top of each pane,
 * or only the top route of the layer while it holds a page. The panes' screens stay mounted under
 * the layer, but only the layer's page is read, so they are paused like a covered screen.
 */
export const usePaneVisibilityValue = ({
  isSplit,
  layer,
  companionTopKey,
  primaryTopKey,
  detailRoute,
}: PaneVisibilityInput) => {
  const isTabFocused = useIsFocused();
  const layerTopKey = layer?.topKey ?? null;

  return useMemo(
    () =>
      isSplit
        ? {
            isTabFocused,
            visibleKeys:
              layerTopKey === null
                ? new Set([companionTopKey, primaryTopKey])
                : new Set([layerTopKey]),
            detailRoute,
          }
        : null,
    [isSplit, isTabFocused, layerTopKey, companionTopKey, primaryTopKey, detailRoute],
  );
};
