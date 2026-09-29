export type NoticeBannerProps = {
  message: string;
  // The button renders only when BOTH are given: a label with no handler would
  // be a dead control, and a handler with no label has nothing to show.
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
};
