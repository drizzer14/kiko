import { match } from 'ts-pattern';
import type { FoldRegion, LayoutMode } from '@kiko/display-regions';
import { resolvePaneGeometry } from '@kiko/design-system/pane-geometry';

type SheetFrameInput = {
  mode: LayoutMode;
  window: { width: number; height: number };
  fold: FoldRegion;
  hairline: number;
  maxWidth: number;
};

// An absent field means no constraint: full width, uncapped.
export type SheetFrame = { width?: number; left?: number; heightCap?: number };

// The card narrowed to `maxWidth` and centred: across the whole window when it is flat, inside the
// primary pane when a fold is reported, so the card never straddles the hinge.
const centredFrame = (
  mode: Exclude<LayoutMode, 'single'>,
  { window, fold, hairline, maxWidth }: Omit<SheetFrameInput, 'mode'>,
) => {
  const { primary, isFolded } = resolvePaneGeometry(mode, window, fold, hairline);
  const host = isFolded ? primary : { x: 0, width: window.width };
  const width = Math.min(maxWidth, host.width);
  const left = host.x + (host.width - width) / 2;

  return { frame: { width, left }, isFolded, primaryHeight: primary.height };
};

// Where the bottom-sheet card sits. A single window keeps the full-width sheet. A two-pane display
// narrows the card (the iPad form-sheet pattern) and centres it. The card is anchored to the window
// bottom, so a horizontal fold (rows) is crossed by its height rather than its width: that height
// is capped to the bottom pane instead.
export const resolveSheetFrame = ({ mode, ...input }: SheetFrameInput): SheetFrame =>
  match(mode)
    .with('single', (): SheetFrame => ({}))
    .with('columns', (columns) => centredFrame(columns, input).frame)
    .with('rows', (rows) => {
      const { frame, isFolded, primaryHeight } = centredFrame(rows, input);

      return isFolded ? { ...frame, heightCap: primaryHeight } : frame;
    })
    .exhaustive();
