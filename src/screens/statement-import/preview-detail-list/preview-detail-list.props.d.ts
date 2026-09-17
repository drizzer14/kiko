export type PreviewDetailListProps = {
  /** Each string renders as its own text line, in the given order. */
  items: string[];
  /** An optional heading line rendered above `items` (e.g. "This file
   * contains multiple currencies:") — omitted entirely when absent, rather
   * than reserving empty space for it. */
  label?: string;
  testID?: string;
};
