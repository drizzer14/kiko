import type { ReactNode } from 'react';

// primary  — accent fill, white label: the prominent call-to-action.
// secondary — raised surface fill, white label: a lower-emphasis action that
// still needs a visible pill (e.g. an inline Connect/Disconnect action).
// destructive — red fill, white label: a dangerous action (e.g. Delete).
// destructiveTonal — the iOS "tinted destructive" pattern: a translucent
// dark-red fill (`negativeSubtle`) under a red `negative` label, NOT a solid
// bright fill. A lower-emphasis destructive action (e.g. a per-row Remove) that
// must still read as dangerous without shouting like the solid `destructive`
// pill. The label stays the red hue on a same-hue tint, so — unlike the solid
// variants — it does not follow the `onAccent` rule.
// ghost — no fill at all, label-only: a borderless nav-bar/header action (e.g.
// the detail screens' Edit button) that must read as plain text-with-icon,
// the standard iOS header-button treatment, never a filled pill.
type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'destructiveTonal' | 'ghost';

// regular — a tall (50pt), rounded footer/submit button, the common case.
// compact — a shorter, tighter, self-hugging inline action (e.g. an add/remove
// row control or an icon-adorned Connect/Sync/Save action beside status text).
type ButtonSize = 'regular' | 'compact';

// Everything a Button takes EXCEPT the label/accessibility pair, which the
// two branches below constrain against each other.
type ButtonBaseProps = {
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  // Defaults to `true` — stretches to the container's width, the common case
  // for a screen footer or form submit. Set `false` for an inline button
  // (usually paired with `size="compact"`).
  fullWidth?: boolean;
  disabled?: boolean;
  // An optional leading SF Symbol name, rendered before the label in a row and
  // tinted to match the variant's white label — the button owns the icon tint
  // so a call site cannot desync it from the label.
  icon?: string;
  // An optional trailing SF Symbol name, rendered after the label in the same
  // row — e.g. the header Edit button's pencil glyph. Tinted the same way as
  // `icon`, for the same desync-proofing reason.
  trailingIcon?: string;
  // An optional test identifier, forwarded onto the underlying pressable so a
  // test (or an analytics selector) can target this specific button.
  testID?: string;
  // An optional label + icon color that overrides the variant's default white —
  // e.g. a `ghost` "Cancel" that must read in the negative (red) tone. Kept a
  // raw color string so the call site passes a theme token (e.g.
  // `theme.colors.negative`); left unset, every variant keeps its white label.
  textColor?: string;
};

// A labelled button: the visible text IS the accessible name, so
// `accessibilityLabel` is optional (pass it only to disambiguate buttons that
// share the same visible text, e.g. "Remove contribution 2").
type LabelledButtonProps = ButtonBaseProps & {
  children: ReactNode;
  accessibilityLabel?: string;
};

// An icon-only button: no `children`, so there is no visible text for
// VoiceOver — `accessibilityLabel` is therefore REQUIRED. The discriminated
// union makes `<Button icon="star" onPress={...} />` with no label a COMPILE
// error (the categories set-default/reorder ghost buttons are this shape).
type IconOnlyButtonProps = ButtonBaseProps & {
  children?: undefined;
  accessibilityLabel: string;
};

export type ButtonProps = LabelledButtonProps | IconOnlyButtonProps;
