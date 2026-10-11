import type { FoldRegion, LayoutMode } from '@kiko/display-regions';
import { resolvePaneGeometry } from '@kiko/design-system/pane-geometry';

type SheetFrameInput = {
  mode: LayoutMode;
  window: { width: number; height: number };
  fold: FoldRegion;
  hairline: number;
  maxWidth: number;
};

// An absent field leaves the card as it was: full width, uncapped.
export type SheetFrame = { width?: number; left?: number; heightCap?: number };

// Where the bottom-sheet card sits. A single window keeps the full-width sheet. A two-pane display
// narrows the card to `maxWidth` (the iPad form-sheet pattern) and centres it: across the whole
// window when it is flat, inside the primary pane when a fold is reported, so the card never
// straddles the hinge. The card is anchored to the window bottom, so a horizontal fold (rows) is
// crossed by its height rather than its width: that height is capped to the bottom pane instead.
export const resolveSheetFrame = ({
  mode,
  window,
  fold,
  hairline,
  maxWidth,
}: SheetFrameInput): SheetFrame => {
  if (mode === 'single') {
    return {};
  }

  const { primary, isFolded } = resolvePaneGeometry(mode, window, fold, hairline);
  const host = isFolded ? primary : { x: 0, width: window.width };
  const width = Math.min(maxWidth, host.width);
  const left = host.x + (host.width - width) / 2;

  return mode === 'rows' && isFolded ? { width, left, heightCap: primary.height } : { width, left };
};
