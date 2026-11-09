export type ExpandToggleProps = {
  expanded: boolean;
  onPress: () => void;
  // Says what a collapsed toggle hides, in place of "Show all"; expanded still says "Show less".
  collapsedLabel?: string;
  // The chevron takes `${testID}-chevron`.
  testID: string;
};
