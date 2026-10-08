export type ReminderOfferCardProps = {
  message: string;
  acceptLabel: string;
  dismissLabel: string;
  onAccept: () => void;
  onDismiss: () => void;
  testID?: string;
};
