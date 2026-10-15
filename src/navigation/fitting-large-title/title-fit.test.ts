import { estimatedTitleFits, estimateTitleWidth, titleFits } from './title-fit';

const LINE_HEIGHT = 41;

describe('titleFits', () => {
  it('fits when the title is one line tall', () => {
    expect(titleFits(LINE_HEIGHT, LINE_HEIGHT)).toBe(true);
  });

  it('fits when the title is a little under one and a half lines tall', () => {
    expect(titleFits(LINE_HEIGHT * 1.5 - 1, LINE_HEIGHT)).toBe(true);
  });

  it('does not fit once the title is one and a half lines tall or taller', () => {
    expect(titleFits(LINE_HEIGHT * 1.5, LINE_HEIGHT)).toBe(false);
    expect(titleFits(LINE_HEIGHT * 2, LINE_HEIGHT)).toBe(false);
  });

  it.each([
    ['a zero line height', 82, 0],
    ['a negative line height', 82, -41],
    ['a line height that is not a number', 82, Number.NaN],
    ['a title height that is not a number', Number.NaN, LINE_HEIGHT],
    ['an infinite title height', Number.POSITIVE_INFINITY, LINE_HEIGHT],
  ])('counts %s as fitting, so the native large title stays', (_name, height, line) => {
    expect(titleFits(height, line)).toBe(true);
  });
});

describe('estimateTitleWidth', () => {
  it.each([
    ['a lowercase Latin letter', 'a', 58],
    ['a lowercase Cyrillic letter', 'а', 58],
    ['a digit', '7', 58],
    ['a narrow Latin letter', 'i', 32],
    ['a narrow Ukrainian letter', 'і', 32],
    ['a comma', ',', 32],
    ['a space', ' ', 26],
    ['an uppercase Latin letter', 'E', 68],
    ['an uppercase Cyrillic letter', 'Р', 68],
    ['a wide Latin letter', 'm', 86],
    ['a wide capital', 'W', 86],
    ['a wide Cyrillic letter', 'ж', 86],
  ])('measures %s as its share of the font size', (_name, text, hundredths) => {
    expect(estimateTitleWidth(text, 100)).toBeCloseTo(hundredths, 5);
  });

  it('adds the glyphs up and scales them with the font size', () => {
    expect(estimateTitleWidth('a i', 10)).toBeCloseTo(5.8 + 2.6 + 3.2, 5);
  });

  it('is zero for an empty title', () => {
    expect(estimateTitleWidth('', 34)).toBe(0);
  });
});

describe('estimatedTitleFits', () => {
  const FONT_SIZE = 34;
  const AVAILABLE_WIDTH = 343;

  it('fits a short title', () => {
    expect(estimatedTitleFits('Edit Account', AVAILABLE_WIDTH, FONT_SIZE)).toBe(true);
  });

  it('does not fit a clearly long English title', () => {
    expect(
      estimatedTitleFits('Edit, Duplicate, or Delete a Transaction', AVAILABLE_WIDTH, FONT_SIZE),
    ).toBe(false);
  });

  it('does not fit a clearly long Ukrainian title', () => {
    expect(
      estimatedTitleFits(
        'Редагування, дублювання чи видалення транзакції',
        AVAILABLE_WIDTH,
        FONT_SIZE,
      ),
    ).toBe(false);
  });

  // The estimate is a guess within about 10 percent, so a title only a little wider than the
  // line stays native on the first frame and the measurement settles it.
  it('keeps a title that is just over the line native until it is measured', () => {
    expect(estimatedTitleFits('aaaa', 20.2, 10)).toBe(true);
    expect(estimatedTitleFits('aaaa', 20, 10)).toBe(false);
  });

  // 23 narrow glyphs at 50pt are 368pt, which is exactly 320pt of line times the 1.15 tolerance
  // (both sides are the same float), so a title that lands on the limit counts as fitting.
  it('fits a title whose estimate equals the tolerated line width exactly', () => {
    const title = 'i'.repeat(23);

    expect(estimateTitleWidth(title, 50)).toBe(368);
    expect(estimatedTitleFits(title, 320, 50)).toBe(true);
  });

  // A window that has no width yet (0, or a margin wider than the window) is not a line to wrap
  // a title in, so it must not turn every title into a heading.
  it.each([
    ['no width', 0],
    ['a negative width', -32],
  ])('counts a long title as fitting at %s, so the native large title stays', (_name, width) => {
    expect(estimatedTitleFits('Edit, Duplicate, or Delete a Transaction', width, FONT_SIZE)).toBe(
      true,
    );
  });
});
