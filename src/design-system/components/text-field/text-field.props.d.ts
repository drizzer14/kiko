import type { RefObject } from 'react';
import type { TextInputInstance, TextInputProps } from 'react-native';

export type TextFieldProps = Pick<
  TextInputProps,
  | 'placeholder'
  | 'keyboardType'
  // Optional. When omitted, a field with a return key defaults to `done`; a
  // caller passing its own (e.g. `search`) is never overridden, and a
  // return-keyless numeric keyboard is left without one.
  | 'returnKeyType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'multiline'
  // Masks the input (a secret like the Monobank token). Off by default, so an
  // ordinary field is never masked unless the caller opts in.
  | 'secureTextEntry'
  // Optional. Fires when the field loses focus — used where a lookup should run
  // only once the user has settled the value (e.g. pre-selecting a transaction
  // category from a matched description on blur), never on every keystroke.
  // Omitted by default, so an ordinary field carries no blur behavior.
  | 'onBlur'
> & {
  // Optional. When omitted, no caption renders above the input — used where a
  // surrounding heading already names the field (e.g. the CurrencyField search
  // box, sitting under the sheet's own heading). The placeholder then carries
  // the field's hint, and the accessible name falls back to the placeholder.
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  // When true, the label shows a red asterisk marking the field as required.
  // Defaults to false. See the shared FieldLabel for the marker treatment.
  required?: boolean;
  // Defaults to `true`. Set `false` to render the field read-only — see
  // text-field.styles.ts for the disabled visual treatment.
  editable?: boolean;
  // Defaults to `label` so a caller only needs to override it when the
  // visible label isn't descriptive enough for a screen reader on its own.
  accessibilityLabel?: string;
  // A short trailing string rendered inside the field, after the input, in a
  // muted tone — a money field passes its currency glyph here so a value reads
  // as "100.00 ₴". Optional and empty-safe: `undefined` (or an empty string,
  // e.g. a currency not yet known) renders exactly as a plain field with no
  // trailing node.
  suffix?: string;
  // An SF Symbol rendered inside the field, before the input, in a muted tone —
  // the currency search box passes `magnifyingglass` so it reads as a search
  // field. Optional and empty-safe: `undefined` (or an empty string) renders
  // exactly as a plain field with no leading glyph.
  leadingIcon?: string;
  // The validation-failure message for this field, or `undefined` when it's
  // currently valid. When set, the shared FieldError message renders directly
  // under the input and the field's own label tints negative — REFLOW, not
  // reserve: there is no reserved-height slot, so a valid field takes no
  // extra space (the reflow error model — no per-field outline, see
  // text-field.component.tsx's own doc comment). There is no separate
  // `invalid` boolean: a defined `error` IS the invalid signal.
  error?: string;
  // A ref to the inner TextInput, forwarded to its `ref`. A validated form
  // field passes this (alongside its own measurement-only wrapper ref used
  // by `scrollToField`) so a blocked Save press can call `.focus()`
  // imperatively once the invalid field has scrolled into view — the same
  // pattern HoldingIdentityField's own `nameInputRef` already established.
  inputRef?: RefObject<TextInputInstance | null>;
  // Optional testID applied to the field's outer Box. When set, the
  // FieldError message (when shown) additionally takes `${testID}-error`.
  testID?: string;
};
