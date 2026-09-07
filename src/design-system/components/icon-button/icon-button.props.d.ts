export type IconButtonProps = {
  // The SF Symbol glyph name to render (see SymbolIcon). An icon-only control:
  // there is no visible label, so pair it with `accessibilityLabel`.
  symbol: string;
  onPress: () => void;
  // Dims to the shared disabled opacity and blocks presses — the same treatment
  // the shared Button uses (see disabled-opacity.ts).
  disabled?: boolean;
  // The accessibility label announced by assistive tech: an icon-only control
  // has no visible text, so this is how it is named.
  accessibilityLabel?: string;
  // An optional test identifier, forwarded onto the underlying pressable.
  testID?: string;
  // The glyph tint. Pass a theme color token, never a raw hex. Left unset, the
  // glyph falls back to SymbolIcon's own default tone (textSecondary).
  tint?: string;
  // The glyph size in points; defaults to the Button icon size (18).
  size?: number;
};
