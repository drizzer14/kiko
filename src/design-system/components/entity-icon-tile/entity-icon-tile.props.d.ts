export type EntityIconTileProps = {
  // The SF Symbol name — same contract as SymbolIcon's own `name`.
  name: string;
  // The entity's resolved effective color (see `resolveEntityColor`,
  // `design-system/entity-tint.ts`) — always an already-resolved hex, never a
  // raw stored/nullable value. The tile derives its gradient from this same
  // hex via `entityIconTileGradient`; when the squircle-gradient experiment is
  // off, it is passed straight through to `SymbolIcon`'s own `color`, exactly
  // as every call site did before this component existed.
  color: string;
  accessibilityLabel?: string;
  // An explicit glyph size, mirroring SymbolIcon's own optional `size` (see
  // symbol.props.d.ts) — omit to fall back to the `body` icon-size token.
  size?: number;
};
