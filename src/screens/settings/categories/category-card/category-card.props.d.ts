export type CategoryCardProps = {
  // The title as the user sees it: a seeded default's translated name, any other title as stored.
  title: string;
  icon: string;
  // The category's resolved colour, never a raw stored value.
  color: string;
  ruleCount: number;
  isDefault: boolean;
  onPress: () => void;
};
