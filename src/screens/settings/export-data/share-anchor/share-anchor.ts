import maybe, { foldMap } from 'fnts/maybe';
import { findNodeHandle, type ViewInstance } from 'react-native';

// `Share.share`'s `url` field needs an actual URL — a BARE filesystem path
// can silently no-op on iOS instead of attaching the file, with no error thrown and no share
// sheet shown. Prefixing the `file://` scheme is the fix; the `startsWith` guard makes this a
// no-op if a caller ever hands in an already-schemed URL.
export const toFileShareUrl = (path: string): string =>
  path.startsWith('file://') ? path : `file://${path}`;

// A regular-width window shows the share sheet as a popover; without an anchor it is a small
// centred card pointing at nothing. A compact window ignores the anchor, so there is no branch on
// the window here.
export const shareAnchorOf = (control: ViewInstance | null): number | undefined =>
  foldMap(maybe(control), (mounted) => findNodeHandle(mounted)) ?? undefined;
