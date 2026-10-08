export type TipCardProps = {
  message: string;
  // The accessibility label of the icon-only close button.
  closeLabel: string;
  onClose: () => void;
  testID?: string;
};
