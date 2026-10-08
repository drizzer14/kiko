export type EntityIconTileProps = {
  // The SF Symbol name — same contract as SymbolIcon's own `name`.
  name: string;
  // The entity's resolved effective color (see `resolveEntityColor`,
  // `design-system/entity-tint/entity-tint.ts`) — always an already-resolved hex, never a
  // raw stored/nullable value. The tile derives its gradient from this same
  // hex via `entityIconTileGradient`.
  color: string;
  accessibilityLabel?: string;
  // An explicit glyph size, mirroring SymbolIcon's own optional `size` (see
  // symbol.props.d.ts) — omit to fall back to the `body` icon-size token.
  size?: number;
  // One spacing step smaller tile (32pt instead of 36pt); the glyph keeps
  // `size`. Omit for the card tile.
  compact?: boolean;
};
