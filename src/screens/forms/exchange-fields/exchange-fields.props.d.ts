import type { RefObject } from 'react';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

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
  // Opens the create form from the destination sheet's "Add holding" row, which
  // shows only while `destinationOptions` is empty. Omit it to show no row.
  onCreateDestination?: () => void;
  // The incoming amount, in the destination holding's major currency units.
  valueIn: string;
  onChangeValueIn: (text: string) => void;
  // The destination holding's currency glyph, shown as the Value-In field's
  // suffix. Empty until a destination holding is picked.
  valueInSuffix: string;
  // The transaction's date (unix-millis, local midnight once picked).
  time: number;
  onChangeTime: (timestamp: number) => void;
  // The latest day the Date calendar offers (see DateField's `maxDate`).
  maxDate?: number;
  // Whether the Date and Time row renders. Defaults to true; a template has no date.
  showsDate?: boolean;
  // Whether Value out, To and Value in carry the required marker. Defaults to true; a template
  // asks for none of them.
  required?: boolean;
  // Per-field validation-failure messages, or `undefined` when valid — mirrors
  // TextField's own `error` contract (text-field.props.d.ts): each renders
  // directly under its own field and turns that field's label red, never in
  // the screen's footer.
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
