# check:screenshots — App Store screenshot visual regression

> Reference detail moved out of CLAUDE.md (2026-09-15) to keep the root harness doc lean. CLAUDE.md points here. This is the authoritative content; edit it here.


**Marketing vs. regression — separate flows, separate baselines,
separate builds (2026-09-12 design; regression split into 3 scenarios
2026-09-12).** `.maestro/appstore-screenshots.yaml` is the curated
10-shot MARKETING flow — the actual App Store deliverable images. It
is captured from the real, live `@callstack/liquid-glass` bloom build
(`ENVFILE=.env.screenshots`) by `npm run screenshots:capture`
(`scripts/screenshots-capture.sh`) into
`screenshots/appstore/6.9-inch/uk/`, and is **never** run by
`check:screenshots` or diffed pixel-for-pixel against itself — the
real glass is non-deterministic by design (see below). This flow is
UNCHANGED by the 2026-09-12 regression split and stays the single
source of the deliverable images.

`check:screenshots` (and its `:empty`/`:locked` siblings) run a
DIFFERENT, BROADER set of Maestro flows against STABLE-glass builds,
each with its own committed baseline dir:

| Scenario | Flow | Build (`ENVFILE=`) | Baseline dir | Check | Baseline producer |
|---|---|---|---|---|---|
| Rich | `.maestro/regression.yaml` | `.env.screenshots.stable` | `screenshots/regression/6.9-inch/uk/` | `npm run check:screenshots` | `npm run screenshots:baseline` |
| Empty | `.maestro/regression-empty.yaml` | `.env.screenshots.empty.stable` | `screenshots/regression-empty/6.9-inch/uk/` | `npm run check:screenshots:empty` | `npm run screenshots:baseline:empty` |
| Locked | `.maestro/regression-locked.yaml` | `.env.screenshots.locked.stable` | `screenshots/regression-locked/6.9-inch/uk/` | `npm run check:screenshots:locked` | `npm run screenshots:baseline:locked` |

Before running a scenario's check or baseline command, ops must build
and install the MATCHING `ENVFILE` variant on the booted, pinned
simulator ("iPhone 17 Pro Max", 6.9-inch, 1320x2868 portrait, clock set
to 2026-09-10 — see `.maestro/appstore-screenshots.yaml`'s header
comment for the full simulator prerequisite, not repeated per scenario
to avoid drift). Running, say, `check:screenshots:empty` against a
rich-scenario build (or vice versa) will fail on real, expected
content differences — that is not a harness bug, it is the check
correctly detecting the wrong build is installed.

**Why regression needs a STABLE-glass build at all** (unchanged from
before the scenario split): the real 'clear' bloom glass re-refracts
whatever content sits behind it (a chart, a scrolling list), so a
marketing-build capture of the SAME screen drifts 2-10% run-to-run on
chart/scroll-heavy screens — useless as a pixelmatch regression
baseline, since the check would then flake on the glass material
alone rather than catching a real UI regression. The fix is
`isStableGlass()` (`src/screenshot/screenshot-mode.ts`), which reads
`SCREENSHOT_STABLE_GLASS` (set only in the three `*.stable` ENVFILEs)
and makes `GlassSurface`
(`src/design-system/components/glass-surface/glass-surface.component.tsx`)
render a fixed, opaque, non-LiquidGlass surface instead — no live
sampling, so the same screen renders byte-identical pixels across
runs. The marketing build never sets this flag, so it keeps the real
bloom glass App Store screenshots are meant to showcase. Never point
any `check:screenshots*` command at the marketing dir, and never treat
a marketing capture as a valid regression baseline.

**The 3 scenarios, what each seeds** (`src/screenshot/screenshot-mode.ts`'s
`screenshotScenario()`, read from `SCREENSHOT_SCENARIO` — unset/`rich`
by default; `src/screenshot/seed/screenshot-seed.ts`'s
`buildScreenshotDataset`):
- **Rich** — the full marketing dataset (5 accounts, 5 holdings, 63
  transactions, 6 months of history), lock off. `.maestro/
  regression.yaml` captures 11 shots: the 7 marketing shots that
  measured 0% pixel drift on the stable-glass build (01-home-networth,
  03-accounts-grid, 04-account-detail, 05-holding-detail-ledger,
  06-statistics-net-worth-line, 09-settings-main, 10-settings-system —
  reusing the SAME names as the marketing flow, since they are the same
  on-screen states) plus 4 new BREADTH shots with an `r0N-` prefix so
  they can never collide with the marketing numbering:
  `r01-add-account-form`, `r02-add-holding-form`,
  `r03-add-transaction-form`, `r04-categories`. It deliberately does
  NOT reproduce the marketing flow's 3 mid-scroll shots
  (`02-home-transactions-scrolled`,
  `07-statistics-account-contribution`,
  `08-statistics-expenses-by-category`) — see "Mid-scroll shots are
  simply not captured" below.
- **Empty** — no accounts/holdings/transactions/rates/history (the
  10 default categories and the settings row are kept). `.maestro/
  regression-empty.yaml` captures 3 shots: `01-home-empty`,
  `02-accounts-empty`, `03-statistics-empty`.
- **Locked** — the SAME rich dataset, but `lockEnabled: true`, so
  `LockGate` (`src/auth/lock-gate/lock-gate.component.tsx`) shows the
  cold-launch lock screen (`testID="lock-gate"`) instead of the app.
  Screenshot mode suppresses the automatic biometric-sheet invocation
  on mount (`isScreenshotMode()` in `LockGate`), so this never hits a
  system dialog. `.maestro/regression-locked.yaml` captures a single
  shot: `lock-gate`.

**Investigated but NOT included: a "Settings > Language" sub-page.**
There is no such screen to navigate to — `SystemScreen`
(`src/screens/settings/system.screen.tsx`) renders the language
control INLINE (`settings-row-language` + `LanguageSwitch`) on the
same screen already captured as `10-settings-system`. This was
verified by reading the screen and `SettingsStackParamList`
(`src/navigation/types.d.ts`, which has no `Language` route) before
concluding there was nothing further to capture.

**Mid-scroll shots are simply not captured, not captured-then-
excluded.** The retired marketing-derived rich check used to capture
all 10 marketing shots and then SKIP 3 of them (`EXCLUDE_FROM_DIFF`)
in the pixel-diff, because each is a `scrollUntilVisible`-to-mid-
content shot whose stop offset is momentum/deceleration-dependent —
measured at 7.75%/18.9%/10.6% mismatch on the SAME stable-glass build
the other 7 shots diff at 0% on (`02-home-transactions-scrolled`,
`07-statistics-account-contribution`,
`08-statistics-expenses-by-category`). `.maestro/regression.yaml`
takes the simpler approach the 2026-09-12 design explicitly prefers:
it never captures those 3 non-deterministic frames at all, so
`scripts/checks/screenshots.sh`'s default `EXCLUDE_FROM_DIFF_CSV` is
now empty for all 3 scenarios — there is nothing to exclude when
nothing non-deterministic is captured. The exclusion MECHANISM itself
(`compare-png.js`'s `excludeCsv` CLI arg, still exercised end-to-end by
`compare-png.test.js`) is untouched and available again via the
`SCREENSHOT_EXCLUDE_CSV` env var if a future shot needs it. The stale
`02`/`07`/`08` baseline PNGs were deleted from
`screenshots/regression/6.9-inch/uk/` (2026-09-12) since
`regression.yaml` never produces matching captures for them and an
orphaned baseline file would otherwise read as a false `MISSING`
failure (`compare-png.js` enumerates ALL `.png` files actually present
in the baseline dir, not a fixed list).

**Generalized engine, thin per-scenario wrappers (2026-09-12).**
`scripts/checks/screenshots.sh` and `scripts/screenshots-baseline.sh`
are each a single, parameterized core — every FLOW/BASELINE-OR-DEST-
DIR/NAMES/LABEL value is read from an env var with a RICH default, so
`npm run check:screenshots` / `npm run screenshots:baseline` with no
env overrides reproduce exactly what they did before the split.
`scripts/checks/screenshots-empty.sh`,
`scripts/checks/screenshots-locked.sh`,
`scripts/screenshots-baseline-empty.sh`, and
`scripts/screenshots-baseline-locked.sh` are ~15-line wrappers that
set those env vars for their own scenario and `exec` the shared core —
none of the diff/fail-closed/`print_block` logic (in `screenshots.sh`)
or the collect/copy/warn logic (in `screenshots-baseline.sh`) is
duplicated. The per-scenario NAMES lists
(`REGRESSION_RICH_NAMES`/`REGRESSION_EMPTY_NAMES`/
`REGRESSION_LOCKED_NAMES`, alongside the original 10-name
`SCREENSHOT_NAMES` for the marketing flow) are declared once in
`scripts/checks/screenshot-diff/run-flow-and-collect.sh` — the single
source of truth every check/baseline/wrapper script reads, so no shot
list can drift between a check and its own baseline producer.
`run_flow_and_collect` itself now takes an optional 3rd argument (a
space-separated names string, not an array reference — this project's
`bash` resolves to 3.2 on this machine, which has neither namerefs nor
associative arrays, so a plain word-split string is the
lowest-common-denominator way to pass a caller-chosen list through a
positional argument); omitting it keeps the original 2-arg marketing
call shape.

It runs its flow (Maestro must be on `PATH`; the wrapper fails closed
if it is not) through the shared `run_flow_and_collect` helper in
`scripts/checks/screenshot-diff/run-flow-and-collect.sh`, then
pixel-diffs every captured PNG against the committed baseline of the
same name under that scenario's baseline dir, using the pure
`comparePng` core in `scripts/checks/screenshot-diff/compare-png.js`
(also usable as a CLI, under that file's `require.main` guard — see
its own header comment).

The flow/helper/capture-scripts/check family had to route around a
Maestro 2.10.0 constraint discovered only at runtime, verified by
decompiling the installed `maestro-orchestra.jar` /
`maestro-cli-2.10.0.jar` with `javap` (no other doc source covers
this): `takeScreenshot` REFUSES any path that resolves outside this
run's own `takeScreenshot` artifact folder — `Path.resolve()` on an
absolute argument discards the base path entirely, so an
`${OUTPUT_DIR}/<name>`-style absolute path (the original design)
always fails that confinement check ("... it resolves outside this
run's takeScreenshot output folder"). Every flow therefore uses a BARE
relative name per `takeScreenshot:` step (Maestro appends `.png`
itself), and `run_flow_and_collect` runs
`maestro test --debug-output <fresh temp dir> <flow>` and then
SEARCHES that temp tree for `takeScreenshot/<name>.png` by basename —
the exact nested path
(`<debug-output-dir>/.maestro/tests/<session-timestamp>/<flow-name>[_N]/takeScreenshot/<name>.png`)
embeds an unpredictable session-timestamp and flow-name segment, so it
is located by search, not assumed. `takeScreenshot` (our named
captures) and `screenshots` (Maestro's own automatic per-step debug
capture, named `step-NNN-<commandName>.png`) are two DIFFERENT
artifact collection directories Maestro writes under `--debug-output`
— confirmed on disk during this investigation — so the search is
scoped to the `takeScreenshot/` directory specifically, never the
generic `screenshots/` one. There are exactly three Statistics shots
in the marketing/rich lists (net-worth line, account-contribution,
expenses-by-category — though `regression.yaml` only captures the
first of the three, see above); a fourth, standalone category-donut
shot was tried and dropped (2026-09-12) because it landed at the same
on-screen frame as the trend-block shot on the current build — see
`.maestro/appstore-screenshots.yaml`'s own comment above that shot for
the full rationale.

**`.maestro/regression.yaml`'s navigation avoids the `back` command
entirely.** The marketing flow's own header comment already documents
one observed `back` failure (from `HoldingDetail`, `back` "landed
somewhere that never satisfied `assertVisible: accounts-grid`").
Rather than depend on an already-flagged-unreliable command, every
"return to a tab's root screen" step in `regression.yaml` instead taps
a DIFFERENT tab's icon and then taps back to the original tab's icon:
every one of the 4 tab stacks pops itself to root on blur
(`src/navigation/reset-tab-stack-on-blur.ts`, wired into all 4 via
`screenListeners={resetTabStackOnBlur}`) — a code-level guarantee, not
a Maestro timing assumption. `regression.yaml`,
`regression-empty.yaml`, and `regression-locked.yaml` were authored
without a live Maestro run (the task that produced them explicitly
disallowed running the simulator/Maestro); ops/qa must verify the
exact step sequence on a real device the first time each flow
executes, and adjust a step if the on-device behavior differs from
what the flow's own comments describe.

Chosen tolerances (kept in sync between `compare-png.js`'s own
comment and `screenshots.sh`): a pixelmatch per-pixel color-distance
`threshold` of `0.1` (pixelmatch's own documented default, restated
explicitly so it reads as a deliberate choice rather than an inherited
default that could silently drift on an upgrade) and a per-image
`maxMismatchRatio` of `0.005` (0.5% of an image's pixels may differ
before the whole image fails) — wide enough to absorb
`@callstack/liquid-glass`'s blur material and any residual sub-pixel
animation settling (reduced motion lowers this but does not guarantee
bit-for-bit-identical stills across runs), narrow enough to still
catch a real visual regression. A dimension mismatch is a hard fail,
never a crash. Every `check:screenshots*` command also fails closed on
a missing baseline, a missing captured file, a Maestro run that itself
fails, and — the failure mode that would otherwise silently defeat the
whole check — a "successful" Maestro run that captured zero PNGs.

`compare-png.js`'s pure `comparePng(baselineBuffer, currentBuffer,
options)` core is hermetically unit-tested in the colocated
`compare-png.test.js` (identical buffers pass; a large enough pixel
delta fails; a dimension mismatch fails without throwing) — no
simulator involved, modeled on `__tests__/mutation-*.test.ts`'s
"drive the real logic through a fast seam" shape. The same file also
unit-tests the pure `parseExcludeList` parser (empty/undefined input,
whitespace, trailing/double commas) and, because the exclude-skip
logic itself lives in the CLI's `require.main === module` block (not
in an importable function), drives the REAL CLI as a spawned
subprocess against hermetic temp-dir fixtures to prove the skip is
actually wired end-to-end: an excluded name with a 100%-mismatched
capture still exits 0 and prints `SKIP`, a non-excluded mismatch still
fails alongside an unrelated exclusion, and an excluded name is never
required to exist in the capture dir at all.

`pixelmatch` is pinned to `^5.3.0`, not the current major: `pixelmatch`
6.0.0+ ships ESM-only (`export default`), which neither Jest's default
CommonJS transform nor a plain `node compare-png.js` CLI invocation
(no ts-node/tsx/babel-node in this project's toolchain) can `require()`.
5.3.0 is the last CommonJS release line. `pngjs` has no such
constraint and is pinned to `^7.0.0`. Both are devDependencies:
`compare-png.js` is invoked only via `scripts/checks/screenshots.sh`
(as a CLI) and its own colocated test, never imported from app `src/`
code that ships to device.

