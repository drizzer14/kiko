import { join } from 'node:path';
import {
  accountKindSymbol,
  genericEntitySymbol,
  holdingTypeSymbol,
  loanKindSymbol,
  propertyCategorySymbol,
} from '@kiko/holdings/entity-symbols';
import {
  KIKO_CATEGORIES_ICONS,
  KIKO_ENTITIES_ICONS,
} from '@kiko/design-system/components/icon-pools';
import { render } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { NavigationContainer } from '@react-navigation/native';
import { SYMBOL_FALLBACKS } from '@kiko/design-system/components/symbol';
import { accountIconPool, holdingIconPool } from '@kiko/holdings/entity-icon-pool';
import { editBarItem, REMINDERS_BELL_SYMBOL } from '@kiko/design-system/edit-bar-item';

import '@kiko/design-system/unistyles';

import RootNavigator from '@kiko/navigation/root-navigator';
import { navigationDarkTheme } from '@kiko/navigation/dark-theme';

import {
  type SymbolCatalogue,
  isNewerThanDeploymentTarget,
  symbolCatalogue,
} from './test-support/sf-symbol-catalogue';

// The deployment target is iOS 15.1, and `SFSymbolView` draws a symbol the
// running OS does not know as a BLANK glyph. This invariant fails when a
// symbol the app can draw is newer than iOS 15.1 and has no fallback in
// SYMBOL_FALLBACKS, when a fallback is itself newer than iOS 15.1, or when an
// entry records a minimum iOS the SF Symbols catalogue does not agree with.
// Symbols are collected two ways. Module reads (the entity maps, both icon
// pools and the pools the forms open, the native header's Edit item) are
// exact. A scan of the quoted string literals in `src/` that equal a
// catalogue symbol name covers every other call site (SymbolIcon, Button and
// SettingsRow `icon`, the Reminders bell, the tab bar, the bank capability
// icons), without parsing JSX. A name built at runtime is out of reach of the
// scan, and so is a symbol newer than the installed catalogue (the literal
// scan drops a name the catalogue does not list).
//
// A tab bar and a header bar item draw their symbol natively, where
// SYMBOL_FALLBACKS never applies, so the symbols they draw must exist on
// iOS 15.1 themselves.

type Fallbacks = Record<string, { minimumIos: string; fallback: string }>;

// Literals that equal an SF Symbols 5.0 name but are style and edge strings
// (`'left'` / `'right'` in a layout's edge props and chart axes), never drawn.
const NOT_SYMBOLS: ReadonlySet<string> = new Set(['left', 'right']);

const SOURCE_ROOT = join(__dirname, '..', 'src');
const QUOTED_NAME = /(['"`])([a-z0-9]+(?:\.[a-z0-9]+)*)\1/g;

const appSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);

    if (statSync(full).isDirectory()) {
      return entry === 'test-support' ? [] : appSourceFiles(full);
    }

    const isSource = /\.tsx?$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry);

    return isSource ? [full] : [];
  });

const literalSymbols = (catalogue: SymbolCatalogue): Set<string> =>
  new Set(
    appSourceFiles(SOURCE_ROOT)
      .flatMap((file) => [...readFileSync(file, 'utf-8').matchAll(QUOTED_NAME)])
      .map((match) => match[2])
      .filter((name) => catalogue.minimumIos.has(name) && !NOT_SYMBOLS.has(name)),
  );

const headerSymbols = (): string[] => {
  const { icon } = editBarItem({ label: 'Edit', tintColor: 'white', onPress: () => undefined });

  return [REMINDERS_BELL_SYMBOL, ...(icon?.type === 'sfSymbol' ? [icon.name] : [])];
};

const moduleSymbols = (): string[] => [
  ...Object.values(accountKindSymbol),
  ...Object.values(holdingTypeSymbol),
  ...Object.values(loanKindSymbol),
  ...Object.values(propertyCategorySymbol),
  ...Object.values(genericEntitySymbol),
  ...KIKO_ENTITIES_ICONS,
  ...KIKO_CATEGORIES_ICONS,
  ...accountIconPool,
  ...holdingIconPool,
  ...headerSymbols(),
];

const unknownSymbols = (symbols: Iterable<string>, catalogue: SymbolCatalogue): string[] =>
  [...symbols].filter((name) => !catalogue.minimumIos.has(name));

const symbolsMissingFallback = (
  symbols: Iterable<string>,
  fallbacks: Fallbacks,
  catalogue: SymbolCatalogue,
): string[] =>
  [...symbols].filter(
    (name) =>
      isNewerThanDeploymentTarget(catalogue.minimumIos.get(name) ?? '0.0') &&
      !Object.hasOwn(fallbacks, name),
  );

const fallbacksNewerThanTarget = (fallbacks: Fallbacks, catalogue: SymbolCatalogue): string[] =>
  Object.entries(fallbacks)
    .filter(([, { fallback }]) => {
      const minimumIos = catalogue.minimumIos.get(fallback);

      return minimumIos === undefined || isNewerThanDeploymentTarget(minimumIos);
    })
    .map(([name, { fallback }]) => `${name} -> ${fallback}`);

const entriesDisagreeingWithCatalogue = (
  fallbacks: Fallbacks,
  catalogue: SymbolCatalogue,
): string[] =>
  Object.entries(fallbacks)
    .filter(([name, { minimumIos }]) => catalogue.minimumIos.get(name) !== minimumIos)
    .map(
      ([name, { minimumIos }]) =>
        `${name}: map says ${minimumIos}, catalogue says ${catalogue.minimumIos.get(name)}`,
    );

const entriesForSafeSymbols = (fallbacks: Fallbacks, catalogue: SymbolCatalogue): string[] =>
  Object.keys(fallbacks).filter(
    (name) => !isNewerThanDeploymentTarget(catalogue.minimumIos.get(name) ?? '99.0'),
  );

const symbolsNewerThanTarget = (symbols: Iterable<string>, catalogue: SymbolCatalogue): string[] =>
  [...symbols].filter((name) =>
    isNewerThanDeploymentTarget(catalogue.minimumIos.get(name) ?? '99.0'),
  );

const catalogueOf = (entries: [string, string][]): SymbolCatalogue => ({
  minimumIos: new Map(entries),
});

describe('the invariant checks (synthetic data)', () => {
  const catalogue = catalogueOf([
    ['old.symbol', '14.0'],
    ['new.symbol', '16.1'],
    ['target.symbol', '15.1'],
    ['too.new.fallback', '15.2'],
    ['safe.fallback', '13.0'],
  ]);

  it('flags a symbol newer than iOS 15.1 that has no fallback entry (the planted symbol)', () => {
    expect(
      symbolsMissingFallback(['old.symbol', 'target.symbol', 'new.symbol'], {}, catalogue),
    ).toEqual(['new.symbol']);
  });

  it('accepts a symbol newer than iOS 15.1 that has a fallback entry', () => {
    const fallbacks = { 'new.symbol': { minimumIos: '16.1', fallback: 'safe.fallback' } };

    expect(symbolsMissingFallback(['new.symbol'], fallbacks, catalogue)).toEqual([]);
  });

  it('does not mistake an inherited object key for a fallback entry', () => {
    const inherited = catalogueOf([['constructor', '17.0']]);

    expect(symbolsMissingFallback(['constructor'], {}, inherited)).toEqual(['constructor']);
  });

  it('flags a fallback that is itself newer than iOS 15.1, or unknown to the catalogue', () => {
    const fallbacks = {
      'new.symbol': { minimumIos: '16.1', fallback: 'too.new.fallback' },
      other: { minimumIos: '16.0', fallback: 'no.such.symbol' },
    };

    expect(fallbacksNewerThanTarget(fallbacks, catalogue)).toEqual([
      'new.symbol -> too.new.fallback',
      'other -> no.such.symbol',
    ]);
  });

  it('flags an entry whose recorded minimum iOS the catalogue disagrees with', () => {
    const fallbacks = { 'new.symbol': { minimumIos: '16.0', fallback: 'safe.fallback' } };

    expect(entriesDisagreeingWithCatalogue(fallbacks, catalogue)).toEqual([
      'new.symbol: map says 16.0, catalogue says 16.1',
    ]);
  });

  it('flags an entry for a symbol that already exists on iOS 15.1', () => {
    const fallbacks = { 'old.symbol': { minimumIos: '14.0', fallback: 'safe.fallback' } };

    expect(entriesForSafeSymbols(fallbacks, catalogue)).toEqual(['old.symbol']);
  });

  it('flags a symbol newer than iOS 15.1, or unknown to the catalogue, as newer than the target', () => {
    expect(
      symbolsNewerThanTarget(['old.symbol', 'target.symbol', 'new.symbol', 'typo'], catalogue),
    ).toEqual(['new.symbol', 'typo']);
  });

  it('flags a symbol the catalogue does not know', () => {
    expect(unknownSymbols(['old.symbol', 'typo.symbol'], catalogue)).toEqual(['typo.symbol']);
  });
});

describe('every SF Symbol the app can draw', () => {
  const drawn = new Set([...moduleSymbols(), ...literalSymbols(symbolCatalogue)]);

  it('collects the symbols of every source it reads', () => {
    // A collector that silently reads nothing would pass every check below.
    expect([...drawn]).toEqual(
      expect.arrayContaining([
        'receipt',
        'pencil',
        'bell',
        'house.fill',
        'text.pad.header',
        'arrow.trianglehead.2.clockwise.rotate.90',
        'dollarsign',
      ]),
    );
    expect(drawn.size).toBeGreaterThan(150);
  });

  it('is known to the SF Symbols catalogue', () => {
    expect(unknownSymbols(drawn, symbolCatalogue)).toEqual([]);
  });

  it('has an iOS-15.1-safe fallback for each symbol newer than iOS 15.1', () => {
    expect(symbolsMissingFallback(drawn, SYMBOL_FALLBACKS, symbolCatalogue)).toEqual([]);
  });
});

describe('every SF Symbol a native bar draws', () => {
  // The tab bar is read through the `@bottom-tabs/react-navigation` manual mock,
  // which surfaces each tab's `tabBarIcon()` symbol on a `tab-icon-<name>` view.
  const tabBarSymbols = async (): Promise<string[]> => {
    const { findAllByTestId, unmount } = await render(
      <NavigationContainer theme={navigationDarkTheme}>
        <RootNavigator />
      </NavigationContainer>,
    );
    const icons = await findAllByTestId(/^tab-icon-/);

    await unmount();

    return icons.map((icon) => icon.props.sfSymbol);
  };

  it('reads the symbol of every tab and of the header Edit item', async () => {
    expect(await tabBarSymbols()).toEqual(
      expect.arrayContaining(['house.fill', 'tray', 'chart.xyaxis.line', 'gear']),
    );
    expect(headerSymbols()).toEqual(['bell', 'pencil']);
  });

  it('draws only symbols that exist on iOS 15.1, as SYMBOL_FALLBACKS cannot swap them', async () => {
    const native = [...(await tabBarSymbols()), ...headerSymbols()];

    expect(unknownSymbols(native, symbolCatalogue)).toEqual([]);
    expect(symbolsNewerThanTarget(native, symbolCatalogue)).toEqual([]);
  });
});

describe('SYMBOL_FALLBACKS', () => {
  it('maps every symbol to a fallback that exists on iOS 15.1', () => {
    expect(fallbacksNewerThanTarget(SYMBOL_FALLBACKS, symbolCatalogue)).toEqual([]);
  });

  it('records the minimum iOS the SF Symbols catalogue states for every symbol', () => {
    expect(entriesDisagreeingWithCatalogue(SYMBOL_FALLBACKS, symbolCatalogue)).toEqual([]);
  });

  it('holds no entry for a symbol that already exists on iOS 15.1', () => {
    expect(entriesForSafeSymbols(SYMBOL_FALLBACKS, symbolCatalogue)).toEqual([]);
  });
});
