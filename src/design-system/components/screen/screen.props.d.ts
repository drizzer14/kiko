import type { ReactNode, RefObject } from 'react';
import type { ScrollViewInstance } from 'react-native';
import type { AnimatedRef } from 'react-native-reanimated';

export type ScreenProps = {
  children?: ReactNode;
  // A ref to the scroll-mode ScrollView, forwarded to its `ref`. A screen that
  // nests a `react-native-sortables` grid inside this Screen's ScrollView
  // passes the same `useAnimatedRef()` here and to the grid's `scrollableRef`,
  // so a drag near an edge can auto-scroll the parent list (the grid cannot
  // scroll a scrollable it does not hold a ref to). A screen that only needs to
  // scroll the page back to the top (e.g. the active-tab re-tap) passes a plain
  // `useRef<ScrollViewInstance>()` instead — both are just forwarded to the
  // ScrollView's
  // `ref`, which accepts either. Only meaningful in `scroll` mode; ignored
  // otherwise.
  // RN 0.87 split component from instance type: a ScrollView ref holds a
  // `ScrollViewInstance`, not a `ScrollView` (which now names the component).
  scrollableRef?: AnimatedRef<ScrollViewInstance> | RefObject<ScrollViewInstance | null>;
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
  // The plain-branch counterpart of `scroll` for a large-title screen whose
  // child is ITSELF the scrollable surface (a virtualized FlatList/SectionList
  // that must own the scrolling, so it cannot nest inside `scroll` mode's
  // ScrollView). It renders that child as a DIRECT child of the SafeAreaView —
  // NO intermediate padded `content` wrapper — so the child is the scroll view
  // iOS tracks to COLLAPSE the native large title (an interposed wrapper stops
  // the collapse; the working `account-detail` scroll branch is the proven
  // direct-child reference). It also drops the SafeAreaView's top edge, since
  // the large-title header owns the top inset and reserving it here too would
  // double-offset content beneath the header. Because there is no wrapper, the
  // child owns ALL of its own padding: it must set
  // `contentInsetAdjustmentBehavior="automatic"` and supply its own top content
  // padding (for the collapse), its own horizontal padding, AND — the
  // `bleedBottom` contract — its own floating tab-bar bottom clearance via
  // `resolveBottomClearance` when it has no `footer` (e.g. HoldingDetail's
  // ledger FlatList). A `footer` still pins below the child as a sibling with
  // its own clearance. Only meaningful in the plain (non-scroll) branch; ignored
  // in `scroll` mode (which already drops the top edge for its own ScrollView).
  bleedTop?: boolean;
};
