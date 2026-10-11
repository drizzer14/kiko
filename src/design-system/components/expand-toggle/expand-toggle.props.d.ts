export type ExpandToggleProps = {
  expanded: boolean;
  onPress: () => void;
  // The chevron takes `${testID}-chevron`.
  testID?: string;
};
