import { IOS26_SYMBOL_FALLBACKS } from '@kiko/design-system/components/symbol';
import { KIKO_ENTITIES_ICONS } from '@kiko/design-system/components/icon-pools';

import {
  accountKindSymbol,
  holdingTypeSymbol,
  loanKindSymbol,
  propertyCategorySymbol,
} from '../entity-symbols';

import { accountIconPool, holdingIconPool } from '.';

const accountDefaults: readonly string[] = Object.values(accountKindSymbol);

// A property category and a loan kind can share a glyph (`car.fill`), so the
// list of every holding default is deduplicated, in first-seen order.
const holdingDefaults: readonly string[] = [
  ...new Set([
    ...Object.values(holdingTypeSymbol),
    ...Object.values(loanKindSymbol),
    ...Object.values(propertyCategorySymbol),
  ]),
];

const entityIcons: readonly string[] = KIKO_ENTITIES_ICONS;

describe.each([
  ['account', accountIconPool, accountDefaults],
  ['holding', holdingIconPool, holdingDefaults],
])('the %s icon pool', (_label, pool, defaults) => {
  it('offers every default glyph its entity can show, first', () => {
    expect(pool.slice(0, defaults.length)).toEqual(defaults);
  });

  it('offers the rest of the Kiko Entities pool after the defaults, in its own order', () => {
    expect(pool.slice(defaults.length)).toEqual(
      entityIcons.filter((icon) => !defaults.includes(icon)),
    );
  });

  it('offers no glyph twice', () => {
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('offers a default the Kiko Entities pool already holds once, in the defaults position', () => {
    const shared = defaults.filter((icon) => entityIcons.includes(icon));

    expect(shared.length).toBeGreaterThan(0);

    for (const icon of shared) {
      expect(pool.indexOf(icon)).toBe(defaults.indexOf(icon));
    }
  });

  it('offers no iOS 26 symbol, which the iOS 15.1 deployment target renders blank', () => {
    expect(pool.filter((icon) => icon in IOS26_SYMBOL_FALLBACKS)).toEqual([]);
  });
});

describe('the default glyphs the pools add', () => {
  it.each([
    ['the Properties account', accountKindSymbol.property],
    ['the Loans account', accountKindSymbol.debt],
    ['the bank account kind', accountKindSymbol.bank],
  ])('offers the account pool %s default', (_label, icon) => {
    expect(accountIconPool).toContain(icon);
  });

  it.each(Object.entries(loanKindSymbol))(
    'offers the holding pool the %s loan default',
    (_kind, icon) => {
      expect(holdingIconPool).toContain(icon);
    },
  );

  it.each(Object.entries(propertyCategorySymbol))(
    'offers the holding pool the %s property default',
    (_category, icon) => {
      expect(holdingIconPool).toContain(icon);
    },
  );

  it.each(Object.entries(holdingTypeSymbol))(
    'offers the holding pool the %s type default',
    (_type, icon) => {
      expect(holdingIconPool).toContain(icon);
    },
  );
});
