import { match } from 'ts-pattern';
import { EQUAL_SHARE, resolvePaneGeometry } from '@kiko/design-system/pane-geometry';
import type { FoldRegion, HorizontalSizeClass, LayoutMode } from '@kiko/display-regions';

type SheetFrameInput = {
  mode: LayoutMode;
  sizeClass: HorizontalSizeClass;
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
  { window, fold, hairline, maxWidth }: Omit<SheetFrameInput, 'mode' | 'sizeClass'>,
) => {
  const { primary, isFolded } = resolvePaneGeometry(mode, window, fold, hairline, EQUAL_SHARE);
  const host = isFolded ? primary : { x: 0, width: window.width };
  const width = Math.min(maxWidth, host.width);
  const left = host.x + (host.width - width) / 2;

  return { frame: { width, left }, isFolded, primaryHeight: primary.height };
};

// A single window on a regular size class is as wide as a split one, so its card is narrowed and
// centred in the whole window like a flat split window's. A compact window (an iPhone, the Duo's
// outer display) keeps the full-width sheet.
const singleFrame = (
  sizeClass: HorizontalSizeClass,
  { window, maxWidth }: Pick<SheetFrameInput, 'window' | 'maxWidth'>,
): SheetFrame =>
  match(sizeClass)
    .with('compact', (): SheetFrame => ({}))
    .with('regular', (): SheetFrame => {
      const width = Math.min(maxWidth, window.width);

      return { width, left: (window.width - width) / 2 };
    })
    .exhaustive();

// Where the bottom-sheet card sits. A single compact window keeps the full-width sheet. A regular
// window, single or two-pane, narrows the card (the iPad form-sheet pattern) and centres it. The
// card is anchored to the window bottom, so a horizontal fold (rows) is crossed by its height
// rather than its width: that height is capped to the bottom pane instead.
export const resolveSheetFrame = ({ mode, sizeClass, ...input }: SheetFrameInput): SheetFrame =>
  match(mode)
    .with('single', (): SheetFrame => singleFrame(sizeClass, input))
    .with('columns', (columns) => centredFrame(columns, input).frame)
    .with('rows', (rows) => {
      const { frame, isFolded, primaryHeight } = centredFrame(rows, input);

      return isFolded ? { ...frame, heightCap: primaryHeight } : frame;
    })
    .exhaustive();
