import type { ShareListing, ShareSearchResult } from '@kiko/prices/share-search';

export type ShareSearchSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  // One EODHD call per press of Search, never per keystroke: every call
  // counts against the user's own daily limit.
  search: (query: string) => Promise<ShareSearchResult>;
  onPick: (listing: ShareListing) => void;
};
