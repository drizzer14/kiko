import type { ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary';

export type ButtonProps = {
  children: ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  // Defaults to `true` — stretches to the container's width, the common case
  // for a screen footer or form submit. Set `false` for an inline button.
  fullWidth?: boolean;
  disabled?: boolean;
};
