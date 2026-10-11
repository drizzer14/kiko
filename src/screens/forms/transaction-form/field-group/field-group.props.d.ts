import type { TFunction } from 'i18next';
import type { ReactElement, RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import type { HoldingSelectOption } from '@kiko/screens/forms/holding-select-field';

import type { ConvertView } from '../convert-view';

export type FieldGroupProps = {
  converting: boolean;
  convertView: ConvertView;
  counterpartHoldingId: string | null;
  onSelectCounterpart: (id: string) => void;
  onCreateCounterpart: () => void;
  counterpartAmount: string;
  onChangeCounterpartAmount: (text: string) => void;
  isExchange: boolean;
  amount: string;
  onChangeAmount: (text: string) => void;
  // The source holding's currency glyph, shown as the amount/Value-Out field's
  // suffix. Empty when no holding has resolved yet, so no wrong symbol shows.
  amountSuffix: string;
  destinationOptions: HoldingSelectOption[];
  destinationHoldingId: string | null;
  onSelectDestination: (id: string) => void;
  onCreateDestination: () => void;
  valueIn: string;
  onChangeValueIn: (text: string) => void;
  // The destination holding's currency glyph, shown as the Value-In field's
  // suffix. Empty until a destination is picked.
  valueInSuffix: string;
  // The convert group's two currency glyphs: the read-only fixed leg's own
  // currency, and the counterpart leg's currency (empty until one is picked).
  fixedSuffix: string;
  counterpartSuffix: string;
  description: string;
  onChangeDescription: (text: string) => void;
  // Fires when the description field loses focus — the A1 category auto-pick
  // (see `onDescriptionBlur` in the screen). Kept off `onChangeDescription`
  // (which stays a bare setter) so the lookup never runs on a keystroke.
  onBlurDescription: () => void;
  descriptionPlaceholder: string;
  // The inline description-suggestion row, rendered directly under the description field.
  // Null on an edit (an edit already has its description) or whenever there is
  // nothing to suggest — the component hides itself, so this is `ReactElement |
  // null` rather than a boolean gate here.
  descriptionSuggestions: ReactElement | null;
  isReadOnly: boolean;
  time: number;
  onChangeTime: (timestamp: number) => void;
  // The latest day the Date calendar offers: today, because a future-dated row
  // makes Home and the Statistics line disagree until that day arrives.
  maxDate: number;
  t: TFunction;
  // Per-field validation-failure messages and wrapper refs, threaded straight
  // into `ExchangeFields`/`ConvertExchangeFields`'s own props or onto
  // the plain Amount `TextField` — see `fieldError`/`fieldRefsByKey` in the
  // screen component. `undefined` everywhere on a read-only row, where no
  // field ever gates Save.
  amountError?: string;
  // A split payment judged by the returns error, which renders under the
  // return rows instead.
  amountInvalid?: boolean;
  amountFieldRef?: RefObject<FieldInstance | null>;
  // The plain Amount TextField's own inner input, so a blocked Save can
  // focus it imperatively once it has scrolled into view — see `save`'s
  // `onSettled` callback in the screen component. Only the plain (non-
  // exchange, non-converting) Amount field has one; the Exchange/Convert
  // legs are owned by their own sub-components.
  amountInputRef?: RefObject<TextInputInstance | null>;
  valueOutError?: string;
  destinationError?: string;
  valueInError?: string;
  valueOutFieldRef?: RefObject<FieldInstance | null>;
  destinationFieldRef?: RefObject<FieldInstance | null>;
  valueInFieldRef?: RefObject<FieldInstance | null>;
  counterpartError?: string;
  counterpartAmountError?: string;
  counterpartFieldRef?: RefObject<FieldInstance | null>;
  counterpartAmountFieldRef?: RefObject<FieldInstance | null>;
};
