import type { ReactNode } from 'react';

export type ScreenProps = {
  children?: ReactNode;
  // Opt-in scroll mode for a large-title screen: the native large title needs
  // a scrollable content root (`contentInsetAdjustmentBehavior="automatic"`)
  // to measure and collapse correctly. Defaults to `false`, preserving the
  // existing SafeAreaView + View behavior for every other screen.
  scroll?: boolean;
  // A node pinned to the screen's true bottom edge, inside the bottom
  // safe-area edge — e.g. a primary action button that must stay reachable
  // no matter whether the page's content scrolls. In `scroll` mode it sits
  // outside the ScrollView (which itself cannot pin a footer); in the plain
  // (non-scroll) branch it sits as a sibling below `content`, which takes
  // `flex: 1` so the footer is pushed to the bottom even on a short page
  // instead of floating directly beneath the content.
  footer?: ReactNode;
  // Opt out of the plain (non-scroll) branch's own bottom tab-bar clearance
  // because the screen's child is itself the scrollable surface and applies
  // that clearance to its own content (e.g. Home's SectionList). Without this,
  // both Screen's `content` and the child's list padding would reserve the
  // clearance and the gap below the last row would be counted twice. Only
  // meaningful in the plain (non-scroll) branch when there is no `footer`
  // (which already claims the bottom edge on its own); ignored in `scroll`
  // mode.
  bleedBottom?: boolean;
};
