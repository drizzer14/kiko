## Component set

Every shared component here follows `kiko-code-style`'s "One component
per file, each in its own folder" rule — read it there, not restated
here.

The primitive set has grown well past the original four. This is the
real set — enumerated at `src/design-system/components/`; read that
directory listing directly rather than trusting a copy of it here, a
new component can land between reviews of this skill:

- **TwoPaneLayout** — props are in
  `src/design-system/components/two-pane-layout/two-pane-layout.props.d.ts`; read them there
  (`mode` pins the mode the caller has settled on; the default is `useLayoutMode`). `layer` is a
  stack drawn over both panes in `wholeWindowFrame` (`pane-geometry.ts`, the window below the
  top-bar band); it moves neither pane, and its screens are told they are in no pane. It is always
  mounted, because a stack made afresh pushes its first screen instead of starting on it;
  `isLayerShown` alone gives it touches, the screen reader and `accessibilityViewIsModal`. Both
  panes keep their frames while it shows. Single mode draws no layer and renders only `primary`;
  columns/rows position two pane frames via `resolvePaneGeometry`
  (`src/design-system/pane-geometry/pane-geometry.ts`).
  Flat = a hairline divider; folded = the fold region is the gap. Each pane
  child is given a `PaneContext` (`src/design-system/pane-context/`): the
  window edges the pane touches, which a `Screen` inside it reads.
  Each pane also gets `PaneWidthContext` (same folder; read with `usePaneWidth`): the pane's own
  frame width, a number kept apart from `PaneContext` (compared by value). Only `useTitleFit`
  reads it (a long large title is measured against the pane width, not the window's); a screen's
  own sizing reads `PaneContext`.
  Rule (user ruling R13, 2026-10-09): TwoPaneLayout POSITIONS PANE
  FRAMES ONLY — no width cap, no safe-area padding; native bars span
  the full pane; the `paneMaxWidth` cap and per-pane safe areas belong
  to the screen content inside the pane. Frames are window coordinates,
  so it mounts at the window origin at full window size. A fold counts
  for columns when it is taller than wide and for rows when it is wider
  than tall (no window-size comparison); any other fold is flat (rotation
  transient). The rule is in `pane-geometry.ts`.
- **Screen** — the top-level screen container: true-black background,
  an optional `onFieldBlur` prop (`screen.props.d.ts`) that Screen hands to every text field
  inside through `FieldBlurContext` (`src/design-system/field-blur/`): a form that keeps a draft
  passes `onFieldBlur` to Screen and no blur handler to each field;
  `belowHeader` (plain branch under a SHOWN native header: no top edge and no top-bar pill, via
  `usePaneScreen` / `useTopClearance`; a plain Screen under a shown header adds the top inset
  twice, 62 pt measured) and `uncapped` (`useContentCap(isUncapped)`; a `bleedTop` or
  `bleedBottom` child does not read it), both in `screen.props.d.ts`;
  safe-area handling per mode (`scroll` drops the top safe-area edge
  under a large-title header), and a footer slot that clears the
  native glass tab bar's measured height. A `floatingFooter` Screen lays its footer over the
  rows as an overlay with no backdrop band; its buttons are capsules, and every filled one
  sits on Liquid Glass on iOS 26+ (`FooterGlassBacking`; `ghost` has no fill and stays bare);
  below iOS 26 the variant per button is in
  `src/design-system/components/footer-glass-backing/resolve-footer-glass-variant.ts`. The
  side-bar end rule is `FloatingFooterEndContext` / `useFloatingFooterEnd` in
  `src/design-system/floating-footer/floating-footer.ts` and the side-bar clause of
  `src/design-system/components/screen/bottom-clearance.ts`. A `bleedBottom` child that
  owns the screen's true bottom edge itself (e.g. a scrollable list)
  must take that same clearance from `useBottomClearance()`
  (`src/design-system/components/screen/use-bottom-clearance.ts`, built
  on `resolveBottomClearance` in `bottom-clearance.ts`; read its
  thresholds there) — never re-derive it inline, or it double-counts
  the bottom safe-area inset Screen's `SafeAreaView` already reserves.
  The hook is pane-aware: a pane that is not at the window's bottom has
  no tab bar over it and gets 0. `resolveBottomClearance` is pane-blind,
  so nothing outside `src/design-system/components/screen/` may import
  it (`kiko-no-pane-blind-bottom-clearance`). `useIsTabBarNotAtBottom` and
  `useTabBarPlacement` (both exported by the Screen barrel) and `useIsTabBarAtTop` (a
  Screen-folder module, read by `useContentCap`) are pane-blind window reads too: only
  `src/design-system/components/screen/` and
  `src/navigation/pane-stack/pane-stack-view/` may import them, or `useTabBarPlacement`
  (`kiko-tab-bar-placement-only-in-screen-and-pane-stack-view`). In a pane (a
  `PaneContext` from `TwoPaneLayout`), the `SafeAreaView` keeps only the
  window edges the pane touches (`use-pane-screen.ts`), a footer is
  capped like content (it takes the same cap as the content container,
  or sits inside the capped root), and a `scroll` Screen caps and
  centres its content container at `theme.layout.paneMaxWidth` and the
  ScrollView keeps the whole pane; a `bleedTop` child does the same on
  its own content container with `useContentCap()`; the plain branch
  caps its root. The one exception is a pane whose tab bar is at the top
  (`useIsTabBarAtTop()`, every regular iPad window, small Stage Manager
  splits included; user ruling 2026-10-21): `useContentCap()` returns no
  cap there, so the content spans the pane from the content margin where
  the native large title starts. The title margin is a wider test:
  `PaneStackView` gives the stacks `useContentMargin()` (value in
  `src/design-system/components/screen/use-content-margin.ts`; the Screen barrel exports it, a
  window-wide margin not on the pane-blind rule list) on
  `useIsTabBarNotAtBottom()` (the bar at the top OR a side; user ruling
  D1 2026-10-23), so a pane under a side bar (every Duo pose with a side
  bar) also starts its title at the content's margin; a single stack under a side bar (the
  Duo outer pose, `placement === 'side'`) gets it too. On the Duo side-bar poses that margin
  aligns the content to the native title (user ruling 2026-10-29; the reason is in
  kiko-design-system SKILL.md "Locked decisions"). The layer stack over both
  panes gets `FixedContentMarginContext` 0 in every pose, while the panes keep
  their margin. Reason (device check owed, cause not proven): with the side-bar
  margin the device showed the Tables bar go see-through during a swipe back on
  the unfolded Duo in landscape; 0 keeps our patch inert on the layer. The
  source comment in `PaneStackView` has the detail. Only the top bar
  lifts the cap: a pane with a SIDE tab bar (a Duo side-bar pose, or a
  large window) stays capped at 600 pt, with no large-window exception
  (user ruling 2026-10-21), and a pane whose bar is at the bottom keeps
  the cap and, for a bottom bar, UIKit's title margin. A screen
  that sizes itself by the room its content has (the Statistics shared
  chart row) reads `usePaneContentWidth()` (the Screen barrel: the pane
  width limited by that cap), never the pane or window width alone. The
  vertical-bar signal it consumes is
  `useVerticalBarEdge` from `@kiko/display-regions`
  (`src/display-regions/`); `scroll-to-field` reads it through
  `@kiko/display-regions` too. `useScrollIndicatorProps()` (`use-pane-screen.ts`, exported by
  the Screen barrel) is spread into every ScrollView or list a screen renders: it turns off
  UIKit's automatic indicator insets only for a pane that does not reach the window's right edge.
  Its `scroll` ScrollView is also the tab-root scroll container an active-tab
  re-tap returns to the top, where `HeaderHeightContext` is the LIVE
  header height — see
  `src/navigation/use-scroll-to-top-on-tab-press/use-scroll-to-top-on-tab-press.ts`, which targets
  the tracked expanded height rather than a live height plus a band.
  A control that moves between rows by pose (the Tables period field sits beside the filters only
  with a vertical bar edge and the `columns` layout) reads `useVerticalBarEdge` and the SETTLED
  layout mode (`useSettledLayoutMode`), never the raw mode: a raw change shows one wrong frame
  and would close an open sheet. See `src/screens/tables/tables.screen.tsx`.
  In that pose the row is Period at the leading end, then a `flexGrow: 1` spacer
  (`tables-filter-bar-spacer`, `filterBarSpacer` in `src/screens/tables/tables.styles.ts`), then
  the account and category filters at the trailing end. The spacer's `marginStart` is minus the
  bar gap, so the least Period-to-first-filter distance stays one gap. Period keeps its DS height
  (user ruling 2026-11-09: no height change). At large type the row can wrap (known limit: the
  category filter can wrap to the start of line 2).
  Keyboard offset: `react-native` 0.87.1 is patched
  (`patches/react-native+0.87.1.patch`, listed in `docs/harness/documented-exceptions.md`) so a
  ScrollView with `automaticallyAdjustKeyboardInsets` moves its content offset only when the
  focused field is INSIDE it. Every other ScrollView (the other pane, a Screen under a pushed
  form) gets only the bottom inset, which resets on hide. Never rely on a ScrollView's offset
  for a field outside it. No screen gates `automaticallyAdjustKeyboardInsets` for a sheet: a
  field in a sheet or another pane moves no other ScrollView's offset, so `CurrencyField` has no
  open-state callback and a Screen keeps the default while a sheet is open. Proof scope: a device
  check (user, unfolded Duo, 2026-10-18) proved the OTHER-pane case; the sheet case is proven by
  code only (it takes the same native branch); scrolling a field the keyboard covers into view
  inside its OWN Screen has no device proof.
  Settings' About block (app name/version, copyright, links) is an
  EXCEPTION to the ordinary "use `footer` only for a pinned
  always-reachable action" rule: it renders through the pinned
  `footer` slot even though it is not an action, because App Store
  Guideline 5.1.1(i) needs the in-app privacy policy link easily
  accessible (reachable without scrolling). A short page stays top-anchored; nothing in
  this codebase pins non-footer content to the bottom.
- **LoadingState** (`src/design-system/components/loading-state/`) —
  the shared "this screen's own data has not loaded yet" visual: a
  plain centered native `ActivityIndicator`, no text at all — a
  spinner needs no i18n string, so a `useDataReady` consumer
  (`kiko-architecture`'s useLiveQuery consumer rule) gating its whole
  render, or a single component gating one value inside an
  already-loaded parent (e.g. statement-import's
  `example-transaction`), never has to add one. Takes an optional
  `testID`, conventionally `<screen>-loading`. The spinner itself is
  delayed by `SPINNER_DELAY_MS` (200ms): the container (the plain
  background) renders immediately, but the `ActivityIndicator` only
  mounts once the delay elapses, so a screen whose first read resolves
  quickly (the common case, off the local op-sqlite worker) never
  flashes a spinner at all — readiness (`useDataReady`) itself is
  never delayed, only the visual spinner.
- **DataTable** (`src/design-system/components/data-table/`) — a grid of money amounts: props
  in `src/design-system/components/data-table/data-table.props.d.ts` (read the list there; the
  caller formats every amount). A fixed first
  column (at most 40% of the table's measured width, a long label wraps in full), one vertical
  `ScrollView`. Without `barInset`: child 0 is one `View` holding `topContent` and the caption
  (both scroll away), the header row is child 1 (sticky through
  `stickyHeaderIndices={[1]}`, opaque `surface` ground), then the body. With `barInset` (under a
  translucent bar): the scroll is the component root, no wrapper (UIKit's first-child chain
  drives the large title), with the automatic inset; side padding from `useContentMargin`, top
  `spacing(4)` (16 pt), bottom tab-bar clearance plus 16; the header is shifted flush under
  the bar by an `Animated` transform that follows the bar's height, which on iOS 27 shrinks as
  the bar minimizes (the value is native-driven) (`zIndex` 1) instead of a sticky
  index; the content does not grow to the scroll's height; the raw scroll width is kept and the
  side margin subtracted at render. The measure layer is the scroll's last child.
  `stickyHeaderIndices` moves the sticky child's own style to a wrapper, so that child must be a
  plain `View` that holds the row. `emptyContent` replaces the header and the body: no sticky
  index, `topContent` stays mounted (a filter sheet in it stays open), the measuring layer is
  unmounted and the offsets and measured widths reset while it shows
  (`src/design-system/components/data-table/data-table.component.tsx`);
  the header follows the body's horizontal offset through reanimated's `useScrollOffset`, and a
  horizontal scroll that turns on only when the columns overflow, measured against the natural
  widths. Columns that all fit share the spare room evenly (`fillColumnWidths`,
  `src/design-system/components/data-table/data-table.layout.ts`), so the grid reaches the right
  edge. Zebra rows use `colors.rowBand`; sum columns use `colors.sumTint` (not
  `sheetBackground`); read both in `src/design-system/theme/theme.ts`.
  Every width and row height comes
  from `onLayout` (a hidden measuring layer for text widths; a row is `minHeight` of the taller
  part, at least 44pt), never the window or the device type, so Dynamic Type is followed. Cell
  text is a plain RN `Text` for `fontVariant: ['tabular-nums']`. One VoiceOver element per cell
  (label, FULL value; role `button` and hint only with `onPress`); header cells are hidden; the
  caption is the `summary`. `SummaryTable` does not fit: it is a label/value stack with no
  columns, header, fixed column or scroll. The caller gives it a bounded height (Screen not
  scrolling). The table's own vertical scroll fills the Screen; Tables uses `<Screen bleedTop>`
  with `barInset` (`src/screens/tables/tables.screen.tsx`).
  React Native's sticky header wrapper reads the raw scroll offset and has no content inset
  handling, so under a translucent bar always pass `barInset`.
  A `Pressable` that is only inert omits `disabled`, because React Native then sets the
  disabled state and VoiceOver reads the element as dimmed; keep
  `disabled` for a control that is temporarily unavailable.
- **Box** — a generic layout container reading spacing/color/direction
  tokens (padding, gap, background, `direction="row"`).
- **Text** — the base text primitive reading the typography and tone
  color tokens; other text usage composes on top of this. Its `style`
  prop intentionally EXCLUDES `color` so the `tone` token stays
  authoritative — a tappable inline link (the pie legend's "Show all"
  toggle) uses `tone="accent"` (systemBlue), never an inline color;
  read `text.props.d.ts`/`text.styles.ts` for the current tone set.
- **MoneyText** — formats a `Money` value (see `kiko-domain`) and
  applies the positive/negative/neutral money color token from its
  sign. This is the only primitive that knows about `Money` — plain
  `Text` never receives a `Money` object directly.
- **ConvertedCaption**
  (`src/design-system/components/converted-caption/`) — the smaller
  base-currency figure under a total (caption, `textSecondary`,
  `formatMoney`). `money: null` renders nothing, so a caller passes
  `null` for "same currency" or "no rate" instead of guarding the
  element. Consumers: `AccountTotal`
  (`src/screens/accounts/account-total/`, the account card
  (`account-card-converted`) and the Accounts section headings
  (`renderHoldingSection`; `property-total-converted`,
  `debts-total-converted`), testID passed as `convertedTestID`; find
  them with `grep -rn convertedTestID src`), `HoldingCard`
  (`holding-card-converted`) and the account-detail headline
  (`account-detail-converted`, through `EntityAmountHeader`'s
  `secondary`). Find them with `grep -rn ConvertedCaption src`.
- **Button** — the one action button: primary/secondary/secondaryTonal/
  destructive/destructiveTonal/ghost variants (read
  `button.props.d.ts`'s `ButtonVariant` for the exact current set
  rather than trusting a copy of it here — it grows), an optional
  leading/trailing SF Symbol icon tinted to a single fixed color
  regardless of variant. `fullWidth` defaults to `true`: pass it only
  as `fullWidth={false}`, never `fullWidth` or `fullWidth={true}`
  (Semgrep `kiko-no-redundant-button-full-width`,
  `rules/semgrep-prewrite.yml`). `destructiveTonal` is the iOS "tinted
  destructive" pattern — a translucent `negativeSubtle` fill under a
  red `negative` label (a lower-emphasis dangerous action, e.g. the
  deposit form's per-row Remove in
  `src/screens/forms/holding-form/term-deposit/`: `destructiveTonal` +
  `size="small"` + a leading trash icon, so a lower-emphasis Remove/Delete
  reads as the same control everywhere it appears; the rule editor's
  matcher row in `src/screens/forms/category-rule-form/matcher-row/` is
  the same control with the `ruleForm.removeCondition` accessibility
  label carrying the row index), NOT the solid bright
  `negative` fill of `destructive`. `secondaryTonal` is its NEUTRAL
  counterpart — a faint neutral tint from the `neutralSubtle` theme
  token (`theme.ts`, sibling of `negativeSubtle`) under an ordinary
  `textPrimary` label — the standard treatment for a lower-emphasis
  inline/standalone secondary action (grep
  `variant="secondaryTonal"` in `src/` for the live consumers), replacing a plain `secondary` `surfaceHigh`
  pill for that class of control. Both tonal variants are the exception
  to the `onAccent` rule (in SKILL.md): a same-hue (or neutral) label on a
  same-hue tint is the tinted-button convention, so the label stays
  `negative` or `textPrimary`, never `onAccent`. The label has no
  `textTransform`: each catalogue supplies its own casing (English
  Button copy is sentence case; Ukrainian already is) — there is no
  style-layer transform and no per-language gate.
  **`loading` — an in-flight write.** `loading` shows a native
  `ActivityIndicator` (in the label color) over the button's label and
  icons, which stay laid out but invisible (`hiddenContent`,
  `button.styles.ts`), so the button keeps EXACTLY its resting size; it
  ignores presses and reports `accessibilityState.busy`, and is NOT
  dimmed like `disabled` (the spinner already says why). A button whose
  press awaits a slow write (the transaction form's category-override
  sheet: Apply, "All starting with X", "Just for this one", and the
  prefix confirm's Move/Add; each passes its own `useSubmitOnce`
  `isSubmitting` as `loading`, and the surface it sits on stays open
  until the write is done — never a hand-rolled spinner beside a button.
  `loading` alone blocks the presses, so a button that passes both props
  drops `disabled` while `loading` and is not dimmed then. Any other submit
  keeps it `disabled` (dimmed).
  The shared `DISABLED_OPACITY` token
  (`src/design-system/disabled-opacity/disabled-opacity.ts`) is the ONE dimming a disabled
  pressable applies — `Button` reads it, and any new disabled pressable
  reuses it too, never a fresh inline `opacity`. `children` is OPTIONAL:
  an `icon` (or `trailingIcon`) with no `children` renders an ICON-ONLY
  button (the label text node is omitted so the icon is not pushed off-center
  by the label gap). An icon-only button MUST pass an `accessibilityLabel`,
  since it has no visible text for VoiceOver — this is ENFORCED, not just a
  convention: `ButtonProps` is a discriminated union (labelled vs icon-only),
  so `<Button icon="star" onPress={...} />` with no label is a COMPILE error,
  and a `__DEV__` runtime invariant in the component throws on the same shape
  for any untyped call path. This is the shared icon-only control pattern
  — an icon-only control is built with `Button` (an `icon`, an
  `accessibilityLabel`, `fullWidth={false}`), never a raw `Pressable` +
  `SymbolIcon`.
  (There is no separate icon-button primitive; the old one at
  src/design-system/components/icon-button/ was deleted when its only
  consumer went away.)

  **Three pinned button treatments, mechanized (`rules/semgrep-prewrite.yml`):**
  the account-detail Sync button ("accountDetail.syncNow") and Change bank
  button ("accountDetail.changeBankAction") are both pinned to
  `variant="secondaryTonal"` everywhere (`kiko-pinned-sync-button-variant`,
  `kiko-pinned-change-bank-button-variant`); every sheet's Cancel button
  ("common.cancel") is pinned to `variant="ghost"` AND
  `textColor={theme.colors.negative}` together, one red ghost Cancel
  everywhere (`kiko-pinned-cancel-button-style`, the
  `confirm-sheet.component.tsx` shape). A pre-write-guard deny on any of
  these three points back here.

  **Footer "Add …" buttons carry the entity's leading symbol**
  (user-approved, D10). Same shape as account detail's "Import
  statement" (`icon="doc.badge.plus"`): ONLY the `Button` `icon` prop —
  no size/tint/spacing override, no new variant. The mapping, each read
  from its one source (never a re-typed string; read the symbol names
  in `src/holdings/entity-symbols/entity-symbols.ts`): Add holding /
  account / category / transaction → `genericEntitySymbol.<entity>`;
  account detail's footer is "Add holding" with
  `genericEntitySymbol.holding`; a kind-specific Add action (the Help
  footer's bank, crypto, property and loan actions) takes
  `accountKindSymbol[kind]` (`src/holdings/entity-symbols/`); a Help
  footer "Open …" button takes its target's `entrySymbol.<name>` from
  `src/navigation/entry-symbols/entry-symbols.ts` (the source the Settings
  rows and the Statistics tab icon read); the action list is `HelpAction`
  in `src/help/help-topics.ts`, resolved in
  `src/screens/settings/help-topic/help-topic.screen.tsx`;
  Add rule → `genericEntitySymbol.rule` (category form's footer, a lone `secondaryTonal`);
  Add lot → the holding's OWN type glyph (`holdingTypeSymbol[holding.type]`),
  never a fixed type's; Add contribution →
  `calendar.badge.plus` (the one call-site literal). "Update value" /
  "Update outstanding" add no entity, so they stay text-only. A
  generic glyph must exist on the iOS 18.2 deployment target (the holding
  glyph is `list.bullet.rectangle`, not the iOS-26 `text.pad.header`); see
  "SF Symbol availability" (in SKILL.md). A new footer "Add …" action takes its
  entity's glyph the same way.

  **Sizes — `regular` / `compact` / `small`** (read `button.props.d.ts`'s
  `ButtonSize` for the exact current set). `regular` is the 50pt tall
  footer/submit CTA. `compact` is a shorter inline action that still
  holds a 44pt minimum VISIBLE height — the iOS HIG touch-target floor
  met by the pill itself, no `hitSlop` needed or applied. `small` is
  DELIBERATELY SHORTER still: its visible height is `SMALL_MIN_HEIGHT`
  (34pt, `button.styles.ts`), below the 44pt floor on purpose, so it
  reads as clearly smaller than `regular`/`compact` — the 44pt HIG tap
  target is then restored via `hitSlop` (`SMALL_HIT_SLOP`,
  `button.component.tsx`, applied only when `size === 'small'`), not by
  the visible pill's own height. **This supersedes any older guidance
  that a compact/inline button should "never use hitSlop" — `small`
  exists specifically to pair a short visible pill with a `hitSlop`-
  restored 44pt tap target, by design, not as a shortcut.** Pick
  `compact` when the visible pill itself should still read close to
  full HIG height; pick `small` for the tightest inline/secondary
  actions, typically paired with `secondaryTonal` or `destructiveTonal`. Read `button.styles.ts` and
  `button.component.tsx` directly for the current height/hitSlop
  values rather than trusting a copy of the numbers here if they ever
  drift.

  **The paste-icon-only ghost Button convention.** A field that reads
  the system clipboard (the Monobank token entry, both legs of the
  Binance and Bybit API key/secret entry, the crypto wallet-address field —
  `src/design-system/components/monobank-token-input/`, `exchange-key-form/`,
  `binance-credentials-field/`, `bybit-credentials-field/`, `wallet-address-field/`) pairs its
  `TextField` with an icon-only trailing `Button`:
  `variant="ghost"`, `size="small"`, `fullWidth={false}`,
  `icon="document.on.clipboard"`, `textColor={theme.colors.textSecondary}`,
  and a translated `accessibilityLabel` (VoiceOver has no label text to
  read otherwise, per the icon-only rule above). The ONE place that
  builds this row is `ClipboardTextField`
  (`src/design-system/components/clipboard-text-field/`) — every paste
  field (including Settings' import-data key field) goes through it, so
  a new paste affordance reuses it rather than re-pairing a `TextField`
  and a `Button`. Its spacing is a compact icon-button spacing: the
  input row's `gap={1}` (4pt) plus the paste wrapper's
  `marginHorizontal: -theme.spacing(1)` (`clipboard-text-field.styles.ts`'s
  `pasteButtonWrapper`) put the glyph 12pt from the input and 8pt from
  the row's end, while the `small` Button keeps its own 44pt-wide tap
  target (starting exactly at the input's edge, never overlapping it) —
  the visual spacing shrinks, never the tap target. The `FieldError`
  renders below the whole input/paste row, so the paste glyph stays
  centered on the input (pinned by `clipboard-text-field.component.test.tsx`).
- **Card** (`src/design-system/components/card/`) — the shared
  CONTENT-layer surface: a solid, opaque themed fill with a defined
  hairline border, no glass/blur material at all. `selected?: boolean` (`card.props.d.ts`)
  paints the shared selected surface (accent fill, `onAccent` content) on a list row whose page
  the detail pane shows. Every content card,
  list row, and chart container that used to be a neutral (non-tint)
  `GlassSurface` now renders through this component instead — read
  its header comment (`card.component.tsx`) for the HIG rationale
  (Liquid Glass is reserved for the NAVIGATION layer, not content).
- **GlassSurface** — the shared NAV-LAYER surface only: the tab bar,
  bottom sheets, the FAB (its edge: see "FAB edge" in SKILL.md), the
  floating Screen footer's button backing (`FooterGlassBacking`: a capsule glass
  layer under each filled footer `Button`), and
  the keyboard-done accessory (grep
  `<GlassSurface` for the current consumer list; content cards use
  `Card` above instead). Real Liquid Glass on iOS 26+, a themed flat
  fallback everywhere else, an optional `bordered` edge, and
  neutral/tinted variants of the backdrop under the glass. A `tint`
  (an entity card, e.g. the FAB) paints an OPAQUE `surface` backdrop
  and an entity-color wash — see "Entity color and tint" in SKILL.md. A
  `transparent` variant paints a TRANSLUCENT
  `surfaceTranslucent` backdrop (iOS 26+; below it the BottomSheet bypasses GlassSurface) and no wash, so the screen behind reads
  through while the drift/pop-in stays softened; a `tint` always wins
  over it. `transparent`/`bloom`/`material` are NAV-LAYER variants now
  — a new CONTENT surface (a settings row, a chart card, a summary, a
  list row) is `Card` above, not `GlassSurface transparent`; an entity
  card (account, holding) keeps `GlassSurface`'s opaque `tint`. The
  historical detail below (the categories-screen `bloom` bug, the
  `CardContextMenu`/BottomSheet consumers) predates the `Card`
  migration and documents `GlassSurface`'s own variant mechanics —
  read it for how `transparent`/`bloom`/`material` behave, not as a
  current list of content-card consumers. A list row wrapped in
  `CardContextMenu` (the holding-detail ledger's manual-transaction
  rows — see `CardContextMenu` in component-set-forms.md) takes `transparent bloom` too;
  there is no swipe-reveal layer to clip a radius around any more — the
  app's one swipe-to-delete row, `SwipeableRow`, was removed in favor of
  the touch-and-hold context menu. Neither prop keeps the fully-live see-through material (no
  backdrop). A fourth variant, `material`, is `transparent`'s sibling for a
  surface whose backdrop is STATIC while shown (BottomSheet is the first
  consumer, on iOS 26+ only: below iOS 26 the sheet bypasses `GlassSurface`
  for an opaque fill): it keeps the fully-live see-through glass on the glass path
  (no backdrop at all, so the material samples the real content behind it —
  a true blur, not `transparent`'s partially-pinned sample) but, unlike a
  plain surface, still takes a TRANSLUCENT (not opaque) fallback fill on the
  non-glass path, so a device without Liquid Glass reads see-through too. The
  Home transaction row is a SECOND consumer that does NOT meet the static-
  backdrop condition (it is a scrolling list card, so its live sample drifts
  in lightness on scroll) but takes `material` anyway per an explicit product
  decision to match the sheet's look, knowingly accepting that drift over
  `transparent`'s partial pin — so the static-backdrop rule is the default
  guidance, not an invariant. A `tint` wins over `material` the same way it
  wins over `transparent`. Read
  `glass-surface.props.d.ts` for the exact current prop set rather than
  trusting this summary if it drifts.

  **`bloom`'s first-paint re-sample.** `bloom` (see the prop's own doc)
  opts a neutral surface into maximum live-sampling: on the real glass
  path it renders a `LiquidGlassView` with NO backdrop under it and
  `effect="clear"`. A `'clear'`-effect glass samples its backdrop exactly
  once, at native layout — there is no imperative re-sample API. Confirmed
  2026-09-12: the categories screen's category card (`transparent bloom`,
  a `react-native-sortables` `Sortable.Grid` item) rendered fully
  transparent on first paint on iOS 26+, because Sortable MEASURES an item
  first and only then transform-repositions it — the glass's one-shot
  sample fired during that measure pass, before the transform landed, with
  nothing solid behind it yet. Dragging the card "fixed" it only because a
  drag teleports the card into a portal, which remounts a fresh
  `LiquidGlassView` already in its real position. The Statistics
  account-contribution pie card (also `transparent bloom`) never showed
  this, because it is a plain `<Screen scroll>` child that lays out once,
  already in its final spot — the same combination of props, two different
  layout containers, only one of them broken. `GlassSurface` now
  compensates for this ITSELF, generically, for every `bloom` consumer: a
  one-time, two-`requestAnimationFrame`-deferred remount
  (`needsResample`/`remountToken`/`hasResampled` in the component) forces
  a fresh native `LiquidGlassView` after the surface has settled into its
  real on-screen position, whatever container placed it there. This is
  transparent to a consumer — nothing about writing `<GlassSurface
  transparent bloom>` changes — and `bloom`'s own documented no-backdrop/
  `'clear'`-effect semantics are unchanged; only the shared component
  gained a compensating one-shot re-sample. A `bloom` surface that is
  itself STATIC and never re-triggered by anything else (a settings card,
  a chart card, a list row) no longer needs a scroll/drag/animation to
  become visible — the fix lives in `GlassSurface`, not in any consumer's
  layout choice.
- **BottomSheet** — the one bottom-sheet primitive: a transparent
  `Modal`, a full-bleed dismiss scrim, and a bottom-anchored sheet
  card owning its own safe-area-aware bottom padding. Every sheet in
  the app routes through this rather than hand-rolling
  `Modal + backdrop + Box` again. The sheet card's own BACKGROUND is a
  real translucent blur MATERIAL, reusing `GlassSurface`'s `material`
  variant — a live-sampling Liquid Glass on iOS 26+ (no color-pinning
  backdrop under it, so the sheet reads as an actual blur of the
  content behind it, not a near-opaque flat panel). Below iOS 26 the card
  is instead the opaque `sheetBackground` (`sheetFallbackFill`, see "iOS <
  26 fallback look" under Locked decisions) — real glass branching,
  backdrop, and base stay owned by `GlassSurface` on the glass path. `material` is
  `transparent`'s sibling variant for a surface whose backdrop is STATIC
  while shown (a modal sheet): `transparent` instead pins a translucent
  backdrop under the glass to soften lightness drift on a scrolling
  CARD, a concern that does not apply to a static sheet, so a modal
  sheet takes the live-sample `material` variant instead — read
  `glass-surface.props.d.ts`'s `material` doc for the exact distinction
  and the constant-token doc comment on `theme.colors.scrim` in
  `theme.ts` (kept at 0.4, not heavier, because the sheet's glass samples
  that same scrim). It is rendered as an
  absolutely-positioned first child of the sheet card
  (`bottom-sheet.styles.ts`'s `glassFill`), painted BEHIND the grabber
  and body that follow it in JSX. Since this is the ONE shared
  primitive, every sheet in the app gets the glass background on iOS 26+ from this
  single change point. `GlassSurface` only exposes a single ALL-corner
  `radius` (there is no top-only variant); the sheet still needs to read
  as top-rounded / bottom-flush (anchored to the screen's bottom edge),
  so `glassFill` deliberately sizes the `GlassSurface` `theme.radii.lg`
  taller than the card, past its own bottom edge — the card's own
  `overflow: 'hidden'` (added for exactly this) then clips away the
  region where `GlassSurface`'s bottom corners would otherwise curve,
  leaving a flat bottom edge and correctly-rounded top corners rather
  than a small gap leaking the dismiss scrim through the bottom
  corners. `GlassSurface`'s own `padding` prop is passed `0` on this
  layer — the card's EXISTING padding (`styles.sheet`'s
  `SHEET_PADDING_STEP`) stays the single inset, never stacked with a
  second one. The sheet is a GROUPED surface: its base (the live glass
  on iOS 26+, the opaque `sheetBackground` #1C1C1E below — both darker
  than `surfaceHigh` #2C2C2E) sits one level BELOW the cards/controls on
  it, so a control reads as raised instead of blending into the sheet
  (a chip or segment on it uses the faint `neutralSubtle` fill — see
  `ChipRow` and `SegmentedControl` in component-set-forms.md); a base at `surfaceHigh`
  itself would swallow a selected pill. The scrim stays full-bleed. The card is full width on
  one pane; on two panes it is narrowed to `theme.layout.sheetMaxWidth` and centred, and with a
  fold reported it is centred inside the primary pane, so it never straddles the hinge; with
  rows and a fold its height is capped to the primary pane (`resolveSheetFrame` in
  `bottom-sheet.layout.ts`, applied in `bottom-sheet.component.tsx`; read the width in
  `theme.ts`). It caps
  its own height at a fixed 66%-of-window ceiling and takes an optional
  `maxHeight` prop that can only tighten that cap further, plus a
  `scrollable` prop (defaults `true`) that wraps `children` in a
  `ScrollView` so overflow scrolls instead of clipping — a sheet that
  needs its own pinned header/footer or a scroll-to-selection ref
  (date-range-field, category-field, icon-picker-modal) passes
  `scrollable={false}` and renders its own inner `ScrollView`, or a `FlatList` when the rows
  are unbounded (`currency-field`, `src/screens/tables/cell-rows-sheet/`; the total stays
  outside the list).
  Its drag-to-close grabber's pure math (`clampSheetTranslate`,
  `shouldDismissSheet`) lives in `bottom-sheet.gesture.ts` — see
  `kiko-gestures`. Read `bottom-sheet.props.d.ts` for the exact current
  prop set rather than trusting this summary if it drifts.

  **`onDismiss` vs `onClosed` — a close-timing contract, not two names
  for the same event.** `onDismiss` fires the moment a close is
  REQUESTED (a scrim tap, or a hardware/gesture back); `onClosed`
  (optional) fires only when the underlying RN `Modal` reports its OWN
  `onDismiss` — the close ANIMATION has actually finished (iOS only; RN's
  `Modal` never fires it on Android). Anything that must not run until
  the sheet is visually gone — most importantly navigating the screen
  away — belongs on `onClosed`, not `onDismiss`: wiring a screen
  navigation to `onDismiss` pops the sheet mid-animation. Read
  `bottom-sheet.props.d.ts`'s `onDismiss`/`onClosed` doc comments as the
  source of truth. Separately, the `testID` prop produces a
  `${testID}-modal` hook on the underlying RN `Modal` itself
  (`bottom-sheet.component.tsx`), distinct from the separate
  `backdropTestID` prop, which names the dismiss-scrim `Pressable` (e.g.
  a filter menu's `${id}-backdrop`) — don't conflate the two when wiring
  a sheet's test hooks.

  The full-bleed dismiss SCRIM (a sibling of the sheet card, not the
  card's own `glassFill` above) is, on iOS 26+, a SEPARATE Liquid Glass layer with a
  DEVICE BUG fix of its own (below iOS 26 the scrim is a plain `scrimFallback` View with no rim to hide;
  it shares `styles.backdropFill`'s sizing, so the overscan is harmless there, not a fix): Liquid Glass draws a native specular rim at
  the edge of whatever bounds it is given (a `UIGlassEffect` property,
  not a border/inset this app draws), which at the scrim's original
  exact-screen-size bounds landed on the screen edge and read as a sharp
  1px hairline around the whole perimeter, on every Modal (all route
  through this one scrim). The fix keeps the live blur (never drops to a
  flat dim) and instead extends `styles.backdropFill`'s own bounds past
  all four screen edges by `BACKDROP_RIM_OVERSCAN` (32pt,
  `bottom-sheet.styles.ts`) — the Modal's native window still clips at
  the real screen edges regardless, so the overscan only relocates where
  the now off-screen rim falls, leaving nothing but uniform blur visible.
  The rim is only reproducible on an iOS 26+ Liquid Glass device, never
  in the simulator or a unit test — any future scrim-sizing change here
  needs on-device confirmation, not just a green test suite.

  The grabber region (`styles.grabberRegion`) also floors at
  `GRABBER_REGION_MIN_HEIGHT` (44pt, the HIG touch-target minimum) via
  `minHeight` rather than a `hitSlop` — a header-less sheet's region
  used to measure only ~21pt (padding + the 5pt pill, no header sibling
  to fill it out), under the 44pt floor with nothing to compensate.
  `minHeight` grows the region's OWN claimed bounds (still fully inside
  `grabberRegion`, still draggable) rather than expanding the Pan's
  hit-test area past that View's edges the way `hitSlop` would, so the
  fix can never bleed into the scrollable body that starts only once the
  region ends — see "Touch targets" under the standing HIG reference
  in SKILL.md for the general rule this follows.

  **Keyboard-aware sheet geometry.** A sheet whose content includes a
  focusable input (e.g. `CurrencyField`'s search) must not let the
  keyboard cover its own content or the floating keyboard accessory —
  `bottom-sheet.keyboard.ts` (`src/design-system/components/bottom-sheet/`)
  holds the pure, worklet-tagged math this needs: `resolveKeyboardLift`
  (how far the sheet rises — the keys' own height, not the raw keyboard
  frame), `resolveKeyboardAwareMaxHeight` (the 66% height cap re-measured
  against the currently-visible window once the keyboard has lifted the
  sheet), and `resolveKeyboardAwareBottomPadding` (the sheet's bottom
  padding while the keyboard shows, so its own glass — not the modal
  scrim — sits behind the floating accessory strip). `bottom-sheet.
  component.tsx` wires all three into its `useAnimatedStyle` alongside
  `KEYBOARD_ACCESSORY_HEIGHT` (`keyboard-done-accessory.styles.ts`, the
  accessory's fixed height) and its own `KEYBOARD_CORNER_OVERLAP`
  constant (extends the lift/padding pair to also cover the keyboard's
  rounded top corners). Every one of these functions carries its own
  `'worklet'` directive since `useAnimatedStyle` calls them directly —
  see `kiko-gestures`'s "Every function called inside a worklet needs
  its own `'worklet'` directive" rule before touching any of them, and
  read the file directly for the current derivation rather than trusting
  the numbers restated here; they drift with each device-feedback round.
  All three reduce to a no-op with no keyboard shown, so every
  keyboard-less sheet consumer sees no layout change. Reanimated's own
  `useAnimatedKeyboard()` is NOT used to drive any of this — see
  `kiko-gestures`'s "`useAnimatedKeyboard()` is banned" rule.

  **A scrollable list inside a sheet that can host a keyboard needs
  `keyboardShouldPersistTaps="handled"`.** A `FlatList`/`ScrollView`'s
  default `keyboardShouldPersistTaps` ("never") swallows the FIRST tap on
  a row while the keyboard is up — the tap dismisses the keyboard instead
  of hitting the row. `CurrencyField`'s search results list
  (`currency-field.component.tsx`) sets `keyboardShouldPersistTaps="handled"`
  for exactly this reason (the same fix `Screen`'s own background
  `ScrollView` applies for its search field, per that file's comment); any
  new sheet content that combines a focusable input with a tappable list
  below it needs the same prop. `cell-rows-sheet` has no input, so it sets none.
  `initialNumToRender` trips `check:full-word-identifiers` outside the exempted files (see
  its EXEMPTIONS); use `windowSize`, as `cell-rows-sheet` does.
- **SelectableRow** (`src/design-system/components/selectable-row/`) —
  the shared single-select row for a `BottomSheet` list: a 44pt-minimum
  tap target that fills with the accent background when `selected` (the
  `ChipRow` selection vocabulary), with a leading checkmark
  slot, an optional leading `icon` (SF Symbol) or `leadingText` mark
  (mutually exclusive, for a glyph with no SF Symbol form — a currency
  sign or ISO code), an optional trailing node pinned to the row's far
  right and top-aligned to the label (the bank picker's capability
  icons — see the transparency principle in SKILL.md), and an optional
  `description` — a second line rendered below
  the label in the SAME leading-slot-aligned column, wrapping onto
  multiple lines rather than truncating, for a subtitle explaining what
  the option means (the account-kind picker's "Real estate, car,
  valuables, money you lent" hint, `AccountKindField`,
  `src/screens/forms/account-kind-field/`). The caller owns any tone
  switching (e.g. `onAccent` once selected) on whatever it renders in
  `description`/`trailing` — `SelectableRow` does not inspect either.
  This is the ONE select-sheet row: a labeled-field-plus-`BottomSheet`
  picker (`FieldTrigger` + `BottomSheet` + a `SelectableRow` per option)
  is the shared "select field" family replacing the older inline
  `ChipRow` for a picker with more than a couple of options.
  **SelectField** (`src/design-system/components/select-field/`) is the
  GENERIC version of this shape — `label`/`sheetTitle`/`options`/
  `selected` (nullable — see below)/`onSelect`/`labels`/optional
  `subtitles`/optional `icons`/`placeholder`/`required`/`disabled`/
  `error`/`testID`/optional `capped` (caps the trigger at
  `theme.layout.selectTriggerMaxWidth` in `src/design-system/theme/theme.ts`:
  trigger = min(column, cap); for a short one-phrase value such as the Tables
  period; a larger Dynamic Type size wraps inside the cap) — and is now the ONE shared
  implementation: a
  `property` account's Type-as-category field (`PropertyTypeField`,
  replacing the generic holding-type picker for that one account
  kind — see `kiko-domain`'s "`property_item` / `metal` create-form
  sections"), the `debt` account's Type-as-loan-kind field
  (`LoanKindField`, with one `loanKindSymbol` glyph per kind; 6 and
  4 long option names, too wide for a `ChipRow`), the Bond form's
  coupon-frequency picker (shared by both `BondIsinSection`'s ISIN-mode
  unmapped-frequency picker and `ManualBondFields`'s own frequency
  field), the holding-type picker, the column-mapping form's time-zone
  field (every `sourceTimeZoneIds` entry,
  `src/statement-import/column-mapping/source-time-zone.ts`), `AccountKindField`, and `ModeSelectField` all reach
  for it directly. `SelectField`'s optional `onSelectClosed(option)` runs
  once after the sheet a pick closed has finished closing (the
  `onClosed` contract above): wire a screen navigation to it, never to
  `onSelect` (`AccountKindField` forwards it).
  The close calls the LATEST render's `onSelectClosed` (a ref refreshed every render), so it
  sees the state the pick just set. `SelectField`'s optional
  `closesWithoutAnimation(option)` names the picks whose sheet closes with
  `BottomSheet`'s `animationType="none"` (`'fade' | 'slide' | 'none'`,
  default `'fade'`), so `onSelectClosed` follows the pick at once instead of
  after the cross-dissolve (its length is inferred, unmeasured): only for a
  pick that LEAVES the screen, where the fade is just a wait (the account
  form's Property and Debt, and the holding form's Bank, Cash, Crypto,
  Metals and Broker; the holding form's other implicit kind stays in that
  form and keeps the fade). `SelectField`'s optional `emptyAction`
  (`{ label; onPress }`, `select-field.props.d.ts`) renders an action row with a plus glyph in the
  sheet only when `options.length === 0`; the caller passes the translated label (no i18n in the
  design-system component), the action runs after the sheet has closed with no animation, and it
  is never reported to `onSelect` or `onSelectClosed`. `SelectField`'s optional `emptyOption`
  (an `Option`) makes the trigger's value `textSecondary` while it is selected, as for a `null`
  selection (`RecurringMarkField` passes `'none'`). `TemplateSelect`'s "Add template" row
  (`forms.transaction.addTemplate`, en and uk) uses it; `HoldingSelectField` and
  `PaymentHoldingField` build their own sheet and keep their own create row. The
  `closesWithoutAnimation` flag is opt-in per call site; every other pick and
  every other sheet keeps the fade. It works because RN's iOS Modal host
  re-reads `animationType` on every props commit and uses it for the dismiss
  (`RCTModalHostViewComponentView.mm` `updateProps` sets
  `_shouldAnimatePresentation`, then `ensurePresentedOnlyIfNeeded` dismisses
  with it), so `SelectField` sets `'none'` in the SAME render that hides the
  sheet and clears it on the next open (`AccountKindField` forwards the prop,
  the owning screen decides which kinds). Jest renders a hidden Modal as
  nothing; assert the close animation with `spyOnModalAnimationPerTest(testID)`
  (`src/test-support/modal-animation-spy.ts`), which reads the TRANSITION
  render (the first render of the latest run in that state), never the last
  render or the mount render. It assumes one mounted Modal per testID. Call it
  at describe or file level, never inside a test or a hook (Jest rejects a
  hook defined there): it registers its own beforeEach spy and afterEach
  restore, so a caller has nothing to restore and cannot leak the spy into a
  later test. Read a row's SF Symbols in a test with `glyphNamesWithin` and
  `glyphTintsWithin` (`src/test-support/glyphs-within.ts`). The Jest `Text`
  mock strips `variant` and `tone`; a layout pin that needs them imports
  `src/test-support/mock-text-variant-tone.tsx` and reads the tree with
  `layoutOf` (`src/test-support/layout-of.ts`); `src/test-support/mock-text-tone.tsx`
  is the tone-only variant. The `jest.mock` factory returns the helper through a getter (it is
  read after the import ran), never an inline copy that forwards `variant`: Semgrep
  `kiko-no-inline-text-variant-mock` denies an inline copy in the factory, but not a
  module-level local copy returned through the getter (its known limit), so a test that
  also pins a style imports the helper, which forwards `style` too, and never writes
  its own copy. `AccountKindField` and
  `ModeSelectField` (`src/screens/forms/`) are now thin wrappers over
  `SelectField` — `ModeSelectField` keeps its own caller-side `visible`
  gate (a convert has no mode toggle at all) ahead of it. `BankTypeField` and
  `ExchangeTypeField` (`src/screens/forms/exchange-type-field/`) are the hand-rolled
  `FieldTrigger` + `BottomSheet` pickers; `BankTypeField` is kept apart because it
  carries extra behavior `SelectField` doesn't generalize (an
  always-last "Other bank" row (`OTHER_BANK_ID`) that shows no capability
  caption and carries one column-mapping glyph (`increase.indent`, the same
  `COLUMN_MAPPING_SYMBOL` constant every named bank's column-mapping icon uses,
  testID `bank-type-option-other-column-mapping-icon`) instead of the connect
  and statement-format icons the named banks show (its VoiceOver label reads
  the no-parser banks' description, `bankColumnMappingOnly`),
  the Guideline 3.2.1(viii) / 5.2.1 "not a bank, not affiliated" disclaimer as a
  caption under the trigger (`forms.account.bankDisclaimer`, the same place and
  `caption`/`textSecondary` style as `BrokerTypeField`'s `brokerDisclaimer`,
  shown whatever is picked, "Other bank" included: it names no bank; the sheet
  carries no second caption), and dual capability icons) — retrofitting it onto
  `SelectField` is a separate, larger task. `BankTypeField` also takes
  `disabled` (`FieldTrigger`'s shared dimmed, inert state, as `SelectField`
  does; the edit form sets it, with no hint caption, and the disclaimer stays
  because the field still names a bank). `sheetTitle` is REQUIRED and distinct from `label` — a
  field label (sentence case) and a sheet title (Title Case) are two
  different UI roles per `kiko-translator`'s casing-by-role rule, so the
  sheet header can never just reuse the label verbatim. The same REQUIRED
  `sheetTitle` prop is on every other picker-sheet field too (`DateField`,
  `TimeField`, `CategoryField`, `BankTypeField`, `ExchangeTypeField`, `HoldingSelectField`,
  `PaymentHoldingField`, `CurrencyField`, `FilterMenu`,
  `ColumnSelectField`); the trigger's `label` stays its caption and
  accessibility label. `SelectField`'s
  `selected` accepts `null` for a picker that legitimately starts with
  nothing chosen — the trigger then shows `placeholder` at
  `textSecondary`, the same "no default" contract a `ChipRow` used to
  fake by widening its option type to admit a value (`''`) that matches
  nothing. A picker whose `selected` is never actually `null` (an
  account always has a kind, a transaction always has a mode) still
  supplies a `placeholder` to satisfy the contract — it is simply never
  shown.

The set continues in component-set-forms.md under "Component set (continued)".
