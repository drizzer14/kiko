# Light palette v3.1 Implementation Plan (1.4-light-scheme fix set 7c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the user-approved light palette v3.1 (one set for entity and category tiles), a computed tile glyph in light, a gamut-safe mark shade for lines and bare glyph tints. Dark stays byte-identical.

**Architecture:** `docs/design/light-palette/palette.json` stays the light source (pinned by `light-palette-source.test.ts`); `palette.ts` copies it. `entity-tint.ts` gains `markColor(hex, scheme)` and `prefersDarkGlyph(hex, scheme)`. The tile hex stays the one display color every producer returns; the mark is applied at each bare-glyph or line SINK, never in a producer.

**Inputs (read, gitignored, this worktree only):** `.superpowers/sdd/1.4-light-scheme/palette/v3.1/proposal.md` (swatch table: tile, glyph, mark), `after31.json` (`v31` block), `lib.mjs` (`markOf`, `glyphInfo`, `stops`).

## Rulings (user, 2026-11-08/09, binding)

- R1 v3.1 light hexes for category AND entity tiles (one set). Dark palette byte-identical, pinned.
- R2 green/red at ~8.6 dE00 under red-green CVD accepted. No change.
- R3 Donut slices and bars: tile color, no edge. Lines, line legend dots, bare SF Symbol tints: the mark (>= 3.05:1 on page `#F2F2F7` and card `#FFFFFF`).
- R4 Tile glyph computed: white vs black, whichever contrasts more on the base; >= 4.5:1 on the base, >= 3:1 on the worst gradient stop. Dark glyph choices identical.
- R5 `markColor` gamut-safe (chroma clamp per lightness step); a test catches the v3 yellow bug, red on a naive implementation.
- R6 Light tile vs page 3:1 waived; `palette.contrast.test.ts` moves to the new contract, not deleted.
- Strict scope: no edges, rims or other redesign. Mutation gates paused (verify + review only).

**Ruling conflict found (resolved here, coordinator confirms):** R4's computed rule applied to DARK flips five dark tiles from a white to a black glyph: brown (white 3.08:1), blue (3.65), violet (3.52), red (3.41), pink (3.52) all contrast more with black. R4 also says dark must not change, so the computed rule is LIGHT only; dark keeps today's rule (black glyph only when white < 3:1). Stop-and-ask if the coordinator rules otherwise.

## Scenario matrix (light unless stated)

| case | was | now |
|---|---|---|
| light tile glyph: yellow, mint, violet, orange, teal, pink, indigo, gray | white (`onAccent`) | black (`glyphOnLightTile`) |
| light tile glyph: white, khaki, brown, blue, green, red | white | white |
| dark tile glyph, all 14 | white < 3:1 rule | same rule, same 14 choices |
| light tile vs page/card | >= 3:1 asserted | waived (R6); glyph and mark asserted instead |
| trend line stroke, trend legend dot, bare glyph tints | tile hex | `markColor(tile)` (differs only for yellow, mint, violet, pink, gray) |
| donut slice, pie legend swatch, bar, icon tile, color-picker swatch | tile hex | tile hex (new values) |
| unmapped stored hex in light | lowered to 3.4:1 vs white | unchanged rule; glyph and mark computed from it |

## Consumer inventory (floor; re-grep on the base, anchors not lines)

MARK (8 sink edits; 23 call sites reach them):
1. `TransactionCard` `SymbolIcon color={... categoryIconColor}` (transaction-card.component.tsx). Callers: transaction-row, recurring-series.screen, transaction-templates.screen, example-transaction.
2. `SelectableRow` `{ color: iconColor }` (selectable-row.component.tsx). Callers: filter-menu (home, statistics-filter-scope, tables options), trend-filter-field, category-options-sheet, holding-select-field options, payment-holding-field options, category-field options, target-holding-sheet.
3. `FieldTrigger` `color={iconColor}` (field-trigger.component.tsx). Callers: holding-select-field, payment-holding-field, category-field, target-holding-field.
4. `IconEditor` `color={iconColor}` (icon-editor.component.tsx), via `HoldingIdentityField`. Callers: account-form, holding-form, category-form (`previewColor`).
5. `EntityHeaderIcon` `color={identity.color}`. Callers: account-detail, holding-detail headers.
6. holding-detail `testID="ledger-row"` lead `SymbolIcon color={resolveCategoryColor(...)}` (call site edit).
7. category-trend-line `stroke={entry.color}`.
8. category-trend-line legend `styles.swatch, { backgroundColor: series.color }`.

TILE (keep, 10 sites): `EntityIconTile` callers holding-card, accounts.screen, implicit-account-heading, reminders.screen, recurring-group-heading, category-card; pie-chart `fill={arc.color}` and legend `swatch` `slice.color`; bar-chart `BarRow` `fill={color}`; `ColorPicker` swatches.

Net-worth line (sign tokens) and every token tint: untouched.

## en/uk impact

None: no catalogue key added, removed or renamed; no help topic names a glyph or palette hex (grep `src/i18n/locales` for glyph/tile/line copy at step 1 to confirm).

## Run-log gaps

Open gaps `20261103T2049-kiko-1-4-light-scheme-2/1` and `20261104T1734-kiko-1-4-light-scheme/1` (dark look device check) and `.../2` (keyboard proof): left OPEN; the device row below is a light look only. No other open gap touches the palette.

---

### 1.4-light-scheme fix set 7c task 1/1: light palette v3.1

**Base:** 8c03905c1 (`KIKO_MUTATION_BASE` when gates resume). One agent at a time: qa writes red, developer greens, then the next pair.

**Files:**
- Modify: `docs/design/light-palette/palette.json`, `src/design-system/palette/palette.ts`, `src/design-system/entity-tint/entity-tint.ts`, `src/design-system/components/entity-icon-tile/entity-icon-tile.component.tsx`, the 7 mark sink files above (transaction-card, selectable-row, field-trigger, icon-editor, entity-header-icon components; holding-detail.screen; category-trend-line.component)
- Test: `light-palette-source.test.ts`, `palette.contrast.test.ts`, `entity-tint.test.ts`, `entity-icon-tile.component.test.tsx`, each mark sink's test file, `pie-chart.component.test.tsx`, `bar-chart.component.test.tsx`

**Interfaces (produced by `entity-tint.ts`):**
```ts
export const markColor = (hex: string, scheme: ColorScheme): string; // dark: identity
export const prefersDarkGlyph = (hex: string, scheme: ColorScheme): boolean;
// isLightEntityColor: export removed; its rule becomes the dark branch of prefersDarkGlyph.
```
`markColor` light: return `hex` when `min(contrast(hex, lightTheme.colors.background), contrast(hex, lightTheme.colors.surface)) >= 3.05`; else port `markOf` from `lib.mjs` (CIELAB LCH, L* down in 0.25 steps above 5, chroma bisected into sRGB gamut at each step, 14 iterations, first passing hex). Read page/card from `lightTheme` (theme.ts imports only palette and react-native: no cycle), never a hex literal (Semgrep hex rule). Reuse the one `parseHex` and `relativeLuminance`.

- [ ] **step 1/9 (qa, red): palette file and pins.** In `palette.json`: `entitySwatches.*.light` and `categorySwatches.*.light` = `after31.json` `v31` (identical sets); `chartSeries.light` from `chartSeries.keys`; add `markSwatches` (`{ <name>: { light } }`, the proposal's mark column: yellow `#B18400`, mint `#63948A`, violet `#A479CA`, pink `#EA5771`, gray `#858B99`, every other key = its tile); rewrite `swatchSets.entityRule/categoryRule/whatDiffers`, the yellow `note`s, `iconTile.glyph.rule` and `minimumContrast.light` (4.5 base, 3 worst stop) to v3.1 text. Dark values untouched (`check-dark.mjs <worktree>` exit 0). `light-palette-source.test.ts`: add `it('every light swatch mark equals markSwatches', ...)` (runtime lookup of `markColor`, kiko-testing) and `it('dark swatches stay byte-identical', ...)` with the 14 `entityColorsDark` and 8 `chartSeriesDark` hexes as literals. Red: entity/category/chart pin, mark pin.
- [ ] **step 2/9 (developer, green): palette values.** `palette.ts`: `entityColorsLight`, `categoryColorsLight` = file values; rewrite the two set comments (3.8:1 margin text is false now). `chartSeriesLight` derivation unchanged. Check: `npx jest src/design-system/palette --maxWorkers=2`; the mark pin stays red until step 4.
- [ ] **step 3/9 (qa, red): `markColor`.** `entity-tint.test.ts` `describe('markColor')`: every `lightTheme.colors.entityColors` and `categoryColors` value's mark holds >= 3.05 on `background` and `surface`; a passing hex returns unchanged (blue, red); out-of-gamut fixtures `#E8B33B` (v3.1 yellow) and `#FFD60A` hold >= 3.05; dark returns any input verbatim; output is `#RRGGBB`. Red proof: run the suite once against a naive stub (fixed chroma, skips out-of-gamut steps, falls back to the input); expected red on `#E8B33B` (1.72:1) and `#FFD60A` (1.27:1). Keep the output in `.superpowers/sdd/1.4-light-scheme/set7c/`; the stub is never committed.
- [ ] **step 4/9 (developer, green): implement `markColor`.** Per Interfaces. Check: entity-tint and palette suites green, including the step 1 mark pin; a byte mismatch against `markSwatches` is a stop-and-ask, never a file edit.
- [ ] **step 5/9 (qa, red): glyph rule and contrast contract.** `entity-tint.test.ts` `describe('prefersDarkGlyph')`: dark table of 14 (black: white, khaki, yellow, green, mint, orange, teal, gray; white: brown, blue, violet, red, pink, indigo); dark equals `wcagContrastRatio('#FFFFFF', hex) < 3` for the 14 dark swatches, `chartSeriesDark` and fixtures `#112233`, `#00FF00`, `#FF453A`, `#0A84FF`; light table of 14 per the proposal glyph column. Move today's `isLightEntityColor` cases into the dark table. `entity-icon-tile.component.test.tsx` light world: yellow tile tints `glyphOnLightTile`, red tile tints `onAccent`; dark tests unchanged. `palette.contrast.test.ts`: dark entity keeps tile 3:1 on page/card and glyph 3:1 on base; light entity and light category assert glyph >= 4.5 on base, glyph >= 3 on both `entityIconTileGradient` stops, mark >= 3.05 on page and card; drop the light tile-vs-page case with a comment naming R6; keep both chart series tests. Red: `prefersDarkGlyph` missing.
- [ ] **step 6/9 (developer, green): glyph rule.** `prefersDarkGlyph` in `entity-tint.ts` (dark: today's rule; light: `contrast(black) > contrast(white)`); `EntityIconTile` reads it with `theme.colorScheme`; drop the `isLightEntityColor` export and rewrite the comments that name it (entity-tint, entity-icon-tile). Check: `npx jest src/design-system --maxWorkers=2`.
- [ ] **step 7/9 (qa, red): sinks.** Light world, swatch yellow (mark differs from tile): each of the 8 MARK sinks paints `markColor(tile, 'light')`; dark world paints the tile (identity). TILE pins: pie arc + legend swatch and bar `fill` equal the tile hex in light (guard against an over-eager sink edit). TransactionCard selected state still passes no color.
- [ ] **step 8/9 (developer, green): apply marks.** One `markColor(color, scheme)` per MARK sink, scheme from `useActiveColorScheme()`; `undefined` stays `undefined`. No producer changes. Check: `npx jest <the step 7 files> --maxWorkers=2`.
- [ ] **step 9/9 (developer): commit.** Commits per pair, prefix `(1.4-light-scheme fix set 7c)`: `test(palette)`/`feat(design-system)` for steps 1-2, 3-4, 5-6, 7-8. Each commit passes the pre-commit tsc; never `--no-verify`.

## Owed at CHARGER BACK (battery mode now: none run until then)

`make jest-affected BASE=8c03905c1` (exit 3 means the queued verify covers it), `npm run check:typecheck`, `check:lint`, `check:import-order`, `check:knip` (the dropped `isLightEntityColor` export), `check:dup`, `check:comment-line-width`, `make doc-suites` (palette.json and skill text).

## Close-out, in order

1. `kiko:reviewer` on 8c03905c1..tip. Top question: does any dark output change (glyph, tile, mark), and does every bare glyph or line sink use the mark while slices, bars and tiles keep the tile?
2. `kiko:designer` read-only consistency review (light screens listed in the device row).
3. READY FOR VERIFY: the coordinator queues `bash scripts/job-queue.sh verify /Users/drizzer14/orca/workspaces/pff-ios/1.4-light-scheme 1.4-ls-fix-7c`; rerun until green; a failure gets a fresh developer.
4. `kiko:retrospect`, then `kiko:scribe`: kiko-design-system "Entity color and tint" (`prefersDarkGlyph` per scheme, `markColor` for bare tints and lines, light tile waiver) and "Light and dark themes"; kiko-charts "Reuse the entity-color system for fills" (slices/bars tile, trend stroke and legend dot mark) and "category-trend-line".
5. Device row for the user, through the coordinator's next deploy (light mode): Accounts and holding tiles with black glyphs (yellow crypto, gray metals, violet), Categories list tiles, Statistics donut and bars in the pale hues with no edge, the category trend lines and their legend dots in the darker mark, a transaction row and a filter menu glyph in yellow/mint. Dark mode spot check: the same screens look as before.
6. READY.
