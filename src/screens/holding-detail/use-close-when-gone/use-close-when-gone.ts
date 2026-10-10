import { useEffect } from 'react';
import type { HoldingRow } from '@kiko/db';
import { useClosePaneRoute } from '@kiko/navigation/pane-stack';
import { usePaneContext } from '@kiko/design-system/pane-context';

type CloseWhenGoneInput = {
  routeKey: string;
  // The holdings read was made by this mount, not taken from the cache: a cached or deferred read
  // can be one write old, and a page is judged gone only by a read that cannot be. A read that has
  // not landed yet is not fresh either.
  isFresh: boolean;
  holding: HoldingRow | undefined;
};

/**
 * Closes this page when its holding is deleted while another screen of the other pane (the account
 * page's grid, say) is still on screen to delete it. Beside the Accounts list, which only watches
 * the primary pane, a page in the companion pane would otherwise stay on a holding that is gone.
 * On one pane the page is the whole screen and its own delete leads back, so nothing closes.
 */
export const useCloseWhenGone = ({ routeKey, isFresh, holding }: CloseWhenGoneInput): void => {
  const isInPane = usePaneContext() !== null;
  const closePaneRoute = useClosePaneRoute();
  const isGone = isInPane && isFresh && holding === undefined;

  useEffect(() => {
    if (isGone) {
      closePaneRoute(routeKey);
    }
  }, [isGone, closePaneRoute, routeKey]);
};
