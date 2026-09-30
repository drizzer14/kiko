import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';

export type HoldingIdentityFieldProps = {
  // The closed pool of SF Symbol names the icon picker offers, forwarded to the
  // shared IconEditor. This field is used by both the entity forms (account /
  // holding → KIKO_ENTITIES_ICONS) and the category rows (→ KIKO_CATEGORIES_ICONS),
  // so each caller passes the pool that matches its flow.
  icons: readonly string[];
  // The holding's currently stored SF Symbol name, or null when it has no
  // custom icon yet (the chip then shows `fallbackIcon`).
  icon: string | null;
  // The type-derived default glyph shown until a custom icon is picked. The
  // create form passes the selected type's default so the icon follows the
  // type while it is not "dirty"; the detail header passes the holding type's
  // default.
  fallbackIcon: string;
  // The name field's current value.
  name: string;
  // Report a name keystroke (the create form commits continuously; the detail
  // header holds it in local state and commits on end-of-editing).
  onChangeName: (text: string) => void;
  // Persist a picked SF Symbol name.
  onSelectIcon: (icon: string) => void;
  // Clear the custom icon back to the fallback. Omit it for a mandatory-icon
  // caller (a category row) so the picker offers no Remove control.
  onRemoveIcon?: () => void;
  // Optional a11y label for the name input (defaults to the catalog's
  // forms.fields.name, 'Name'/'Назва'). The detail header passes
  // `${holding.name} name` so several holdings stay distinct.
  nameAccessibilityLabel?: string;
  // Optional explicit a11y label for the icon-picker toggle, forwarded to the
  // shared IconEditor. A captionless caller (a category row) uses it to keep a
  // descriptive per-row toggle label such as "Change Groceries icon".
  iconAccessibilityLabel?: string;
  // Optional tint color for the icon glyph (the entity's effective color).
  // Forwarded to the shared IconEditor; when set the chip's icon renders in this
  // color instead of the default tone.
  iconColor?: string;
  // Optional commit-on-blur handler. The detail header renames on
  // end-of-editing; the create form commits via onChangeName and omits this.
  onEndEditingName?: () => void;
  // Optional focus handler forwarded to the inner TextInput. A caller that
  // shows a computed display value while unfocused (a category row, which
  // shows a translated label for an un-renamed default) uses this to swap
  // `name` back to the raw editable value the instant focus starts — before
  // any keystroke can land in the field.
  onFocus?: () => void;
  // Optional placeholder shown while the name is empty.
  namePlaceholder?: string;
  // A ref to the inner name TextInput, forwarded to its `ref`. A caller that
  // reveals this field on demand (the inline "Add category" row, which only
  // mounts the field once its form expands) uses this to call `.focus()`
  // imperatively, deferred to the next frame, once the sibling keyboard
  // accessory has registered. Native `autoFocus` is deliberately NOT used for
  // this: it fires `becomeFirstResponder` in the same commit the sibling
  // InputAccessoryView's native content view mounts, and iOS captures
  // `inputAccessoryView` at that exact moment — before the accessory has
  // registered — so the keyboard opens with no Done accessory attached.
  nameInputRef?: RefObject<TextInputInstance | null>;
  // Whether to render the "Icon"/"Name" field captions above the two controls
  // (defaults to true, the form treatment). A dense list row (a category row)
  // passes `false` for a bare, caption-free icon+name pair, vertically centered
  // rather than bottom-aligned.
  captioned?: boolean;
  // When true (and `captioned`), the Name caption shows a red asterisk marking
  // the name as required. Defaults to false. See the shared FieldLabel.
  required?: boolean;
  // The validation-failure message for the NAME field, or `undefined` when
  // valid — same contract as TextField's own `error` (see text-field.props.d.ts).
  // Only takes effect when `captioned` (the form treatment); a bare row never
  // shows a message it can never validate. Renders BELOW the whole icon+name
  // row (REFLOW, not reserve — the reflow error model; see `FieldError`) so
  // the icon never shifts relative to
  // the name field when the message mounts/unmounts.
  error?: string;
  // Optional testID applied to the outer column. When set, the FieldError
  // message (when shown) additionally takes `${testID}-error` — same
  // derived-testID contract as TextField's.
  testID?: string;
};
