// Mirrors Text's tone union (see text.props.ts).
type SymbolTone = 'positive' | 'negative' | 'textPrimary' | 'textSecondary';

export type SymbolProps = {
  name: string;
  size?: number;
  tone?: SymbolTone;
  accessibilityLabel?: string;
};
