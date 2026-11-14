export { useContentCap, usePaneContentWidth, useScrollIndicatorProps } from './use-pane-screen';
/**
 * The pane-aware bottom clearance for a `bleedBottom` child: the hook the pre-write rule
 * `kiko-no-pane-blind-bottom-clearance` names in its fix text, so it stays exported although its
 * only consumer is that rule's good fixture, which knip ignores.
 * @public
 */
export { useBottomClearance } from './use-bottom-clearance';
export {
  useAutomaticScrollClearance,
  useBottomSafeAreaReservation,
  useFloatingFooterBottom,
  useSideBarPlatterInset,
} from './use-bottom-clearance';
export { useContentMargin, useContentMarginFor } from './use-content-margin';
export { useTopBarBand } from './use-top-bar-band';
export { useTabBarPlacement } from './use-tab-bar-placement';
export { useIsTabBarNotAtBottom } from './use-is-tab-bar-not-at-bottom';
export { default } from './screen.component';
