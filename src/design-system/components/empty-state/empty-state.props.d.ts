export type EmptyStateAction = {
  label: string;
  icon?: string;
  onPress: () => void;
};

export type EmptyStateProps = {
  // An SF Symbol name.
  icon: string;
  // Sentence case, no final ".".
  title: string;
  // One or two sentences, final ".".
  message: string;
  action?: EmptyStateAction;
  testID?: string;
};
