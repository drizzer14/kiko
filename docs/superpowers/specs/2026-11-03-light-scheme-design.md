# Light color scheme for Kiko: design

Track: 1.4-light-scheme task 1/1. Base: next 57130e23c. Build sets are named "1.4-light-scheme-build task N/7".
Plan: `docs/superpowers/plans/2026-11-03-light-scheme.md`.
Sources: `c676f7dbd:.superpowers/sdd/light-scheme-research/findings.md` and `probe-results.md`, the backlog section
"LIGHT SCHEME", the old build (`9d69a77e^`, icons `1702e7085^`), Unistyles 3.6.0 read from the packed tarball, RN 0.87.1
and the other libraries read in this worktree's `node_modules`, and the designer's
`.superpowers/sdd/1.4-light-scheme/palette/palette.json` (gitignored; structure read, values not restated here).
Every line number below is a measurement on 57130e23c for reconciling with the research. Code must re-grep it.

## 1. User rulings (binding)

- Option B: an in-app System/Light/Dark control with a live switch. C0 (not C4). Path U-C: adaptive themes on, no
  `setTheme`, only `Appearance.setColorScheme`. Unistyles upgrade to exactly 3.6.0, not 3.7.0 or 3.8.0.
- The launch screen stays black.
- kiko:designer designs the light tokens; the user approves the palette.
- A separate light set for account/entity colors AND category colors. User: "This applies to basically all colors in
  the app": every color, charts and stored hex included, gets a light variant.
- Restore the light and dark app icons only (no tinted).
- Dark look stays exactly as it is (approved visuals are locked).
- Mutation gates are paused by the user: verify + review only. Strict scope applies (visible wrong data, own
  regressions, wrong texts, release requirements; everything else goes to a backlog section).

## 2. Where this base contradicts the research

| # | Research or brief said | Measured | Consequence |
|---|---|---|---|
| C1 | "N2 U-C passed without" the native-stack patch N8 | `bc2682882:patches/@react-navigation+native-stack+7.18.9.patch` is in BUILD-B: `experimental_userInterfaceStyle: globalThis.__probeNativeStack?.barStyle?.(dark) ?? 'unspecified'`. C0 has no `barStyle` entry, so every C0 row on BUILD-B ran WITH `'unspecified'`. BUILD-B's navigation colors are also `PlatformColor`, not tokens (`probe-theme.ts`). U-C with the unpatched header and token hex colors was never run | D5 and the re-measure row N2-R |
| C2 | Findings 9: #1329 "needs a check" | The fix is NOT in 3.6.0. The issue is reported ON 3.6.0. Fix PR #1353 merged 2026-10-29, after v3.7.0 (2026-10-28) and before v3.8.0 (2026-11-02). Source: `includeUnpromoted` count in 3.6.0 `cxx/hybridObjects/HybridShadowRegistry.cpp` is 0 | Nested `Text` keeps its old color on 3.6.0 under a Reanimated view. Kiko has 0 sites today (section 6); a guard keeps it so |
| C3 | Findings 10 step 4: a new `color_scheme` column and a migration | `settings.appearance` exists (`schema.ts:455`) with the right enum and default | D1: no migration |
| C4 | Palette `storedHexMap.legacyLightEraHex` note and findings problem 10: the old build stored the dark hex | The old `ColorPicker` (`9d69a77e^:src/screens/forms/color-picker/color-picker.component.tsx`) iterated `theme.colors.entityColors` and reported that hex. So a color picked under the old light theme stored a LIGHT hex, which is why `resolveStoredHexForScheme` mapped both ways | D3: the picker now writes the dark hex; a September-window light hex takes the out-of-set rule |
| C5 | Findings N5: one reverse map | The palette has two sets (`entitySwatches`, `categorySwatches`) and the same dark hex maps differently per set. `EntityIconTile` draws both, so a sink cannot know the set | D3: the producer maps, with a required `scheme` argument |
| C6 | "about 65 test files pin dark" | Floor measured: 91 test files name a dark symbol; 124 with any literal hex. The Unistyles jest mock reads `Object.values(themes).at(0)`, so with `themes = { dark, light }` most stay green unchanged. The probe's `{ light, dark }` order would flip all of them | D7 |
| C7 | Brief: `1.4-small` has no commits | It has 2 (`e9eb66250`, `d58a98247`). It touches `settings.screen.tsx`, its test and `kiko-architecture/reminders.md`, not `system.screen.tsx` | Merge order stays; re-check at set 6 |
| C8 | "Dark-only theme" lives in two skill copies | One copy: `.claude/skills/kiko-design-system/SKILL.md`. `harness/kiko/skills/design-system/SKILL.md` is a wrapper with no such text. `kiko-architecture` and `kiko-domain` also say dark-only | Scribe list in the plan |
| C9 | Findings 10 step 5: `'unspecified'` for System | N2 ran `'auto'` (`probe-values.ts`). `RCTConvert.mm` maps both to `UIUserInterfaceStyleUnspecified` | Use `'auto'`, the measured one |
| C10 | Findings 10 step 8: 6 `Alert.alert` calls | Floor: 8. `ActionSheetIOS` and native item menus: 0 in non-test `src/` | ActionSheet and UIMenu rows narrow to system-owned menus (section 8) |
| C11 | Not in the research | `react-native-calendars` caches `useRef(styleConstructor(theme))` in `calendar/index.js`, `header/index.js`, `day/basic/index.js`. An open calendar keeps old colors on an OS switch | Calendar `key` in set 5 |
| C12 | Palette `iconTile.glyph`: dark glyph reached by an unmapped hex | The out-of-set rule also clears 3.4 to white, so on light the dark-glyph branch is unreachable | Keep the token so the branch is never pale; no extra test beyond D3's property |
| C13 | Palette `glass.colorSchemeProp`: dark or light per scheme | N1 and N2 measured `colorScheme="system"` (`bc2682882` glass and sheet) | D5: `"system"` |

## 3. Decisions

### D1. Storage: reuse `settings.appearance`. No migration

Verified reason: the column exists (`schema.ts:455`), `NOT NULL DEFAULT 'system'`, enum `system|light|dark`, in every
installed database and in every `.kiko` written since it was added. It is pinned readerless in
`DOCUMENTED_READERLESS_COLUMNS` (`src/db/settings-columns.test.ts`), whose comment says re-wiring means removing it there.
A second column would leave one dead column beside a live twin and add a migration, its reviewer step and a back-compat
fixture, for nothing but a NULL meaning System, which the existing default already says.

Cost: a row may hold `light` or `dark` from the September builds (the old toggle wrote it). That value then takes effect
at flip. It is a valid choice, visible in the control, and one tap changes it.

`.kiko`, both ways, reading `restore-snapshot.ts` and `export-data.ts`:

| Direction | Result under Q2 option A (recommended) | was (column in `TAKEN_FROM_FILE_ON_RESTORE`) |
|---|---|---|
| Export from 1.4 | Row carries `appearance` | Same, always `system` in practice |
| New file into 1.4, file `light`, live `dark` | Live `dark` stays | File value written, no reader |
| Old file with `appearance: 'system'`, live `dark` | Live `dark` stays | File value written, no reader |
| Old file with no such key | Live value stays | Column default `system` |
| Restore with no live row | `system` (`NO_LIVE_DEVICE_SETTINGS`) | Column default |
| 1.4 file into an older app | Column present, no reader, nothing changes | Same |

No migration in this track, so `check:shipped-migrations` is untouched and no migration reviewer step applies. If Q1
option B is taken, a migration enters and set 6 gains a `kiko:reviewer` step before BATCH READY.

### D2. First frame: a UserDefaults mirror read through RN's settings constants. The row wins

Verified by source at RN 0.87.1, with no new native code:

- `RCTSettingsManager.mm` `getConstants` returns `RCTJSONClean([_defaults dictionaryRepresentation])` on
  `NSUserDefaults standardUserDefaults`, synchronously through the TurboModule constants.
- The app already reads this on a device before any render: `deviceLanguage()` and `deviceRegion()` use
  `NativeModules?.SettingsManager?.settings`. That is the read path to use. `Settings.get` from `Settings.ios.js` throws
  under jest where the module is absent (`this._settings` undefined), and `@kiko/design-system/unistyles` loads in about
  240 test files.
- Write path: `Settings.set({ key: mode })` calls `setValues`, which sets and `synchronize`s on the module queue.
- `ios/Kiko/PrivacyInfo.xcprivacy` already declares `NSPrivacyAccessedAPICategoryUserDefaults` with `CA92.1`. The value is
  a mode string, not financial data. `AppDelegate.swift` `urlCachePurgedKey` is the key-name precedent.

Launch order, explicit in `src/design-system/unistyles/unistyles.ts`, not left to import order: read the mirror; if `light`
or `dark`, call `Appearance.setColorScheme`; then `StyleSheet.configure`. Reason: Unistyles 3.6.0 reads
`RCTKeyWindow()?.traitCollection` synchronously on main (`NativePlatform+ios.swift`), and the RN method runs on the main
queue, so FIFO order holds. In `system` no call is made. Row L measured this order with a native getter
(`probe-scheme.ts`); the constants read is not measured yet, so N16 re-runs row L.

Equality and mismatch. The row is the only source of truth, and the control writes only the row.
`useSyncAppearanceWithSettings`, beside `useSyncLanguageWithSettings` in `AppRoot`, reads the row by live query. When the
value is known and on every change of that value it writes the mirror, then calls `Appearance.setColorScheme`. It does
nothing while the row is unloaded, so an unloaded row never reads as System.

| Case | Mirror | Row | First frame | After the hook |
|---|---|---|---|---|
| Normal | light | light | light | same |
| Killed between row write and mirror write | dark | light | dark | light; mirror fixed |
| New device from a backup: UserDefaults come back, the database is excluded from backup (`excludeDatabaseFilesFromBackup`) | light | system | light | OS scheme; mirror fixed |
| First launch of 1.4, or mirror absent or unparsable | absent | any | OS scheme | row; mirror written |
| Lock on: `AppRoot` not mounted until unlock | any | any | mirror | row, after unlock |

The launch screen is black in all of them (ruled). Saved Light shows about 300 ms of black and then a fade (row L).

### D3. Stored hex: the dark hex stays canonical; a map at the producer. No migration

Why not a migration to keys: old `.kiko` files carry hex forever, so the map is needed anyway; three shipped columns
would change for no user gain; the dark path would stop being byte-identical by construction. With the map, every write
stays the exact dark hex and dark display is the identity.

Verified paths that write or hold a hex (floor):

| Path | Holds | In the 14-swatch set |
|---|---|---|
| `ColorPicker` `onSelect` through forms to `accounts.repo`, `holdings.repo`, `categories.repo` | Today: `theme.colors.entityColors` value. Trap: under a light theme it would store a light hex (C4). Change: it reports `entityColorsDark[name]` and paints the set's light value | Yes after the change |
| `drizzle/migrations/0017_default_category_colors.sql`, `0039_seed_loan_interest_category.sql` | Literal hex | Yes: `comm` against `palette.ts` is empty |
| `defaultColor` on 6 `holding-descriptor` files, `defaultAccountColor` | `entityColorsDark.*` | Yes |
| `restore-snapshot.ts` `withLoanInterestReseeded` | `entityColorsDark.indigo` | Yes |
| `with-implicit-accounts-merged.ts`, `restore-snapshot.ts` | `color: null` | n/a, default path |
| Restored `.kiko` | Any string | No guarantee; `isValidHex` gates |
| September-window row or file | An old light hex (C4) | No |
| Provider or bank color | None exists (grep; palette `defaults.providerColors` agrees) | n/a |
| `categoryColor(key)` from `chartSeriesDark` | Hash into 8 hues | Yes: `palette.test.ts` pins the subset |
| `e2e/screenshot/seed`, `build-demo-snapshot` | `entityColorsDark.*` | Yes; stays |

Result table (scheme is the theme's own field, see section 4):

| Stored value | Dark | was | Light, entity producer | Light, category producer |
|---|---|---|---|---|
| One of the 14 dark hexes, any letter case | The stored string, verbatim | Same | `entitySwatches.<key>.light` | `categorySwatches.<key>.light` |
| Any other valid `#RRGGBB` | The stored string, verbatim | Same | Palette `cannotMap` rule: keep hue and saturation, lower HSL lightness in 1% steps until contrast to white is at least 3.4; unchanged if it passes | Same rule |
| Null, empty, malformed | Default path (kind, type or hash), verbatim | Same | Default path, then the entity map | Hash path, then the category map |

The palette's `legacyLightEraHex` table is not built: its input is a two-day window on one user's data, and the rule above
already gives a readable, deterministic result. The picker rings nothing for such a value, as it does in dark today.

Direct dark imports, measured (a floor, re-measure): non-test `src/` has 11 files and 21 uses, in `category-breakdown.ts`
(1), `metal`, `loan`, `bond`, `term-deposit`, `property-item` descriptors (1 each), `balance.descriptors.ts` (4),
`entity-colors.ts` (7), `theme.ts` (2), `entity-tint.ts` (1), `restore-snapshot.ts` (1). `e2e/` has 2 more files. 9 test
files. All stay: under D3 they name canonical values. Only display goes through the map.

Producers take a REQUIRED `scheme` argument so the compiler lists every caller: 34 non-test files and 19 test files use a
producer today (floor). This is old problem 11 again, on purpose: a missed site is a compile error, not a white tile.

### D4. Tile and chart parameters

`theme.colors.glyphOnLightTile` replaces `theme.colors.background` in `EntityIconTile` (dark value equals today's black).
Net-worth `AREA_OPACITY` and `NEGATIVE_AREA_OPACITY` move to a theme field from `chartParameters`; the dark values stay 0.3
and 0.5. Gradient percentages and the 3:1 rule stay (palette `iconTile`). The net-worth stroke stays sign-colored (locked).

### D5. Native-stack patch N8 and the dark-only native code

N8 is not shipped, on the condition below. The stated reason (N2 passed without it) is wrong (C1). The evidence that exists:
N1 P5 (no patch, U-C not involved) showed no difference from the patched build, and N2 C1 on BUILD-A with U-A (the header
sends `light`/`dark`, which is the unpatched behavior) had no failed element on both iOS versions. Evidence still owed: row
N2-R, U-C with no patch and token hex navigation colors, set 5 step 3.

What brings N8 back: a header element in N2-R that lags until scroll. Then `patches/@react-navigation+native-stack+7.18.9.patch`
returns with a `documented-exceptions` entry and a pin test, and N2-R re-runs. If N2-R still fails with the patch, the next
candidate is the probe's `PlatformColor` navigation colors, which need a user look because they are not the palette's values.

| Item (measured on base) | Decision | Dark tip effect, plist still Dark | Evidence |
|---|---|---|---|
| Tab bar `tabBarStyle.backgroundColor`, `tabBarActiveTintColor`, `tabBarInactiveTintColor`, read from `useUnistyles` (`root.navigator.tsx`) | Keep as props; the bug B1 pin stays. Comment loses "dark-only" | None | P3; bottom-tabs 1.4.0 re-applies on a color prop change |
| `colorScheme="dark"`: `glass-surface.component.tsx:298`, `bottom-sheet.component.tsx:355` | `colorScheme="system"` | Inherits Dark | P4 both iOS; BUILD-B |
| `keyboardAppearance: 'dark'` (`use-keyboard-done-accessory.tsx`, return value) | `undefined`; type narrows; 2 readers keep passing it | Inherits Dark | P6 and A-uc; BUILD-B |
| `headerBlurEffect: 'systemChromeMaterialDark'` (`large-title-screen-options.ts`, iOS below 26 only) | `'systemChromeMaterial'` | Same material under a dark trait; the iOS 18 look is locked, so it gets its own before/after row | BUILD-B; iOS 18 not measured |
| RefreshControl (`home.screen.tsx`, 2 sites, no tint) | No change | None | Follows the window |
| Date picker (`time-field.component.tsx`, no `themeVariant`) | No change | None | P6 date rows |
| `SceneDelegate.swift` privacy overlay comment names `applyAppearance` in `src/appearance/appearance.ts` | Rewrite to the real function, set 6. Code unchanged: it already resolves `systemBackground` from the window trait | None | Comment only |
| Calendar (C11) | `key={theme.colorScheme}` on `Calendar` in `KikoCalendar` | None | N16 row |
| `navigationDarkTheme` (`App.tsx`) | One theme per scheme from tokens; `dark` flag follows the theme; dark object unchanged | None | N2-R |

Two more facts that are safe on this base. `keyboard-done-accessory.styles.ts` imports `darkTheme` for `spacing` only, no color.
`react-native-screens+4.27.0.patch` has no user-interface-style line (grep), so findings R6 is clear.

### D6. Guards

All three in `rules/semgrep-prewrite.yml`, each with its fixture pair, its `RULE_IDS_WITH_FIXTURES` entry and its inventory row
(`kiko-linter`, "Adding a pre-write guard rule"). Practical, since each is one syntactic shape:

- `kiko-no-unistyles-set-theme`: `UnistylesRuntime.setTheme(...)` and `UnistylesRuntime.setAdaptiveThemes(...)`. Reason: U-C
  has neither, and on 3.3.0 they were the #1179 path.
- `kiko-no-hard-coded-native-scheme`: JSX `colorScheme="dark|light"`, `keyboardAppearance` with `'dark'|'light'`, and a
  `headerBlurEffect` string ending `Dark` or `Light`.
- `kiko-no-nested-text`: a `Text` or `MoneyText` element inside a `Text` element (C2). If the pattern cannot express it, the
  developer reports that and a `NODE_RULES` checker is the fallback. It never just drops.

`metadata.skill` must name a heading that exists at the rule's commit and survives the set 6 rewrite. Set 5 adds the heading
"Native chrome follows the window" to `kiko-design-system`; `__tests__/skill-citations.test.ts` checks it.

### D7. Theme registration order

`themes = { dark: darkTheme, light: lightTheme }`. Dark first keeps the jest mock on dark (C6). A pin in `unistyles.test.ts`
says why. A light-world test re-registers `{ light, dark }` through a helper in `src/test-support/`.

The theme carries `colorScheme: 'dark' | 'light'`, read through `useUnistyles().theme`. Never compare a theme object by
reference: `useUnistyles` hands out a proxy, and the mock has no `rt.themeName` to rely on.

## 4. Mechanism

- Palette copy: set 2 is the first set that needs it. It copies `.superpowers/sdd/1.4-light-scheme/palette/palette.json`, as
  the user approved it, to `docs/design/light-palette/palette.json`. `__tests__/light-palette-source.test.ts` pins code to file.
- Values come only from that file. This spec defines none. A shape mismatch with the plan is a stop-and-ask to the designer.
- Display path: stored or default hex (canonical dark), then producer with `scheme`, then sink. Sinks stay unaware.
- Live switch: tap, `settingsRepo.setAppearance`, live query, hook, `Appearance.setColorScheme`, window trait, Unistyles native
  update, `useUnistyles` re-render for non-style props. One path, the language precedent. If a heavy sync makes the op-sqlite
  queue delay it visibly (N16 row), the fix is applying first in the handler; not built now.

## 5. Scenario matrix (a ruling reversed "dark-only", so old results show)

| Mode | OS | Result | was |
|---|---|---|---|
| System (default) | dark | Dark, byte-identical | Dark |
| System (default) | light | Light | Dark, plist pin |
| Light | dark or light | Light | n/a |
| Dark | light | Dark | Dark |
| System, OS switches with the app open | | Follows at once | No effect |
| Light, OS switches with the app open | | Stays light | n/a |
| Any, cold launch | | Black launch screen, then the mode | Black, then dark |
| Any, an Alert open during an OS switch in System | | Follows (row Y) | No effect |
| Light or Dark, an Alert open during an OS switch | | Card stays, dim layer follows (row Y) | n/a |
| In-app control with an Alert open | | Not reachable: the Alert blocks the control. Accepted exception under C0 | n/a |

## 6. Unistyles 3.6.0 against Kiko

- Age: 3.6.0 published 2026-10-21T15:00:25Z; `.npmrc` `min-release-age=7` passes. `save-exact=true`; `check:deps` needs the exact
  spec. `pod install` updates `ios/Podfile.lock`. The native rebuild reaches the user's device only through the coordinator's deploy.
- Peers: RN `>=0.81.0`, Kiko 0.87.1. Nitro `*`, Kiko 0.37.0. BUILD-B built and ran on this set. Lock diff in `bc2682882`: only
  the package, its peer range and its nested `@babel/types`.
- 3.5.1, "worklet reading a style throws": `HostUnistyle::get` throws `WORKLET_ACCESS_ERROR` in a worklet runtime. AST scan of
  non-test `src/` for `useAnimatedStyle|useDerivedValue|useAnimatedProps|useAnimatedReaction|useAnimatedScrollHandler` and
  `'worklet'` functions reading `styles.*` or `theme.*`: 0 (floor; indirect reads are not seen). No `...styles.x` spread: 0.
- `src/design-system/components/bottom-sheet/bottom-sheet.component.tsx`, `sheetAnimatedStyle` (`useAnimatedStyle`, line 255):
  reads shared values `keyboardHeight`, `translateY`, and numbers `windowHeight`, `tightenedMaxHeight`, `sheetBasePadding` (a
  number computed in render from `theme.spacing`), `insets.bottom`. It reads no StyleSheet style. Closed; the sheet with keyboard
  is in the before/after run because a miss throws.
- 3.6.0, "views with no unistyle are no longer linked" (`hasUnistyles`, `createUnistylesElement.native.tsx`): a view whose `style`
  holds no `unistyles_` key renders as plain RN. Kiko effect: an inline `{ backgroundColor: theme.colors.x }` from `useUnistyles`
  already re-renders; a style array with one unistyle still links. No dark change expected; the before/after run proves it.
- #1329: not fixed in 3.6.0 (C2). AST scan of `src/` for `Text`, `MoneyText`, `RNText`, `NativeText` nested in a text element, any line
  span: 0 sites; `<Trans`: 0. Floor: a `Text` given a JSX value through a variable or prop is not seen. Guard in D6.
- Third-party views with a `StyleSheet` color from Unistyles are not linked by the Babel plugin (`root: 'src'` rewrites only RN
  primitives) and repaint only on re-render. N16 covers them. Set 5 greps them.

## 7. Change sets and tip safety

| Set | Content | Light reachable at the tip? | What the user can see change |
|---|---|---|---|
| 1 | Unistyles 3.6.0 alone | No | Nothing |
| 2 | Palette copy, light values, theme registered, `initialTheme: 'dark'` | No | Nothing |
| 3 | Entity map, producers, picker, glyph token | No | Nothing |
| 4 | Category map, charts, opacity field | No | Nothing |
| 5 | Navigation themes, native chrome, calendar key, guards | No: plist Dark is the ambient trait | Nothing; iOS 18 blur row and keyboard row prove it |
| 6 | Flip: storage, mirror, hook, control, strings, adaptive on, plist key off | Yes, complete | The feature |
| 7 | Light and dark icons | Yes | Home screen icon follows the OS |

Merge order: 1, 2, 3, 4, 5, then `1.4-small`, then 6, then 7. Each set takes `next` at its start as its own base.

Set 2 waits for the coordinator's relay of the user's palette approval. Set 1 does not. Set 6 waits for `1.4-small` in `next`.
`1.4-small` changes the group order in `src/screens/settings/settings/settings.screen.tsx`; the control is in
`src/screens/settings/system/system.screen.tsx`. There is no text conflict today (C7), but it is not finished, so re-check with
`git log next..1.4-small` and its diff at the start of set 6.

The order holds with these exact exceptions:

1. A light `Appearance` apply before the flip would be a half-light UI: native chrome light, JS dark. So mirror, hook and control
   land only in set 6, together with adaptive on and the plist key off. Nothing can be split out; a setter alone fails knip.
2. Adaptive on with the plist still Dark looks safe but is not proved: Unistyles falls back to `UIScreen.main.traitCollection`
   when there is no key window, which is the OS scheme. So no merged tip has adaptive on before the flip.
3. Sets 2 to 5 carry unreachable light values and code in the bundle. No flag, no demo module, no input reaches them, so the
   mechanized 2.5.19 checks pass. `kiko-compliance` reads 2.5.19 as banning "ANY hidden, dormant or undocumented feature", so a
   release cut from such a tip is the one place this is not clean. See Q3.
4. A light icon before the flip would show a light icon on a dark app, hence set 7 last.
5. Set 6 itself: a September `light` row takes effect at first launch (D1).

Light on a device before the flip: a scratch build, never merged. In a detached scratch worktree (`git worktree add --detach`) at
the set's tip, run `npm ci` (never share `node_modules`), apply `.superpowers/sdd/1.4-light-scheme/scratch-flip.patch` (removes
the plist key, swaps `initialTheme` for `adaptiveThemes: true`, nothing else), and commit it there. Ops builds it, and a device
install goes through the coordinator. The scheme follows the OS only, since there is no control yet. The coordinator confirms
afterwards that no branch contains that commit, removes the worktree, and redeploys the real tip.

## 8. Owed items

| Item | Closes in | By | Evidence |
|---|---|---|---|
| N2-R: U-C, no native-stack patch, token hex navigation colors, rows T-uc, P6B-uc, H-uc on iOS 26.5 and 27.0 | Set 5 step 3, scratch build | kiko:ops, simulators | Contact sheets and `measure.tsv`, every shot viewed by the coordinator |
| N16 full device matrix: iPhone and iPad, iOS 26 and 27, both schemes, live switch on a tab root, a pushed screen, an open sheet and the keyboard | Set 6, before merge; set 7 adds the icon row | kiko:qa drives simulator rows; the user on the device through the coordinator's deploy | Matrix in `.superpowers/sdd/1.4-light-scheme-build/n16/`, the user's verdict per row. "Everything or nothing": one failing row blocks the merge |
| Reduce Transparency, bottom-tabs #433 | Set 6, N16 row | The user on a device; simulators showed no proven effect | Device screenshots, both schemes, on and off, tab bar and glass. A failure is a user question |
| rn-screens #4081, scroll-edge blur on inactive tabs after a switch | Set 6, N16 row, demo `.kiko` imported through the real Import UI so tabs scroll under the bar | kiko:qa, then the user | Before and after scroll, each tab, both directions |
| Unistyles #1329 | Closed by source: not fixed in 3.6.0 (C2); 0 sites; set 5 guard | Planner, kiko:developer | Scan in section 6; rule fixtures |
| `bottom-sheet.component.tsx` `sheetAnimatedStyle` | Closed by source (section 6); set 1 run opens the sheet with the keyboard | Planner, kiko:ops | No `WORKLET_ACCESS_ERROR` in the set 1 run |
| N2 limit: form sheet, keyboard, date picker OPEN during a switch ran on U-A only | Set 6, N16: OS switch in System with each open (the in-app control cannot be reached with them open) | kiko:qa | Sheets with proof the popup is open |
| N2 limit: ActionSheet open during a switch | N/A for app code: 0 `ActionSheetIOS` (re-grep at set 6). Otherwise an N16 row | Developer grep | Grep result |
| N2 limit: SF Symbol recolor | Set 6, N16: a `textPrimary` symbol on a real screen, not the blue probe symbol | kiko:qa | Pixel region plus eye |
| N2 limit: native UIMenu | Set 6, N16: only system menus exist (long-press back, overflow). Open during an OS switch | kiko:qa | Sheets |
| Row L with the constants read | Set 6, N16 | kiko:qa | Frame sheets, saved Light on OS dark, saved Dark on OS light, lock on |
| Open-Alert exception | Accepted under C0; not re-measured | n/a | Row Y |
| HIG advice "Avoid offering an app-specific appearance setting" | Ruled by the user. Not a guideline requirement (findings section 2) | n/a | The Notes for Review line below |

N16 also has: iOS 18 tier (solid sheet, blur); Duo unfolded (two panes switch together); uk chips at 360 pt; a switch during a heavy
sync; calendar open during an OS switch; app-switcher privacy overlay in Light.

## 9. Tests

- Jest cannot prove a repaint. The device matrix is the acceptance test.
- Property test: all 14 swatches of both light sets and the dark set, each with its background and `surface`, tile contrast and glyph
  contrast at 3:1. A failing light value goes back to the designer; the floor never drops.
- Property test: any valid hex in dark returns verbatim; any valid hex in light returns a set member or clears 3.4. Seeds through
  `sweep`, spread per `kiko-testing`, with a new `__tests__/property-sweep-sites.test.ts` entry.
- Test files that must change (floor): `unistyles.test.ts`, `info-plist.test.ts`, `theme.test.ts`, `palette.test.ts`, `entity-tint.test.ts`,
  `settings-columns.test.ts`, `glass-surface.component.test.tsx`, `bottom-sheet` tests, `use-keyboard-done-accessory.test.tsx`,
  `large-title-screen-options.test.ts`, stack tests that pin the blur string, `color-picker.component.test.tsx`, every producer test. Others stay
  green by D7. Each set changes its pins with its code.
- Owed state: this feature adds none (no walk, no marker), so no 1.2-upgrade world applies to the "green unchanged" suites. Set 6 adds a
  September-row world (`appearance: 'light'` before first launch).

## 10. Strings, docs, compliance

- Only set 6 adds user-visible text, so no held-copy case exists: no earlier set names the feature. `settings.appearance` plus an `appearance`
  namespace (`system`, `light`, `dark`), the `language` precedent. One help step in the `systemSettings` help topic (it now says Language and App
  Lock), `kiko-translator` casing, uk reviewed by the user before a deploy that ships it. No key is removed or renamed; the changed help values take
  the "catalogue" grep in the same step. The old uk row label was "Тема" (`9d69a77e^`); the translator decides.
- Notes for Review, release skill, 2.3.1(a) duty: the 1.4 note must name the appearance control. Owed by the release track.
- Docs: `kiko-design-system` "Dark-only theme" rewritten at set 6; `kiko-architecture` language section and `kiko-domain` dark-only lines; `kiko-charts`
  opacity at set 4; a palette pointer line in `harness/kiko/skills/design-system/SKILL.md` and a plugin bump. Through `kiko:scribe` under the skill drift rule.
- Run-log gaps: none of the open gaps touches this work (grep for unistyles, theme, glass, color, palette, dark, native-stack: 0). This plan closes none and leaves all open.

## 11. User questions

**Q1. An existing install on an OS in light mode, first launch of 1.4.** The row holds `system`.
- A (recommended): it opens light. Same rule for everyone, no migration. Consequence: someone who never asked sees a light app; the control is one tap away.
- B: a data migration sets existing installs to `dark`, new installs stay `system`. Consequence: nothing changes unasked, but the control shows Dark for someone who chose nothing; a migration with its review.

**Q2. A `.kiko` restore and the mode.**
- A (recommended): the device keeps its mode (`KEPT_FROM_LIVE_ON_RESTORE`). Consequence: restoring an old file cannot reset Dark to System, and a new phone sets it once. The mirror needs no restore path.
- B: the file decides, like `language`. Consequence: every pre-1.4 file resets the mode to System, and the restore must re-sync the mirror.

**Q3. Sets 2 to 5 in `next` before the flip (section 7, point 3).**
- A (recommended): merge each set into `next` when reviewed; the 1.4 release is cut only from a tip with set 6. Consequence: small reviews and no long-lived branch; the cost is a release dependency, and an urgent 1.4 cut would have to drop sets 2 to 5.
- B: hold sets 2 to 5 on stacked merge points and merge them with set 6. Consequence: `next` is clean at every moment; other 1.4 tracks diverge from the theme and producer changes, with a larger merge.

Palette choices (page background, segmented thumb) are in the designer's file and go with the palette approval.

## 12. Backlog (strict scope)

- Rule pinning `Appearance.setColorScheme` to the one module.
- `legacyLightEraHex` table, if the user ever sees a wrong color from September data.
- Lower-case hex ring in `ColorPicker` (no ring on a lower-case stored swatch; pre-existing in dark).
- Unistyles 3.8.0 for the #1329 fix, once a nested `Text` is wanted.
- Light App Store screenshots.
- `ColorPicker` VoiceOver labels name the swatch key (`white` is graphite on light); not localized today either.
- A light launch screen is ruled out; not a backlog item.
