import {
  isNewerThanDeploymentTarget,
  parseSymbolCatalogue,
  symbolCatalogue,
} from './sf-symbol-catalogue';

const SAMPLE = `
/**
 * @name SF Symbols 1.0
 * @description These symbols are available on the following platforms:
 * iOS v13.0+,
 * macOS v10.15+
 */
export type SFSymbols1_0 =
  | 'house'
  | 'pencil'

/**
 * @name SF Symbols 6.2
 * @description These symbols are available on the following platforms:
 * iOS v18.2+,
 * macOS v15.2+
 */
export type SFSymbols6_2 =
  | 'receipt'
  | 'house'

export type SFSymbol =
  Overrides extends { SFSymbolsVersion: '1.0' } ? SFSymbols1_0 :
  | 'not.a.symbol'
`;

describe('parseSymbolCatalogue', () => {
  it('maps every symbol to the minimum iOS stated above the union that lists it', () => {
    expect(parseSymbolCatalogue(SAMPLE).minimumIos).toEqual(
      new Map([
        ['house', '13.0'],
        ['pencil', '13.0'],
        ['receipt', '18.2'],
      ]),
    );
  });

  it('keeps the first release that lists a symbol and stops at the merged union', () => {
    const { minimumIos } = parseSymbolCatalogue(SAMPLE);

    expect(minimumIos.get('house')).toBe('13.0');
    expect(minimumIos.has('not.a.symbol')).toBe(false);
  });
});

describe('the installed sf-symbols-typescript catalogue', () => {
  it('reads thousands of symbols, one iOS per symbol', () => {
    expect(symbolCatalogue.minimumIos.size).toBeGreaterThan(5000);
  });

  it.each([
    ['house.fill', '13.0'],
    ['chevron.right', '13.0'],
    ['handbag', '16.1'],
    ['receipt', '18.2'],
    ['text.pad.header', '26.0'],
  ])('reads %s as iOS %s', (name, ios) => {
    expect(symbolCatalogue.minimumIos.get(name)).toBe(ios);
  });
});

describe('isNewerThanDeploymentTarget', () => {
  it.each([
    ['13.0', false],
    ['15.0', false],
    ['15.1', false],
    ['15.2', true],
    ['15.4', true],
    ['16.0', true],
    ['26.0', true],
  ])('is iOS %s newer than the iOS 15.1 deployment target: %s', (ios, expected) => {
    expect(isNewerThanDeploymentTarget(ios)).toBe(expected);
  });
});
