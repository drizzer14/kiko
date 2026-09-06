import type { HoldingSelectOption } from '../holding-select-field/holding-select-field.props';

export type ExchangeFieldsProps = {
  // The outgoing amount, in the source holding's major currency units.
  valueOut: string;
  onChangeValueOut: (text: string) => void;
  // The source holding's currency glyph, shown as the Value-Out field's suffix.
  valueOutSuffix: string;
  // Every eligible destination holding (open, non-source, non-bond/jar) —
  // built by the screen's `buildDestinationOptions`.
  destinationOptions: readonly HoldingSelectOption[];
  destinationHoldingId: string | null;
  onSelectDestination: (id: string) => void;
  // The incoming amount, in the destination holding's major currency units.
  valueIn: string;
  onChangeValueIn: (text: string) => void;
  // The destination holding's currency glyph, shown as the Value-In field's
  // suffix. Empty until a destination holding is picked.
  valueInSuffix: string;
  // The transaction's date (unix-millis, local midnight once picked).
  time: number;
  onChangeTime: (timestamp: number) => void;
};
