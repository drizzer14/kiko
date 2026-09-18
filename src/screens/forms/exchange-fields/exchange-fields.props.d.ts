import type { RefObject } from 'react';

import type { FieldInstance } from '../scroll-to-field';
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
  // Per-field validation-failure messages, or `undefined` when valid — mirrors
  // TextField's own `error` contract (text-field.props.d.ts). `destinationError`
  // has no matching border (HoldingSelectField is a picker trigger, not a
  // TextField) but still renders directly under its own field, never in the
  // screen's footer.
  valueOutError?: string;
  destinationError?: string;
  valueInError?: string;
  // Optional refs to each field's own wrapping View, so a caller (transaction-
  // form) can scroll to whichever one is first invalid — see scroll-to-field.ts.
  // Omitted by every caller that doesn't need scroll-to-invalid.
  valueOutFieldRef?: RefObject<FieldInstance | null>;
  destinationFieldRef?: RefObject<FieldInstance | null>;
  valueInFieldRef?: RefObject<FieldInstance | null>;
};
