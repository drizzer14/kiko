import type { ReactNode } from 'react';

// primary  — accent fill, white label: the prominent call-to-action.
// secondary — raised surface fill, accent label: a lower-emphasis action.
// destructive — red fill, white label: a dangerous action (e.g. Delete).
type ButtonVariant = 'primary' | 'secondary' | 'destructive';

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
  // tinted to match the variant's label color (white for primary/destructive,
  // accent for secondary) — the button owns the icon tint so a call site cannot
  // desync it from the label.
  icon?: string;
  // An explicit accessibility label, used where several buttons share the same
  // visible text and need disambiguating (e.g. "Remove contribution 2").
  accessibilityLabel?: string;
};
