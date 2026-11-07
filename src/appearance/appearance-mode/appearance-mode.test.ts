import { appearanceModes, parseAppearanceMode, windowOverrideOf } from './appearance-mode';

describe('parseAppearanceMode', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    [undefined, 'system'],
    ['', 'system'],
    ['LIGHT', 'system'],
    [3, 'system'],
  ])('reads %p as %s', (value, expected) => {
    expect(parseAppearanceMode(value)).toBe(expected);
  });
});

describe('appearanceModes', () => {
  it('lists system, light, dark in that order', () => {
    expect(appearanceModes).toEqual(['system', 'light', 'dark']);
  });
});

describe('windowOverrideOf', () => {
  it.each([
    ['system', 'auto'],
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const)('maps %s to the window value %s', (mode, expected) => {
    expect(windowOverrideOf(mode)).toBe(expected);
  });
});
