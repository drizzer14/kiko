type CategoryOption = {
  key: string;
  // The title as the user sees it: a seeded default's translated name, any other title as stored.
  title: string;
  icon: string;
  // The category's resolved colour, never a raw stored value.
  color: string;
};

export type CategoryOptionsSheetProps = {
  visible: boolean;
  options: readonly CategoryOption[];
  onSelect: (categoryKey: string) => void;
  onDismiss: () => void;
  // The sheet has finished closing, whether a category was picked or not.
  onClosed: () => void;
};
