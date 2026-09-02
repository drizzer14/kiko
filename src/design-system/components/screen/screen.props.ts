import type { ReactNode } from 'react';

export type ScreenProps = {
  children?: ReactNode;
  // Opt-in scroll mode for a large-title screen: the native large title needs
  // a scrollable content root (`contentInsetAdjustmentBehavior="automatic"`)
  // to measure and collapse correctly. Defaults to `false`, preserving the
  // existing SafeAreaView + View behavior for every other screen.
  scroll?: boolean;
  // A node pinned outside the ScrollView, inside the bottom safe-area edge —
  // e.g. a primary action button that must stay reachable while long content
  // scrolls beneath it (a ScrollView itself cannot pin a footer). Only
  // meaningful in `scroll` mode; ignored otherwise.
  footer?: ReactNode;
};
