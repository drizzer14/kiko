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

// The deployment target is iOS 18.2 (DEPLOYMENT_TARGET), and `SFSymbolView`
// draws a symbol the running OS does not know as a BLANK glyph. The app has no
// per-symbol swap, so every symbol it can draw must already exist on 18.2.
// This invariant fails when a symbol the app can draw is unknown to the SF
// Symbols catalogue or newer than 18.2. That the build files state the same iOS
// (the symbols are only safe on the iOS the app is built for) is checked in
// `test-support/deployment-target.test.ts`: it reads `ios/`, which Stryker's
// sandbox lacks, and this file imports src, so Stryker would run it there.
// Symbols are collected two ways. Module reads (the entity maps, both icon
// pools and the pools the forms open, the native header's Edit item, the tab
// bar) are exact. A scan of the quoted string literals in `src/` that equal a
// catalogue symbol name covers every other call site (SymbolIcon, Button and
// SettingsRow `icon`, the Reminders bell, the bank capability icons), without
// parsing JSX. A name built at runtime is out of reach of the scan, and so is
// a symbol newer than the installed catalogue (the literal scan drops a name
// the catalogue does not list).

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

// A symbol the catalogue does not list counts as newer: its minimum iOS is
// unknown, so it cannot be shown to exist on the target.
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
    ['target.symbol', '18.2'],
    ['new.symbol', '18.3'],
    ['latest.symbol', '26.0'],
  ]);

  it('flags a symbol newer than iOS 18.2, or unknown to the catalogue, as newer than the target', () => {
    expect(
      symbolsNewerThanTarget(
        ['old.symbol', 'target.symbol', 'new.symbol', 'latest.symbol', 'typo'],
        catalogue,
      ),
    ).toEqual(['new.symbol', 'latest.symbol', 'typo']);
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
        'list.bullet.rectangle',
        'arrow.trianglehead.2.clockwise.rotate.90',
        'dollarsign',
      ]),
    );
    expect(drawn.size).toBeGreaterThan(150);
  });

  it('is known to the SF Symbols catalogue', () => {
    expect(unknownSymbols(drawn, symbolCatalogue)).toEqual([]);
  });

  it('exists on the iOS 18.2 deployment target', () => {
    expect(symbolsNewerThanTarget(drawn, symbolCatalogue)).toEqual([]);
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

  it('draws only symbols that exist on the iOS 18.2 deployment target', async () => {
    const native = [...(await tabBarSymbols()), ...headerSymbols()];

    expect(unknownSymbols(native, symbolCatalogue)).toEqual([]);
    expect(symbolsNewerThanTarget(native, symbolCatalogue)).toEqual([]);
  });
});
