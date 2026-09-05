import type { ReactNode } from 'react';

// primary  — accent fill, white label: the prominent call-to-action.
// secondary — raised surface fill, white label: a lower-emphasis action that
// still needs a visible pill (e.g. an inline Connect/Disconnect action).
// destructive — red fill, white label: a dangerous action (e.g. Delete).
// ghost — no fill at all, label-only: a borderless nav-bar/header action (e.g.
// the detail screens' Edit button) that must read as plain text-with-icon,
// the standard iOS header-button treatment, never a filled pill.
type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

// regular — a tall (50pt), rounded footer/submit button, the common case.
// compact — a shorter, tighter, self-hugging inline action (e.g. an add/remove
// row control or an icon-adorned Connect/Sync/Save action beside status text).
type ButtonSize = 'regular' | 'compact';

export type ButtonProps = {
  children: ReactNode;
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
  // An explicit accessibility label, used where several buttons share the same
  // visible text and need disambiguating (e.g. "Remove contribution 2").
  accessibilityLabel?: string;
  // An optional label + icon color that overrides the variant's default white —
  // e.g. a `ghost` "Cancel" that must read in the negative (red) tone. Kept a
  // raw color string so the call site passes a theme token (e.g.
  // `theme.colors.negative`); left unset, every variant keeps its white label.
  textColor?: string;
};
