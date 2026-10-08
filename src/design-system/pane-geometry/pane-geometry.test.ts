import { resolvePaneGeometry } from '.';

const HAIRLINE = 1;

describe('resolvePaneGeometry', () => {
  it('splits a flat columns window into equal halves around a hairline divider', () => {
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, null, HAIRLINE);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 475, height: 669 });
    expect(geometry.divider).toEqual({ x: 475, y: 0, width: 1, height: 669 });
    expect(geometry.primary).toEqual({ x: 476, y: 0, width: 475, height: 669 });
    expect(geometry.isFolded).toBe(false);
  });

  it('puts the companion on top and the primary at the bottom of a flat rows window', () => {
    const geometry = resolvePaneGeometry('rows', { width: 669, height: 951 }, null, HAIRLINE);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 669, height: 475 });
    expect(geometry.divider).toEqual({ x: 0, y: 475, width: 669, height: 1 });
    expect(geometry.primary).toEqual({ x: 0, y: 476, width: 669, height: 475 });
    expect(geometry.isFolded).toBe(false);
  });

  it('ends the panes at the fold edges in columns and drops the divider', () => {
    const fold = { x: 465, y: 0, width: 21, height: 669 };
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, fold, HAIRLINE);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 465, height: 669 });
    expect(geometry.primary).toEqual({ x: 486, y: 0, width: 465, height: 669 });
    expect(geometry.divider.width).toBe(0);
    expect(geometry.isFolded).toBe(true);
  });

  it('ends the panes at the fold edges in rows and drops the divider', () => {
    const fold = { x: 0, y: 470, width: 669, height: 24 };
    const geometry = resolvePaneGeometry('rows', { width: 669, height: 951 }, fold, HAIRLINE);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 669, height: 470 });
    expect(geometry.primary).toEqual({ x: 0, y: 494, width: 669, height: 457 });
    expect(geometry.divider.height).toBe(0);
    expect(geometry.isFolded).toBe(true);
  });

  it('measured Duo half-open: a centred 40 pt vertical fold gives equal halves', () => {
    const fold = { x: 455.5, y: 0, width: 40, height: 669 };
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, fold, HAIRLINE);

    expect(geometry.companion).toEqual({ x: 0, y: 0, width: 455.5, height: 669 });
    expect(geometry.primary).toEqual({ x: 495.5, y: 0, width: 455.5, height: 669 });
    expect(geometry.isFolded).toBe(true);
  });

  it('keeps an off-centre fold unequal: each pane stops at the fold edge', () => {
    const fold = { x: 300, y: 0, width: 20, height: 669 };
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, fold, HAIRLINE);

    expect(geometry.companion.width).toBe(300);
    expect(geometry.primary).toEqual({ x: 320, y: 0, width: 631, height: 669 });
  });

  it('clamps a fold that overhangs the window so no pane goes negative', () => {
    const fold = { x: 940, y: 0, width: 40, height: 669 };
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, fold, HAIRLINE);

    expect(geometry.companion.width).toBe(940);
    expect(geometry.primary).toEqual({ x: 951, y: 0, width: 0, height: 669 });
  });

  it('clamps a fold that starts before the window', () => {
    const fold = { x: -10, y: 0, width: 20, height: 669 };
    const geometry = resolvePaneGeometry('columns', { width: 951, height: 669 }, fold, HAIRLINE);

    expect(geometry.companion.width).toBe(0);
    expect(geometry.primary.x).toBe(10);
  });
});
