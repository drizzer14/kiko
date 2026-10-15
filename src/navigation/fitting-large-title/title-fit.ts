// A wrapped title is at least two lines tall, so any height under one and a half lines is a
// single line (a line's rounding never reaches half a line).
const SINGLE_LINE_RATIO = 1.5;

/**
 * Whether the title measured `titleHeight` tall, wrapped at the available width, is one line of
 * `lineHeight`. A measurement that is not a usable number counts as fitting, so a failed
 * measurement keeps the native large title.
 */
export const titleFits = (titleHeight: number, lineHeight: number): boolean => {
  const usable = Number.isFinite(titleHeight) && Number.isFinite(lineHeight) && lineHeight > 0;

  return !usable || titleHeight < lineHeight * SINGLE_LINE_RATIO;
};

type GlyphClass = { pattern: RegExp; em: number };

// Each glyph is a share of the font size ("em") for SF Pro Bold: a rough class table, not
// a font metric. The first matching class wins.
const GLYPH_CLASSES: readonly GlyphClass[] = [
  { pattern: /\s/u, em: 0.26 },
  { pattern: /[ijlfrtIІіЇї.,:;!'’|]/u, em: 0.32 },
  { pattern: /[mwMWмМжшщфюЖШЩФЮ]/u, em: 0.86 },
  { pattern: /\p{Lu}/u, em: 0.68 },
];

const DEFAULT_GLYPH_EM = 0.58;

// The estimate is within about 10 percent of the real width, so a title is only called too
// long when it is clearly over the line; the layout measurement settles the titles near it.
const ESTIMATE_TOLERANCE = 1.15;

const glyphEm = (glyph: string): number =>
  GLYPH_CLASSES.find(({ pattern }) => pattern.test(glyph))?.em ?? DEFAULT_GLYPH_EM;

/** The width of `title` on one line, estimated from the glyph classes. */
export const estimateTitleWidth = (title: string, fontSize: number): number =>
  [...title].reduce((width, glyph) => width + glyphEm(glyph) * fontSize, 0);

/**
 * A cautious first-render guess of whether `title` fits one line of `availableWidth`: it errs
 * towards "fits" (today's native look), and only a clearly over-long title starts as a heading.
 * A width of nothing or less is no line to wrap in (a window not laid out yet), so it fits.
 */
export const estimatedTitleFits = (
  title: string,
  availableWidth: number,
  fontSize: number,
): boolean =>
  availableWidth <= 0 || estimateTitleWidth(title, fontSize) <= availableWidth * ESTIMATE_TOLERANCE;
