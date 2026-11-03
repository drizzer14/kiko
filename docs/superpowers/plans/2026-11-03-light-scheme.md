# Light color scheme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A System/Light/Dark control with a live switch, every color with a light variant, the dark look unchanged, reached through seven change sets of which only the sixth makes light reachable.

**Architecture:** Unistyles 3.6.0 adaptive themes follow `Appearance.setColorScheme` on the window. `settings.appearance` is the source of truth, a UserDefaults mirror gives the first frame. The stored dark hex stays canonical; producers map it to the set's light value with a required `scheme` argument.

**Tech Stack:** React Native 0.87.1, react-native-unistyles 3.6.0, op-sqlite and Drizzle, react-navigation native-stack 7.18.9, react-native-bottom-tabs 1.4.0, `@callstack/liquid-glass` 0.8.1, Semgrep, jest.

**Spec:** `docs/superpowers/specs/2026-11-03-light-scheme-design.md`. Decisions D1 to D7, contradictions C1 to C13 and the owed table are there.

## Global Constraints

Quoted rulings:

- "Option B: an in-app System/Light/Dark control with a live switch. C0 (not C4). Path U-C: adaptive themes on, no `setTheme`, only `Appearance.setColorScheme`. Unistyles upgrade to exactly 3.6.0, not 3.7.0 or 3.8.0."
- "The launch screen stays black."
- "kiko:designer designs the light tokens; the user approves the palette."
- "A separate light set for account/entity colors AND category colors. User: 'This applies to basically all colors in the app': every color, charts and stored hex included, gets a light variant."
- "Restore the light and dark app icons only (no tinted)."
- "Dark look stays exactly as it is (approved visuals are locked)."
- "Mutation gates are paused by the user: verify + review only. Strict scope applies (visible wrong data, own regressions, wrong texts, release requirements; everything else goes to a backlog section)."

Rules for every set:

- Integration branch is `next`, never main. Each set records `next` at its start as its own base. Merge order: tasks 1, 2, 3, 4, 5, then track `1.4-small`, then tasks 6, 7.
- Re-grep every plan fact on the actual base. Facts name a symbol or anchor; any count is a floor, and the developer measures.
- No color value appears in this plan. Light values come only from `docs/design/light-palette/palette.json`, the tracked copy made in set 2. A shape mismatch is a stop-and-ask.
- The plist key `UIUserInterfaceStyle=Dark` stays until set 6. No tip before set 6 has `adaptiveThemes` on, an `Appearance.setColorScheme` call, or a reader of `settings.appearance`.
- No flag, no demo module in `src/` (Guideline 2.5.19). A light look before set 6 uses only the scratch build of spec section 7, which is never merged.
- No release cut from a tip that has sets 2-5 and no set 6. Owner: the release track. Merging into `next` does not break this, since `next` is not a release; a cut from `main` is not affected (spec section 7, point 3).
- `src/db/settings-columns.test.ts` searches non-test `src/` for each column as an exact, whole word: in sets 1-5, a lower-case `appearance` in a non-test `src/` file, comments included, fails it.
- Dev tests: `make jest-affected BASE=<set base>` or `npx jest <files> --maxWorkers=2`. Exit 3 means the verify covers it.
- End of every set, in this order: `kiko:reviewer`; READY FOR VERIFY, and the coordinator queues `bash scripts/job-queue.sh verify <worktree> 1.4-ls-build-<N>`; a failed verify gets a fresh developer and a new verify; `kiko:retrospect`, then `kiko:scribe` for drift; BATCH READY. Agents never run `make verify`.
- `.superpowers/sdd/1.4-light-scheme/palette/` is gitignored and exists only in the worktree `/Users/drizzer14/orca/workspaces/pff-ios/1.4-light-scheme`. A build set in another worktree reads it by that absolute path.
- Mutation: paused by the user. When lifted, the gate runs per set with `KIKO_MUTATION_BASE` set to that set's base; never one whole-track run (`MUTATION_FILE_CAP`).
- No migration in this plan (D1). If Q1 option B is ruled, set 6 gains the migration and a `kiko:reviewer` step before BATCH READY.
- A UI step honors `kiko-design-system` locked decisions. Nothing locked changes in dark.

## Review Focus

1. A display hex reaching a write: a form opened in light saves the canonical dark hex. Test in task 3/7, step 3/7.
2. An unloaded settings row: a saved Light is not reset to System while the live query loads. Test in task 6/7, step 3/9.
3. A lower-case stored swatch (`#ff9f0a`): light maps it, dark returns it verbatim. Test in task 3/7, step 1/7.
4. A calendar open during an OS switch repaints and returns to its start month. Test in task 5/7, step 4/8; device row in N16.
5. A device restored from backup (UserDefaults back, database not): the row wins and the mirror is rewritten. Test in task 6/7, step 3/9.
6. A stored `appearance` outside the enum: the hook and the control read `parseAppearanceMode(row.appearance)`, and the value reads as System. Test in task 6/7, step 3/9.

---

### 1.4-light-scheme-build task 1/7: Unistyles 3.6.0

**Files:**
- Modify: `package.json`, `package-lock.json`, `ios/Podfile.lock`
- Test: none new; `src/design-system/unistyles/unistyles.test.ts` stays as it is

**Interfaces:** Produces nothing new. `initialTheme: 'dark'` stays.

- [ ] **step 1/5: Age and spec check.** `npm view react-native-unistyles@3.6.0 time --json`; expected 2026-10-21T15:00:25Z, past `.npmrc` `min-release-age=7`. Exact pin only: `"react-native-unistyles": "3.6.0"` (`save-exact=true`, `check:deps` allowlist).
- [ ] **step 2/5: Upgrade.** `npm install react-native-unistyles@3.6.0` in the worktree. Lock diff must match `git show bc2682882 -- package-lock.json` in kind: the package, its RN peer range, its nested `@babel/types`. Any other change stops the set. kiko:ops runs `make pods`; commit the `ios/Podfile.lock` change.
- [ ] **step 3/5: Run jest.** `make jest-affected BASE=<set base>`. Expected: exit 3 (`AFFECTS EVERY SUITE`); the queued verify covers it. A failure from the 3.5.1 jest mock change is fixed in the mock's caller, never by loosening an assertion.
- [ ] **step 4/5: Prove the dark look.** kiko:ops builds Release-AdHoc of the set base and the tip for iOS 26.5 and 27.0 simulators. Uninstall and `simctl keychain <udid> reset` before each install. Import `e2e/screenshot/fixtures/kiko-demo-en.kiko` through the real Import UI. Same status bar override. Run `.maestro/screenshots` flows plus: a sheet with the keyboard open (the `sheetAnimatedStyle` worklet), a form, Statistics, a pushed large-title screen. Passing: each pair differs by nothing but known moving content, the region numbers are kept, the orchestrator views every shot, and no `WORKLET_ACCESS_ERROR` appears. Evidence: `.superpowers/sdd/1.4-light-scheme-build/set1/`.
- [ ] **step 5/5: Device and commit.** Commit `build(deps): pin react-native-unistyles 3.6.0`. The native rebuild reaches the user's device only through the coordinator's deploy; the user looks at the dark app. Jest does not count as this proof. `kiko:scribe` updates the `(^3.3.0)` line in `kiko-design-system`.

---

### 1.4-light-scheme-build task 2/7: Palette copy, light values, theme registered

Starts only after the coordinator relays the user's palette approval.

**Files:**
- Create: `docs/design/light-palette/palette.json`, `__tests__/light-palette-source.test.ts`, `src/design-system/palette/palette.contrast.test.ts`
- Modify: `src/design-system/palette/palette.ts`, `palette.test.ts`, `src/design-system/theme/theme.ts`, `theme.test.ts`, `src/design-system/unistyles/unistyles.ts`, `unistyles.test.ts`, `__tests__/property-sweep-sites.test.ts` if a sweep is added here, `harness/kiko/skills/release/SKILL.md`, `harness/kiko/.claude-plugin/plugin.json`

**Interfaces:**
- Produces, `palette.ts`: `type SwatchName = keyof typeof entityColorsDark`; `type ColorScheme = 'dark' | 'light'`; `entityColorsLight`, `categoryColorsLight: Record<SwatchName, string>`; `chartSeriesLight`.
- Produces, `theme.ts`: `lightTheme` with every key of `darkTheme`; new on both: `colorScheme: ColorScheme`, `colors.categoryColors`, `colors.glyphOnLightTile`.

- [ ] **step 1/7: Copy the palette.** Copy `.superpowers/sdd/1.4-light-scheme/palette/palette.json` as approved to `docs/design/light-palette/palette.json`, formatted by biome. Run `node /Users/drizzer14/orca/workspaces/pff-ios/1.4-light-scheme/.superpowers/sdd/1.4-light-scheme/palette/check-dark.mjs <build worktree>`; the file exists only at that path, and with no argument it checks the planning worktree. Expected exit 0. Re-read `decisions.*.chosen` against the user's approval.
- [ ] **step 2/7: Write the failing pin.**
```ts
it('every light and dark token equals the approved palette file', () => {
  for (const [name, { dark, light }] of Object.entries(palette.tokens)) {
    expect(darkTheme.colors[name]).toBe(dark);
    expect(lightTheme.colors[name]).toBe(light);
  }
});
it('entity, category and chart sets equal the file', ...);
it('lightTheme has exactly the keys of darkTheme, at every depth', ...);
it('dark values did not change: darkTheme.colors minus the new keys equals its base snapshot', ...);
```
Red proof reads `lightTheme` by runtime lookup so the file type-checks (`kiko-testing`).
- [ ] **step 3/7: Implement values and registration.** `palette.ts`, `theme.ts` per Interfaces (`satisfies` the dark key shape). `unistyles.ts`: `themes = { dark: darkTheme, light: lightTheme }`, `initialTheme: 'dark'`. `lightTheme` non-color scales reference the same objects as dark.
- [ ] **step 4/7: Pin the order.** `unistyles.test.ts`:
```ts
expect(Object.keys(themes)).toEqual(['dark', 'light']); // the jest mock reads the first
expect(config.settings).not.toHaveProperty('adaptiveThemes');
expect(config.settings?.initialTheme).toBe('dark');
```
- [ ] **step 5/7: Property test, no invisible tile.** `palette.contrast.test.ts`, for each `SwatchName`, each set (dark entity, light entity, light category):
```ts
it.each(cases)('%s tile holds 3:1 against page and card', ...);   // wcagContrastRatio(swatch, background|surface) >= 3
it.each(cases)('%s glyph holds 3:1 on its tile', ...);            // glyph from isLightEntityColor rule, against the base hue, never a gradient stop
it('chartSeriesLight is a subset of categoryColorsLight', ...);
it('chartSeriesDark mapped by key equals chartSeriesLight', ...);
```
Palette `knownFailures` notes dark "glyph vs tile top" under 3:1; that stop is not this test's input. A dark set case that fails is measured and reported; the floor never drops. A light failure returns to the designer.
- [ ] **step 6/7: Run.** `npx jest src/design-system __tests__/light-palette-source.test.ts --maxWorkers=2`, then `make jest-affected BASE=<set base>`, `npm run check:typecheck`, `npm run check:knip`. Every new export has a consumer at this tip.
- [ ] **step 7/7: Scratch look and commit.** Commit `feat(theme): light palette and theme, registered and unreachable`. The app stays dark: proof by the set 1 pair run on a smaller screen list. Optional scratch build for the palette look (spec section 7). `kiko:scribe`, with this set because it first registers `light`: `harness/kiko/skills/release/SKILL.md` gains one stop step directly above step 6 (the archive), unnumbered, so the skill's "step 6" references hold: if `src/design-system/unistyles/unistyles.ts` registers a `light` theme and `ios/Kiko/Info.plist` still has `UIUserInterfaceStyle`, stop the release. Bump `plugin.json` above main's version per harness-workflow; the coordinator runs `claude plugin update kiko@kiko-marketplace` and `/reload-plugins`. Harness-sync classification: Kiko-only (it names Kiko's theme file and plist key). Check: `make doc-suites`.

---

### 1.4-light-scheme-build task 3/7: Entity map, producers, picker, glyph

**Files:**
- Create: `src/design-system/active-color-scheme/` (hook, index, test), `src/test-support/light-theme-registered.ts` (`registerLightThemeFirst(): void`, `restoreThemeOrder(): void`; the jest mock reads `Object.values(themes).at(0)`)
- Modify: `src/design-system/entity-tint/entity-tint.ts`, `entity-tint.test.ts`, `src/holdings/account-identity/`, `src/holdings/holding-identity/`, `src/statistics/account-contribution/account-contribution.ts`, `src/screens/statistics/bar-chart/bar-chart.component.tsx`, `src/design-system/components/color-picker/`, `src/design-system/components/entity-icon-tile/`, `src/screens/forms/account-form/`, `src/screens/forms/holding-form/`, `src/screens/forms/holding-select-option/`, `src/screens/statistics/bar-chart/bar-chart.component.test.tsx`, and each compile error's caller (floor: `accounts.screen`, `implicit-account-heading`, `reminders.screen`, `home.screen`, `statistics.screen`, `account-detail.screen`, `holding-detail.screen`, `holding-card`, `use-target-holding-options`)

**Interfaces:**
- Consumes: `ColorScheme`, `entityColorsLight`, `theme.colorScheme`, `theme.colors.glyphOnLightTile`.
- Produces:
```ts
entityDisplayColor(canonicalHex: string, scheme: ColorScheme): string
useActiveColorScheme(): ColorScheme            // useUnistyles().theme.colorScheme, never by reference
accountIdentity(account, scheme: ColorScheme)  // required, no default
holdingIdentity(holding, scheme: ColorScheme)
buildAccountContribution({ ..., scheme })
// ColorPicker props: swatchSet: 'entity' | 'category'; value and onSelect stay canonical dark hex
```
`resolveEntityColor(stored, typeDefault)` stays canonical; forms keep it for `ColorPicker value`.

`registerLightThemeFirst()` after the imports changes only `useUnistyles().theme`: the mock's `StyleSheet.create` resolves once, at module evaluation. A light-world test of a stylesheet color calls it before the import, inside `jest.isolateModules` (spec D7).

- [ ] **step 1/7: Write the failing map tests.**
```ts
it('dark returns the input verbatim, any case, in or out of the set', () => {
  expect(entityDisplayColor('#ff9f0a', 'dark')).toBe('#ff9f0a');
  expect(entityDisplayColor('#123456', 'dark')).toBe('#123456');
});
it.each(SWATCHES)('light maps %s by key, in either letter case', ...);
it('light out of set keeps hue and saturation and clears 3.4 to white', ...);
it('light out of set passing 3.4 returns unchanged', ...);
```
Property: `const SEEDS = sweep([...])`, seeded random valid hexes, spread per `kiko-testing`, drawn hexes asserted to include both passing and failing inputs; add the site to `__tests__/property-sweep-sites.test.ts`.
- [ ] **step 2/7: Implement.** In `entity-tint.ts` (the one `parseHex`): key lookup from `entityColorsDark`, upper-case-normalized; unexported `lowerLightnessToContrast(hex, MINIMUM_LIGHT_CONTRAST)` with `MINIMUM_LIGHT_CONTRAST = 3.4` from palette `storedHexMap.cannotMap`, HSL lightness in 1% steps; `FALLBACK_ENTITY_COLOR` stays dark gray and maps like any other.
- [ ] **step 3/7: ColorPicker test and code.** Test in the light world:
```ts
it('paints the light value and reports the dark hex', () => {
  fireEvent.press(blue);
  expect(onSelect).toHaveBeenCalledWith(entityColorsDark.blue);
  expect(swatchStyle(blue).backgroundColor).toBe(entityColorsLight.blue);
});
it('rings the swatch whose dark hex equals value', ...);
```
Forms test: `it('a form opened in light saves the canonical dark hex', ...)` on `account-form` and `holding-form`, asserting the repo argument.
- [ ] **step 4/7: Thread `scheme`.** Change producers; `npm run check:typecheck` lists callers; fix each with `useActiveColorScheme()`, adding `scheme` to `useMemo` deps. Forms: `iconColor={entityDisplayColor(effectiveColor, scheme)}`, `<ColorPicker value={effectiveColor} swatchSet="entity" .../>`. `BarChart`: `entityDisplayColor(defaultHoldingColor[type], scheme)`. The compiler does not list these three sites (spec D3, exception), so each gets a light-world test: `it('a light account form paints the tile through the entity map', ...)` in `account-form.screen.test.tsx`, `it('a light holding form paints the tile through the entity map', ...)` in `holding-form.screen.test.tsx`, `it('a light bar chart paints each slice through the entity map', ...)` in `bar-chart.component.test.tsx`.
- [ ] **step 5/7: Glyph.** `EntityIconTile` reads `theme.colors.glyphOnLightTile` instead of `theme.colors.background`. Test: light world, tile with a light hex gets the token, not the page color. Existing dark assertions stay.
- [ ] **step 6/7: Dark pins hold.** Existing `account-identity`, `holding-identity`, `entity-colors`, `holding-card`, `accounts.screen` tests gain `'dark'` where the signature needs it; no expected value changes. `make jest-affected BASE=<set base>`.
- [ ] **step 7/7: Commit.** `feat(colors): accounts and holdings display through the light map`. App stays dark: `theme.colorScheme` is always `dark` at this tip.

---

### 1.4-light-scheme-build task 4/7: Category map and charts

**Files:**
- Modify: `src/design-system/entity-tint/entity-tint.ts`, `src/statistics/category-breakdown/category-breakdown.ts`, `src/statistics/category-trend/category-trend.ts`, `src/screens/statistics/net-worth-line/net-worth-line.component.tsx`, `src/design-system/theme/theme.ts`, `src/screens/forms/category-form/`, and each caller (floor: `statistics.screen`, `categories.screen`, `transaction-templates.screen`, `transaction-row`, `home.screen`, `holding-detail.screen`, `transaction-form.screen`, `example-transaction`)

**Interfaces:**
- Produces:
```ts
categoryDisplayColor(canonicalHex: string, scheme: ColorScheme): string
resolveCategoryColor(stored, key, scheme: ColorScheme): string   // required; returns display
resolveCanonicalCategoryColor(stored, key): string               // for ColorPicker value
buildCategoryBreakdown({ ..., scheme }), buildCategoryTrend({ ..., scheme })
theme.chartFill: { areaOpacity: number; negativeAreaOpacity: number }
```

- [ ] **step 1/5: Failing tests.**
```ts
it('the same dark hex differs by producer where the palette differs', ...);  // entity vs category
it('an uncolored category hashes to a dark hue, then maps', () => {
  expect(resolveCategoryColor(null, key, 'dark')).toBe(categoryColor(key));
  expect(resolveCategoryColor(null, key, 'light')).toBe(categoryDisplayColor(categoryColor(key), 'light'));
});
it('dark area opacities stay 0.3 and 0.5', ...);
```
- [ ] **step 2/5: Implement the map** with the shared internal of step 2/7 of task 3/7, taking `categoryColorsLight`. `categoryColor(key)` stays on `chartSeriesDark`.
- [ ] **step 3/5: Thread `scheme`.** As in task 3/7. `category-form`: picker `swatchSet="category"`, `value={resolveCanonicalCategoryColor(...)}`, preview through the display path; form test: light form saves the dark hex. The compiler does not list the preview site (spec D3, exception): `it('a light category form paints the preview through the category map', ...)` in `category-form.screen.test.tsx`.
- [ ] **step 4/5: Charts.** `net-worth-line` reads `theme.chartFill` for the two stop opacities; the sign-colored stroke (locked) stays. Light pie and trend tests: wedges and strokes use the category set, legend swatch equals its wedge.
- [ ] **step 5/5: Commit.** `make jest-affected BASE=<set base>`; commit `feat(colors): categories and charts display through the light map`. `kiko:scribe`: `kiko-charts` opacity section and "Reuse the entity-color system for fills".

---

### 1.4-light-scheme-build task 5/7: Navigation themes, native chrome, calendar, guards

**Files:**
- Create: `src/navigation/navigation-theme/` (replaces `src/navigation/dark-theme/`), `rules/fixtures/kiko-no-unistyles-set-theme.{bad,good}.ts`, `rules/fixtures/kiko-no-hard-coded-native-scheme.{bad,good}.tsx`, `rules/fixtures/kiko-no-nested-text.{bad,good}.tsx`
- Modify: `App.tsx`, `src/navigation/root-navigator/root.navigator.tsx` (comment), `root.navigator.test.tsx` and `__tests__/symbol-deployment-target.test.tsx` (each imports `dark-theme/`), `docs/harness/documented-exceptions.md` (names `@kiko/navigation/dark-theme`), `src/navigation/large-title-screen-options/`, `src/design-system/components/glass-surface/`, `src/design-system/components/bottom-sheet/`, `src/design-system/components/keyboard-done-accessory/`, `src/design-system/components/text-field/text-field.component.tsx`, `src/design-system/components/holding-identity-field/holding-identity-field.component.tsx`, `src/calendar/kiko-calendar/kiko-calendar.component.tsx`, `rules/semgrep-prewrite.yml`, `__tests__/pre-write-guard-rules.test.ts`, `docs/harness/review-to-biome-inventory.md`, stack tests pinning the blur string. Floor: re-grep `dark-theme` and `keyboardAppearance` on the base.

**Interfaces:** Produces `navigationDarkTheme` (object unchanged), `navigationLightTheme` (from `DefaultTheme` and palette `navigation`), `useNavigationTheme(): Theme`.

- [ ] **step 1/8: Navigation theme.** Test: `useNavigationTheme` under each world; `navigationDarkTheme` deep-equals its base value; `dark` flag follows. Implement; `App.tsx` passes `theme={useNavigationTheme()}`. Move the imports in `root.navigator.test.tsx` and `__tests__/symbol-deployment-target.test.tsx`, and the path in `documented-exceptions.md`, in this step. `kiko:scribe` updates `kiko-design-system`, which names `navigationDarkTheme` and `dark-theme.ts`.
- [ ] **step 2/8: Native props.** `colorScheme="system"` in `GlassSurface` and `BottomSheet`; delete the `keyboardAppearance` field from `useKeyboardDoneAccessory` and the pass-through in `TextField` and `HoldingIdentityField`; `headerBlurEffect: 'systemChromeMaterial'`. Change the pins in `glass-surface.component.test.tsx`, `bottom-sheet` tests, `large-title-screen-options.test.ts` and each stack test. In `use-keyboard-done-accessory.test.tsx`, the probe stops reading the field and `it("gives the linked input the accessory's own dark keyboardAppearance", ...)` becomes `it('sets no keyboardAppearance on the linked input, so the keyboard follows the window', ...)`. Comments lose "dark-only". The tab bar props and their B1 pin stay.
- [ ] **step 3/8: Measure N2-R before the set goes further.** Write `/Users/drizzer14/orca/workspaces/pff-ios/1.4-light-scheme/.superpowers/sdd/1.4-light-scheme/scratch-flip.patch` (spec section 7) if no earlier set wrote it: it removes the plist key, swaps `initialTheme` for `adaptiveThemes: true`, and adds the scratch-only control that calls `Appearance.setColorScheme` with `light`, `dark` and `auto`. Scratch build of spec section 7 from this work, without any native-stack patch. kiko:ops runs on iOS 26.5 and 27.0, both directions: T-uc by a tap on `probe-light` and `probe-dark` on `system-settings`; H-uc by the same tap on a pushed screen, then the back step and each inactive tab; P6B-uc by a tap on `probe-delay-light` or `probe-delay-dark`, then opening the element, with proof it is open. An OS-only run (`simctl ui appearance`) does not close this row: `probe-results.md` at `c676f7dbd`, "on a tap switch only". Passing: every header element and the tab bar new by `4s`, `4s` equals `after-scroll`; the Alert card in P6B-uc keeps the old scheme, the accepted exception. The orchestrator views every shot. A tab bar miss is not an N8 case: it stops the set and goes to the user. A header lag stops the set: `patches/@react-navigation+native-stack+7.18.9.patch` returns with its `documented-exceptions` entry and pin test, the row re-runs, and a second failure goes to the user (spec D5).
- [ ] **step 4/8: Calendar.** `key={theme.colorScheme}` on `Calendar` in `KikoCalendar`. Test: `it('remounts the library calendar on a scheme change', ...)`, since `react-native-calendars` caches `styleConstructor(theme)` in a ref. `KikoCalendar` passes `initialDate` and no `current`, so the remount returns to the start month. Accepted under strict scope (spec D5); the N16 calendar row records it.
- [ ] **step 5/8: Unlinked third-party views.** Grep `style={styles` on non-RN components with a themed color. Each moves its color to a re-rendered prop or a wrapping RN `View`. Count in the report as a floor.
- [ ] **step 6/8: Guards.** Add three rules, severity ERROR, per `kiko-linter` "Adding a pre-write guard rule":
```
kiko-no-unistyles-set-theme        UnistylesRuntime.setTheme(...), UnistylesRuntime.setAdaptiveThemes(...)
kiko-no-hard-coded-native-scheme   colorScheme="dark|light"; keyboardAppearance 'dark|light'; headerBlurEffect '*Dark|*Light'
kiko-no-nested-text                <Text|MoneyText> inside <Text>
```
Each: fixture pair with `// EXPECT-FINDING`, `RULE_IDS_WITH_FIXTURES` entry, inventory row, `metadata.skill: "kiko-design-system › Native chrome follows the window"`. `kiko:scribe` adds that heading in this commit, or `__tests__/skill-citations.test.ts` fails. One heading serves all three rules, so its body states all three (`kiko-linter`: a rule's claim is checked against the cited section's own text). Run `npm run check:rules`, `npx jest __tests__/pre-write-guard-rules.test.ts --maxWorkers=2`. `check:security` must report 0 for each id.
- [ ] **step 7/8: Prove dark unchanged.** The set 1 pair run plus: keyboard over a form, a sheet, the Done pill, the iOS 18 tier (blur at rest and scrolled; locked decision "iOS < 26 fallback look"). Device look through the coordinator's deploy.
- [ ] **step 8/8: Commit.** `feat(native): chrome inherits the window trait; guards against a pinned scheme`.

---

### 1.4-light-scheme-build task 6/7: The flip

Starts after `1.4-small` is merged into `next`. Re-check `git log next..1.4-small` and that its diff does not touch `system.screen.tsx`. Needs rulings Q1 and Q2 (spec section 11); steps below assume the recommended options.

**Files:**
- Create: `src/appearance/appearance-mode/`, `src/appearance/appearance-mirror/`, `src/appearance/apply-launch-appearance/`, `src/appearance/use-sync-appearance-with-settings/`, `src/design-system/components/appearance-switch/`, `src/data-transfer/snapshot/restore-appearance.test.ts`
- Modify: `src/design-system/unistyles/unistyles.ts`, `unistyles.test.ts`, `App.tsx`, `src/settings/settings.repo.ts`, `src/screens/settings/system/system.screen.tsx`, its test, `src/db/schema.ts` (comment), `src/db/settings-columns.test.ts`, `src/db/kept-from-live-on-restore.ts`, `src/data-transfer/snapshot/restore-snapshot.ts`, `src/data-transfer/snapshot/restore-snapshot.test.ts`, `src/i18n/locales/en.ts`, `uk.ts`, `src/help/help-topics.ts`, `src/help/help-topics.test.ts`, `ios/Kiko/Info.plist`, `__tests__/info-plist.test.ts`, `ios/Kiko/SceneDelegate.swift` (comment), `docs/security/README.md`, `harness/kiko/skills/release/SKILL.md`, `harness/kiko/.claude-plugin/plugin.json`. Floor: re-grep `KEPT_FROM_LIVE_ON_RESTORE`, `NO_LIVE_DEVICE_SETTINGS` and `systemSettings` on the base.

**Interfaces:**
```ts
type AppearanceMode = SettingsRow['appearance'];         // 'system' | 'light' | 'dark'
appearanceModes: readonly AppearanceMode[]               // order: system, light, dark
parseAppearanceMode(value: unknown): AppearanceMode      // anything else is 'system'
windowOverrideOf(mode: AppearanceMode): 'light' | 'dark' | 'auto'
APPEARANCE_MIRROR_KEY = 'kiko.appearanceMode'
readAppearanceMirror(): AppearanceMode                   // NativeModules?.SettingsManager?.settings?.[KEY]
writeAppearanceMirror(mode: AppearanceMode): void        // Settings.set
applyLaunchAppearance(): void                            // light or dark: Appearance.setColorScheme; system: no call
useSyncAppearanceWithSettings(): void
settingsRepo.setAppearance(mode: AppearanceMode)
```
Each unit has its own folder barrel, as `@kiko/i18n/device-language`, so `unistyles.ts` imports no database code.

- [ ] **step 1/9: Mode and mirror.** Tests: `parseAppearanceMode` table (`light`, `dark`, `system`, `undefined`, `''`, `'LIGHT'`, `3`); `readAppearanceMirror` with no `SettingsManager` returns `'system'` and does not throw; `windowOverrideOf('system')` is `'auto'` (the value N2 ran).
- [ ] **step 2/9: Launch apply.** Test in `unistyles.test.ts`:
```ts
it('a saved mode is applied before StyleSheet.configure', ...);  // call order
it('system makes no Appearance call', ...);
it('configures adaptive themes and no initialTheme', () => {
  expect(config.settings).toEqual({ adaptiveThemes: true });
});
it('never calls setTheme', ...);
```
`unistyles.ts`: `applyLaunchAppearance();` as a statement before `StyleSheet.configure`. Keep dark first in `themes`.
- [ ] **step 3/9: Sync hook.** Mirrors `useSyncLanguageWithSettings`; mount beside it in `AppRoot`. It reads `parseAppearanceMode(row.appearance)`, never the raw column (spec D1). Tests:
```ts
it('does nothing while the row is unloaded', ...);        // no mirror write, no Appearance call
it('row wins over a stale mirror on mount', ...);         // mirror light, row system: write system, 'auto'
it('writes the mirror, then applies, on a change', ...);  // order pinned
it('does not re-apply when another settings column changes', ...);
it('a stored value outside the enum reads as system', ...);   // appearance: 'LIGHT': write system, 'auto'
```
- [ ] **step 4/9: Repo and restore.** `settingsRepo.setAppearance` through `write(...)`, as `setLanguage`. Add `'appearance'` to `KEPT_FROM_LIVE_ON_RESTORE`, `appearance: 'system'` to `NO_LIVE_DEVICE_SETTINGS` and to its copy in `restore-snapshot.test.ts`, which the settings-row assertions spread; remove it from `DOCUMENTED_READERLESS_COLUMNS` and `TAKEN_FROM_FILE_ON_RESTORE`; rewrite the column comment. `restore-appearance.test.ts`, on real SQLite, in the shape of `restore-lock-enabled.test.ts`:
```ts
it('a file with light keeps the live dark', ...);
it('an old file with system keeps the live dark', ...);
it('an old file with no appearance key keeps the live value', ...);
it('a restore with no live row gives system', ...);
it('an export carries the column', ...);
```
Also a September-row world: `it('a stored light row applies at first launch', ...)`.
- [ ] **step 5/9: Strings.** `kiko-translator` review: `settings.appearance`, `appearance.system|light|dark` in en and uk, casing per role, parity test. Help: one new step in the `systemSettings` topic, with `title` and `rowLabel` values updated; `help-topics.ts` `stepKeys` gains `help.topics.systemSettings.steps.5`; `help-topics.test.ts` changes its `['systemSettings', 4]` step count and its uk title pin. Grep the help suites and uk in this step for the old values. No key is removed. The uk text goes to the user before any deploy that ships it.
- [ ] **step 6/9: Control.** `AppearanceSwitch` as `LanguageSwitch`, through `ChipRow` (`satisfies Record<AppearanceMode, string>`). In `system.screen.tsx`, a `Card testID="settings-card-appearance"` with `SettingsRow testID="settings-row-appearance" icon="circle.lefthalf.filled"` after the language card; selected from `parseAppearanceMode(settings?.appearance)` behind the existing `isReady`; `onSelect` calls `settingsRepo.setAppearance`. Update the screen's "Order:" comment. Test: `it('selecting Light writes the row and nothing else', ...)`, no direct `Appearance` call. `__tests__/symbol-deployment-target.test.tsx` covers the symbol.
- [ ] **step 7/9: Flip.** Remove `UIUserInterfaceStyle` from `ios/Kiko/Info.plist`. `info-plist.test.ts`: `it('has no UIUserInterfaceStyle key, so the app can follow a scheme', ...)`; the `UIStatusBarStyle` assertion stays; `__tests__/launch-screen.test.ts` unchanged. `SceneDelegate.swift`: comment names `useSyncAppearanceWithSettings` and `applyLaunchAppearance`; code unchanged. `npm run check:plist`.
- [ ] **step 8/9: Device acceptance.** The coordinator queues the verify; then N16 per spec section 8, evidence in `.superpowers/sdd/1.4-light-scheme-build/n16/`. kiko:qa drives simulator rows on iOS 26.5, 27.0 and the iPad and Duo sims, with proof each popup is open; the orchestrator views every shot. The user runs device rows through the coordinator's deploy, including Reduce Transparency on and off and #4081 with the demo `.kiko` imported. One failing row blocks the merge.
- [ ] **step 9/9: Docs.** `kiko:scribe`: rewrite "Dark-only theme" and "Styling layer" in `kiko-design-system`, add `AppearanceSwitch` to the component set, `kiko-architecture` language section, `kiko-domain` dark-only lines, a palette pointer in `harness/kiko/skills/design-system/SKILL.md`, the removal of the release stop step from `harness/kiko/skills/release/SKILL.md` (the plist key is gone, so the step is always true; task 2/7 step 7/7 added it), and the plugin bump above main's version. `docs/security/README.md`: the restore paragraph naming `KEPT_FROM_LIVE_ON_RESTORE` lists only lock and notifications; it gains the appearance mode and its UserDefaults mirror. Grep `Dark-only theme` for citations before the rename, in the same commit. Commit `feat(settings): System, Light and Dark appearance with a live switch`.

---

### 1.4-light-scheme-build task 7/7: App icons

**Files:**
- Create: `ios/Kiko/Images.xcassets/AppIcon.appiconset/AppIcon-1024-light.png`, `__tests__/app-icon.test.ts`
- Modify: `ios/Kiko/Images.xcassets/AppIcon.appiconset/Contents.json`

**Interfaces:** None.

- [ ] **step 1/3: Failing test.**
```ts
it('lists a universal light image and a luminosity dark image, each present on disk', ...);
it('lists no tinted image', ...);
```
- [ ] **step 2/3: Restore.** `git cat-file blob '1702e7085^:ios/Kiko/Images.xcassets/AppIcon.appiconset/AppIcon-1024-light.png'` into the file; never `git checkout` or `git restore`. `git hash-object` equals the blob. A guard denial on the shell write stops and goes to the coordinator. `Contents.json` is the `1702e7085^` file without the tinted entry; `AppIcon-1024.png` stays the dark image.
- [ ] **step 3/3: Check and commit.** `npx jest __tests__/app-icon.test.ts --maxWorkers=2`. Commit `feat(ios): light and dark app icons`. Device row through the coordinator's deploy: icon follows the OS, both ways. Closes N16.

---

## Owed items, one line each

- N2-R: task 5/7 step 3/8, kiko:ops, sims, contact sheets, switched from the scratch control; an OS-only run does not close it.
- N16 device matrix: task 6/7 step 8/9, kiko:qa and the user, matrix folder and a verdict per row; task 7/7 step 3/3 adds the icon.
- Reduce Transparency, #433: task 6/7 step 8/9, the user on a device, screenshots on and off.
- rn-screens #4081: task 6/7 step 8/9, kiko:qa then the user, demo `.kiko`, before and after scroll per tab.
- Unistyles #1329: closed by source (not in 3.6.0, 0 sites); task 5/7 step 6/8 guard, developer, fixtures.
- `sheetAnimatedStyle`: closed by source; task 1/7 step 4/5, kiko:ops, no `WORKLET_ACCESS_ERROR`.
- Form sheet, keyboard and date picker open during a switch on U-C, SF Symbol recolor, system menus, row L with the constants read (cold launch, lock on and off): task 6/7 step 8/9, kiko:qa.
- ActionSheet: task 6/7 step 8/9, developer re-greps `ActionSheetIOS`; 0 closes it.
- Open-Alert exception: accepted under C0; no action.
- Release rule for a set 2-5 tip: task 2/7 step 7/7 adds the stop step, task 6/7 step 9/9 removes it; owner the release track.

## Estimates (per `kiko:estimator`, written by the orchestrator 2026-11-03)

Each range is dispatch to BATCH READY of agent time. It excludes queue waits, battery waits and the user's own device time. Re-check the log at each dispatch.

| Set | Estimate | Source (`stats --repo kiko --format md` `Work` column, and `memory/refs/duration-log.md`) |
|---|---|---|
| 1 | 1.5-3 h | Duration log: "implicit device fix 1" 39 min (small set); "iPad Q11 control run" 44 min (5 Release sim builds), "iPad step 2 sim slot" 56 min; queued full verify 22-26 min |
| 2 | 1-3 h | No similar row: wide range. Nearest anchors: the 39 min small set, plus the 22-26 min verify |
| 3 | 2.5-5 h | `20261019T1351-kiko-account-currency` (a value threaded through forms and repositories): `Work` 147 min, start to finish 173 min. This set has a larger caller floor (34 files) |
| 4 | 2-4 h | Same row as set 3, with fewer callers |
| 5 | 2.5-5 h | "implicit device fix 1" 39 min; `20261102T1840-kiko-guard-commit-main` steps 2 and 4, `Work` 27 and 21 min, for the guards; "iPad step 2 sim slot" 56 min for N2-R; verify 22-26 min |
| 6 | 4-8 h, plus the user's device time | `20261019T1351-kiko-account-currency` 173 min; "iPad ops 2nd pass" 21 min per simulator pass. N16 on a device: no similar row, so the range is wide and excludes it |
| 7 | 30-60 min | No similar row. Nearest anchor: the 39 min small set |

Sum: about 14-29 h of agent time. The total in findings section 5 ("8-12 developer-days") is an agent's guess: a data point, not an estimate.

## Self-review

- Spec coverage: D1 task 6/7; D2 task 6/7; D3 tasks 3/7, 4/7; D4 tasks 3/7, 4/7; D5 task 5/7; D6 task 5/7; D7 task 2/7; icons task 7/7; every owed row above.
- Types: `ColorScheme`, `SwatchName`, `AppearanceMode`, `entityDisplayColor`, `categoryDisplayColor`, `useActiveColorScheme` match across tasks.
- Tips: each new export has a consumer at its own tip. `categoryDisplayColor` lands with its callers in task 4/7; the mirror and hook land with the control in task 6/7. A tip with sets 2-5 and no set 6 is safe to merge into `next` and cannot be released (Global Constraints).
- Compiler reach: `scheme` lists producer callers only; the canonical-reader sites of spec D3's exception have named tests in task 3/7 step 4/7 and task 4/7 step 3/5.
- Proportion: signatures, test names and assertions; no function bodies.
