import maybe, { foldMap } from 'fnts/maybe';
import { findNodeHandle, type ViewInstance } from 'react-native';

// A regular-width window shows the share sheet as a popover; without an anchor it is a small
// centred card pointing at nothing. A compact window ignores the anchor, so there is no branch on
// the window here.
export const shareAnchorOf = (control: ViewInstance | null): number | undefined =>
  foldMap(maybe(control), (mounted) => findNodeHandle(mounted)) ?? undefined;
