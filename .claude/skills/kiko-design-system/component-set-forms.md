## Component set (continued)

- **ConfirmSheet** (`src/design-system/components/confirm-sheet/`) —
  the themed confirm-or-cancel `BottomSheet`: a title, an optional
  body `message` (omitted for a bare title-only confirm), a `confirmLabel`,
  and `onConfirm`/`onCancel` — Cancel AND a scrim/back dismiss both run
  `onCancel`, a dismiss behaves like Cancel. An optional `destructive`
  flag switches the confirm button to the `destructive` Button variant
  (a red fill) instead of the accent `primary` one. This is the one
  confirm surface in the app — a delete/destructive confirmation routes
  through it rather than a native `ActionSheetIOS` or a hand-rolled
  `Modal`.
- **InfoHint** (`src/design-system/components/info-hint/`) — a caption
  `textSecondary` message led by an `info.circle` `SymbolIcon` (caption
  icon-size token), top-left aligned, text wrapping beside the icon, one
  accessible element labelled by the message. Used for the Connect
  reminder in the three Connect fields and for the Template tab's
  no-templates hint (`template-select`, which also carries the "Add template" row; `EntryTabs`
  forwards `onCreateTemplate`).
- **NoticeBanner** (`src/design-system/components/notice-banner/`) — an
  inline, non-modal notice for a state the user can keep working
  around (never an alert or sheet): a `surfaceHigh` box, a `caption`
  `textSecondary` message, and an optional `secondaryTonal` `small`
  action button. The button renders only when BOTH `actionLabel` and
  `onAction` are given. Read `notice-banner.props.d.ts` for the props.
  Find its consumers with `git grep NoticeBanner src/screens`. On the
  holding detail, a stored state the user must fix elsewhere is a
  NoticeBanner with no action, worked out on the fly from the row, in its
  own folder (`holding-detail/<name>-notice/`, `holding` prop, `null` when
  nothing is wrong): `OversizedSaleNotice` (a metal sale larger than what was held before it;
  kiko-pricing's "Stored lots are costed again once per device").
- **The exchange history footer** (`holding-detail/exchange-history-footer/`): the caption
  lines under the last ledger card of an exchange holding (an "Earlier history" amount and the
  not-listed note), `caption` `textSecondary`. The list container's gap puts it 8pt under the
  last card, and its `paddingTop` step (`exchange-history-footer.styles.ts`) makes the gap the
  20pt a day header keeps above its caption label: keep that gap, read the comment there.
- **ReminderOfferCard** (`src/design-system/components/reminder-offer-card/`)
  — the NoticeBanner family's two-action sibling: an inline, non-modal
  invitation (never a notification, sheet, or alert, and never an
  error/warning tone). A `Card` (solid `surface` fill, hairline border,
  `md` radius) with `padding={3}` and the banner's `spacing(2)` gap, a
  `body` `textPrimary` message, then a wrapping row of a `primary` `small`
  accept and a `secondaryTonal` `small` dismiss (the user's "ghost" = faint
  tint), both `fullWidth={false}`, 44pt taps via `small`'s hitSlop. Read
  `reminder-offer-card.props.d.ts` for the props (all required but
  `testID`). Differs from NoticeBanner: a content Card (not the
  `surfaceHigh` `sm` block), body primary text (not caption secondary),
  and two required actions (not one optional tonal one). First
  consumer: `AccountDetail`'s reminder offer.
- **EmptyState** (`src/design-system/components/empty-state/`) — Apple's
  `ContentUnavailableView` pattern for a screen with no data yet: centered
  on the screen background (no Card, no glass), a `display`-size
  `textSecondary` symbol, a semibold `body` `textPrimary` title (sentence
  case, no final "."; never the `heading` variant, which would pull its keys
  into `TITLE_KEYS`), a centered `caption` `textSecondary` message (one or
  two sentences, final "."), then an optional `primary` `small` (34pt
  pill, 44pt tap via `SMALL_HIT_SLOP`; user ruling 2026-10-08, the regular 50pt
  read as disproportionately tall) non-full-width `Button` from `action: { label, icon?, onPress }`. Strings come in as
  props. `testID` gives `<testID>-icon` and `<testID>-action`. Gate it on
  `useDataReady`, never on `data.length === 0` alone. Call sites: Home
  (`home-empty`), Statistics (`statistics-empty`) and Accounts (`accounts-empty`)
  fill the screen when there is no account; `AccountDetail`
  (`account-detail-holdings-empty`) shows it inside the Holdings section, under
  the kept "Holdings" heading, when the account has no ACTIVE holding (every
  account kind; closed holdings do not count). Its action is the footer's Add
  holding, so the footer drops that button while the empty state shows (the
  Import statement button stays), as Accounts drops its footer. The
  Transaction templates list (`transaction-templates-empty`, Settings stack,
  `src/screens/settings/transaction-templates/transaction-templates.screen.tsx`)
  shows it with Add template as its action, and its footer button hides
  while it shows. The loan holding detail's one payments list shows it
  when no row exists (`holding-detail-loan-payments-empty`, copy
  `holdingDetail.emptyLoanPayments.*`).
  The list above can drift: grep `<EmptyState` for the call sites.
- **NotificationPreAlertSheet**
  (`src/design-system/components/notification-pre-alert-sheet/`) — the
  HIG pre-alert shown before the iOS notification prompt. It has ONE
  Continue button, never Cancel and never 'Allow', and a scrim dismiss
  continues too. The caller asks iOS from `onClosed` (the Modal's own
  `onDismiss`), so the system prompt never lands on a sheet that is
  still closing. Screens do not wire it by hand: they spread
  `useNotificationPreAlert().sheet` onto it (see kiko-architecture
  'Reminders').
- **CardContextMenu** (`src/design-system/components/card-context-menu/`)
  — wraps a grid/list card in a touch-and-hold delete (and, when an
  `onEdit`, `onDuplicate`, `onViewAccount`, `onViewHolding` and/or `closeAction`
  is passed, an Edit/Duplicate/View account/View holding/Close/Delete choice,
  in that order; read the JSX in `card-context-menu.component.tsx`) menu. The optional
  `deleteLabel` names the destructive item and its confirm button (default `common.delete`);
  the recurring list's series rows pass 'Not a recurring charge'. `onEdit` is
  for a row with no tap target of its own: the holding detail's
  share-change rows and lot rows (`LotRowMenu`, Edit + Delete; Delete
  is offered only while every later sale stays covered without the lot,
  and a refusal inside the write shows the shared save-error alert). A
  lot row is the user's own entry, so unlike every other derived ledger
  row it carries no marker subtitle (`derivedMarker` returns undefined for a lot row).
  A transaction row keeps tap-to-edit and passes `onDuplicate` (manual rows) and the View actions
  (`use-view-actions`; Home's transaction row). A synced transaction row gets
  the View actions only, and an imported row lists View account, View
  holding and Delete: a hold never opens the delete confirm directly there. `closeAction`
  (`{ label, onPress }`, the consumer names the entry) is the account
  detail's manual holding cards ("Close holding"/"Close loan" + Delete):
  a hold there opens the action list, never the delete confirm
  directly, and the screen renders Close's own confirm
  (`CloseHoldingSheet`, a `destructive` red confirm) through
  `useCloseHoldingAction` below. Only Delete is red
  in the menu; Edit, Duplicate, and Close stay neutral. A synced holding
  passes no `closeAction`. The menu is: a
  `Gesture.LongPress()` that raises the shared `ConfirmSheet` above on a
  still hold, while a hold that MOVES fails the gesture so an enclosing
  `react-native-sortables` drag can still claim it — see `kiko-gestures`
  for the full arbitration. A non-deletable account or holding card with no action (a
  synced one; a card with a View action is not bare) renders with no
  gesture at all, `<>{children}</>`,
  so a synced card stays reorderable. This replaced the app's earlier
  swipe-to-reveal-delete row (`SwipeableRow`, removed) as the one
  delete-affordance pattern; a new deletable card/row wraps in this
  rather than reintroducing a swipe gesture. No swipe actions anywhere:
  row edit/delete = long-press `CardContextMenu` (`kiko-no-swipe-action`,
  see kiko-gestures). A form has no in-form Delete: the entity is
  deleted only from its page's `CardContextMenu`, so nothing under
  `src/screens/forms/` imports `ConfirmSheet`
  (`kiko-no-confirm-sheet-in-form`, `rules/semgrep-prewrite.yml`).
  `deleteTitle` is an optional string that replaces the default
  `common.deleteNamed` confirm title, for a card whose `name` is a
  descriptive line rather than an entity name (the category form's rule
  card passes `t('categoryPage.deleteRuleTitle')`), so the title never
  nests quotes around a sentence. The key is Title Case in `TITLE_KEYS`
  and the forwarded heading is registered in
  `src/i18n/locales/title-keys.call-sites.test.ts`. `liftOnHold` is
  passed only by a card in a plain (non-sortable) list; a grid card gets
  its lift from the grid.
  `deleteMessage` is an optional async function (`() => Promise<string |
  undefined>`, never a plain string): the menu awaits it when the hold asks for
  the confirm, so the text names what is stored now. A read that fails opens the
  title-only confirm, since the delete never depends on the text. The newest
  request wins (`latestRequest`): a read that settles after a newer request is
  dropped and neither overwrites the text nor opens a confirm. A transaction row
  whose source is `import` is deletable but passes NO `onDuplicate` and no other
  action (`isSyncedTransaction` is every non-manual source), so its hold opens
  the delete confirm directly; only a manual row is duplicable. The imported
  row's confirm needs no boundary read: every delete takes the row's full
  amount back, and the confirm's `removeNotice` states each holding's balance
  change (`transactions.deleteLinked.balanceChange`).
- **ImportBalanceLine** (`src/design-system/components/import-balance-line/`)
  — the one line on the statement-import and column-mapping previews that says
  what the target holding's balance will be, from an `ImportBalancePreview`
  (see `kiko-domain`, "The import screens preview the balance"). Amounts go
  through `formatMoney` in the holding's own currency; its sentences are the
  `statementImport.balance*` keys. Render it only when the preview exists: no
  preview means no line.
- **HoldingCard** (`src/design-system/components/holding-card/`) — one
  holding as a wide row card, shared so a screen never imports another
  screen's card (`kiko-no-cross-screen-import`): the entity icon tile and
  name on the left, with the holding's type under the name (a `caption`
  `textSecondary` line in the title column's `gap={1}`, exactly the account
  card's kind line, testID `holding-card-type`; the label is what the
  holding form's Type field shows, from `holdingTypeLabel`
  (`src/holdings/holding-type-label/`): a property item's category, a
  loan's kind, a metal's element, any other type's own name; a stored type
  with no descriptor shows no line), the holding's computed value (as of
  `now`) on the right, a smaller base-currency line for a holding in another currency,
  and the owned share of a part-owned property. A plain tap calls
  `onOpen`; `selected` marks it (the Card's selected surface, `accessibilityState.selected`); it
  carries no long-press of its own, so a grid wraps it in
  `CardContextMenu` and `Sortable.Grid`. Consumers: the account-detail
  holding grid and the Accounts screen's Property and Debts grids.
- **CloseHoldingSheet** and `useCloseHoldingAction`
  (`src/design-system/components/close-holding-sheet/`) — the Close
  confirm for a manual holding (a `destructive` `ConfirmSheet`; the
  copy comes from `closeHoldingCopy`, loan wording for a debt-side type)
  and the hook a screen uses to wire it. The sheet is reached only
  through the hook (the folder's barrel exports only
  `useCloseHoldingAction`); a screen never imports the sheet itself.
  `useCloseHoldingAction(account)`
  returns `closeActionFor(holding)` (the `closeAction` for
  `CardContextMenu`, `undefined` for a synced holding) and `closeSheet`
  (render each hook instance's `closeSheet` once; a screen with two hook
  instances renders both). `account` is the HOLDING's own account,
  read by `isSyncedHolding`; a screen listing the implicit account's
  holdings passes that row.
- **SymbolIcon** — wraps an SF Symbol glyph
  (`react-native-nitro-sfsymbols`); see "SF Symbol `tintColor` gotcha"
  in SKILL.md before passing it a color.
- **EntityIconTile** (`src/design-system/components/entity-icon-tile/`)
  — the entity glyph tile (an account/holding card's icon swatch):
  takes the SF Symbol `name` plus the entity's already-RESOLVED hex
  `color` (see "Entity color and tint" in SKILL.md — never a raw stored/
  nullable value) and derives its own gradient from that hex via
  `entityIconTileGradient`. An optional `size` mirrors `SymbolIcon`'s
  own, defaulting to the `body` icon-size token when omitted.
  Consumers: the account card, the holding card, the Settings >
  Reminders account heading (2026-09-30, user request), where the
  tile sits left of the `heading` name, both centered, and carries no
  `accessibilityLabel` because the name beside it already reads it, and
  the Accounts screen's Property / Debts section headings
  (`ImplicitAccountHeading`: tile + name + total + chevron, the same
  compact tile and layout; a Property / Debts heading always uses it).
  Tile size: 36pt (`spacing(9)`) by default; `compact` draws it one
  spacing step smaller, 32pt (`spacing(8)`), with the glyph unchanged.
  **Locked (2026-09-30, user request "Slightly decrease reminder's
  squircle size."):** the Settings > Reminders heading tile is
  `compact`; the account and holding cards keep 36pt.
- **Section heading disclosure row** (device fix 6, 2026-10-04, user
  request "a smaller > icon button across the implicit account title ...
  opens that account's screen ... replaces the account's card in the
  list"). The Accounts screen's Property / Debts section heading row
  (`renderHoldingSection` in `src/screens/accounts/accounts.screen.tsx`)
  is ONE `Pressable` (`accessibilityRole="button"`, no label of its
  own, so VoiceOver reads the name and the total as the account card's
  button does; testIDs `accounts-property-open` / `accounts-debts-open`)
  holding `ImplicitAccountHeading` (tile + name, testIDs
  `accounts-property-heading` / `accounts-debts-heading`), the section
  total, and at the END a decorative chevron: `SymbolIcon`
  `chevron.right`, `theme.iconSizes.caption`, `textSecondary` tone, in a
  `Box` (testIDs `accounts-property-chevron` / `accounts-debts-chevron`,
  `accessibilityElementsHidden` + `importantForAccessibility=
  "no-hide-descendants"`, `marginLeft` `spacing(2)`, `flexShrink: 0`), the
  iOS disclosure-row pattern `SettingsRow` also follows. The row's style
  is `sectionHeadingRow` (row, space-between, centred, `minHeight` 44, so
  the touch target sits inside the row's own bounds). A tap navigates to
  `AccountDetail { accountId, name: accountDisplayName(account, t) }`.
  The fix-5 edit pencil (`accounts-*-edit`, its 44pt section edit region
  box) is gone: the account is edited from AccountDetail's Edit item.
- **Switch** — a toggle that wraps RN's `Switch` with theme track/thumb
  colors. With `label` it renders a labeled row (label left, toggle
  right), the toggle centered on the label. **Locked (2026-09-30, user
  request on the Face ID row "Center Face ID setting toggle vertically
  to its label too.")**; the term-deposit Recapitalization toggle and
  the other Settings switch rows are extended app-wide by coordinator
  ruling 2026-09-30 (apply repeated feedback app-wide). Without `label` it is a bare toggle whose label sits
  elsewhere in the row, and it must then get `accessibilityLabel` so
  VoiceOver names it.
- **TextField** — a labeled text input wrapping RN's `TextInput` with
  theme tokens. It calls `useFieldBlur(onBlur)`: the field's own `onBlur` runs first, then the
  Screen's `onFieldBlur`. `HoldingIdentityField` calls `useFieldBlur(undefined)`; a text field
  outside these two must call `useFieldBlur` itself. Its disabled chrome (border/background/opacity)
  comes from the shared `disabledFieldStyle(theme)` helper
  (`src/design-system/disabled-field-style/disabled-field-style.ts`); `DateField` and
  `TimeField` (`src/screens/forms/`) consume the SAME helper so a
  read-only date/time field renders identically to a read-only text
  field. This is a DIFFERENT token from the pressable `DISABLED_OPACITY`
  token (`disabled-opacity.ts`, in component-set.md) — a disabled field is a different
  control class from a disabled pressable (e.g. Button), and the two must
  not be conflated. A third disabled-field-like control reuses
  `disabledFieldStyle`, not a fresh inline dim. Its `multiline` prop
  grows the field to fit its content instead of clipping to the fixed
  44pt single-line height — pass it for any free-text input whose value
  can wrap (see `text-field.component.test.tsx` for the two behaviors
  contrasted).
- **FieldError** (`src/design-system/components/field-error/`) — the
  one inline validation-failure line a form renders DIRECTLY UNDER its
  own field (`Text variant="caption" tone="negative"`, the same tone
  `FieldLabel`'s required asterisk uses) — never next to the nav-bar Save
  item, and never a reserved-height slot: it fades in on failure and
  the layout reflows, so a valid field shows no error node at all.
  Every
  invalid field shows its OWN error at the same Save/Import press —
  each field's message is computed from ONLY that field's own inputs,
  gated by the attempted-save flag, never by comparing against a
  single shared "first failing field" reason (that shape hides every
  error but one until the fields ahead of it are fixed one at a time,
  and un-hides the next one instead of clearing — a real reported
  bug, not a hypothetical). EVERY field with a visible error turns its
  own `FieldLabel`/`TextField`/`FieldTrigger` red (`invalid`, driven
  from that field's own `error` prop) at the same press, not just one
  — the first-invalid field in the form's top-to-bottom order is used
  ONLY to pick the scroll target, a SEPARATE concern from which fields
  turn red. A picker field takes the message through its own `error`
  prop (`CategoryField`, `HoldingSelectField`, `BankTypeField`,
  `BrokerTypeField`: each takes `error` and `required` and forwards to
  `FieldTrigger`; the account form wraps the one that renders in one
  `View` ref so a blocked Save scrolls to it), never a caller-rendered `FieldError` beside it,
  which leaves its label grey. One error that judges a GROUP of fields
  renders once under the group, and every field in the group turns its
  label red through the label-only `invalid` prop (`DateTimeRow`, which
  passes it to `DateField` and `TimeField`; `TextField`; `FieldTrigger`
  and `HoldingSelectField`). `invalid` never renders a message and is
  never set beside `error`. In the transaction form: the split-returns
  error under the return rows (every row's "Return to N" and "Return N",
  plus the payment Amount when the returns total it or more; an empty
  payment is the Amount's own error). In the holding form, a contributions error
  turns the amount and date labels of every row it refuses red.

  Save/Import is never disabled for VALIDATION; it validates on press.
  It disables only while a submit is in flight, or when an edit's saved
  value depends on data still loading: the holding form's edit waits for
  the price book (kiko-pricing).
  Every form composes this instead of hand-rolling its own error
  caption — see `kiko-code-style`'s "Form validation model" section for
  when to show it.
- **PairedFieldsRow** (`src/screens/forms/paired-fields-row/`; read the
  component for its props) lays two fields in one row of equal `flex: 1`
  columns (`Box` gap token 3, as `DateTimeRow`) and stacks them, first on
  top, when `useWindowDimensions().fontScale >= STACK_FONT_SCALE`. The
  constant sits between React Native's xxxLarge (1.353) and AX1 (1.786)
  values (`node_modules/react-native/React/Base/RCTUtils.mm:367-378`), so
  the row stacks from AX1. `STACK_FONT_SCALE` lives in `src/design-system/stack-font-scale/`
  (import `@kiko/design-system/stack-font-scale`; read it for the value). Any row that stacks at
  large text sizes imports it from there and never redefines it. Used by
  `FieldGroup` (Type + Amount) and `ExchangeFields` (`leadingField` + Value out).
- **Scroll to the first invalid field.** A form that scrolls to its
  first invalid field on a blocked Save uses `useScrollToField()` from
  `@kiko/design-system/use-scroll-to-field` (`{ scrollableRef,
  onContentSizeChange, scrollTo(fieldRef, onSettled?) }`), so no screen
  re-derives the header inset or the content height: two copies of that
  geometry drift apart.
- **`useIsMounted()`** (`src/design-system/use-is-mounted/`) returns a stable
  function that answers whether the component is still mounted. An async
  handler asks it after an await and drops its result when it is unmounted
  (the Connect fields do, so no credential is stored after a fold).
- **FieldTrigger** (`src/design-system/components/field-trigger/`) —
  the shared "labeled field that opens a picker sheet" trigger: a
  caption above a bordered row showing the current icon (or leading
  text mark) + value, tapping which opens the caller's own
  `BottomSheet`. Optional `capped` caps the trigger at
  `theme.layout.selectTriggerMaxWidth` (`src/design-system/theme/theme.ts`), trigger =
  min(column, cap), for a short one-phrase value; larger Dynamic Type wraps inside the cap.
  `CategoryField`, `HoldingSelectField`,
  `ModeSelectField`, `BankTypeField`, `ExchangeTypeField` (`src/screens/forms/`),
  `SelectField` (component-set.md) and `CurrencyField` below all compose this rather than
  re-implementing the same bordered-row JSX. Lives in
  `design-system/components/`, not
  `screens/forms/` where it used to sit — a design-system component
  must never import from `src/screens/**`, enforced by the
  `kiko-no-import-screens-outside-ui` Semgrep rule (see `kiko-linter`).
- **Divider** (`src/design-system/components/divider/`) — the shared one-line rule between
  sections. Read its props in `divider.props.d.ts`; the form placement rule (where it goes in a
  form's gap `Box`) is in SKILL.md under "UX patterns".
- **No imports across screen folders.** A file under
  `src/screens/<a>/` must never import from `src/screens/<b>/**`
  (relative path, `@kiko/` alias, or `jest.mock`). Move shared code to
  `src/design-system/`, a shared hook/util directory, or a barrel
  outside `src/screens/`. Enforced by `kiko-no-cross-screen-import`
  (`scripts/checks/screen-imports.js`, the guard and
  `check:screen-imports`).
- **Empty holding picker.** An EMPTY holding picker (`HoldingSelectField`, `PaymentHoldingField`;
  prop `onCreateNew`) shows an "Add holding" row (key `forms.fields.addHolding`). Its target comes
  from `resolveCreateHoldingTarget` (`src/screens/forms/create-holding-target/`): the picker passes
  `accepts(type)`, an optional `currency`, and `anchorAccountId`; the target is the anchor's own
  account or the first live account that can create an accepted type, opened on that type/currency,
  else `AccountForm`. `useSelectCreatedOption` (`src/screens/forms/use-select-created-option/`) is
  the shared hook behind every empty picker's create row (holding and template). The row press
  opens a one-shot handback id (`openHandback`, `created-option-handback.ts`); a second press while
  one is open gets none, so it pushes no second form. The id rides to the create form as the
  `handbackId` route param (`TransactionForm {newTemplate}`, `HoldingForm`;
  `resolveCreateHoldingTarget(picker, accounts, handbackId?)` adds it to the holding target, never
  to the `AccountForm` one when an account exists). With no account the target is `AccountForm`,
  and the id rides there too: `AccountForm` hands back the new cash holding id
  (`accountsRepo.createCashAccount` resolves `{ accountId, holdingId }`) after that write commits.
  The Property/Loan swap (`replace` into `HoldingForm`) and the holding form's
  `leaveForAccountForm` (`replace` back) carry the id. A non-cash kind hands back nothing, and
  an `AccountForm` opened without `handbackId` (Accounts > Add account, edit) hands back nothing.
  The form hands the new id back (`handBackCreatedOption`) only after its
  write commits; a cancel or a failed write hands back nothing. The picker selects exactly that id,
  once, when its screen regains focus, whether the option reaches the list before or after the
  focus. A blur drops an awaited id that never appeared; unmount closes the open handback. Outside
  a navigator nothing is selected.
- **CurrencyBreakdown** — a two-column per-currency amount grid (code
  left, formatted `MoneyText` right), filled row-major. It renders every
  Money it is given; Home filters exact-zero totals first (see `kiko-domain`).
- **SummaryTable** (`src/design-system/components/summary-table/`) — the
  one shared "label left, value right" summary block: an optional `title`
  heading row, then a stack of `rows` (row shape: read `summary-table.props.d.ts`), each split
  `space-between`. A row may opt in to `wraps?: true` for a free-text value: the label keeps its
  width and the value wraps inside the row; rows without it lay out exactly as before. The rule
  card on the category form (the rule card under `src/screens/forms/category-form/`) is the caller. At
  very large Dynamic Type a wrapping value can be squeezed narrow; check it on the device.
  Callers: grep `SummaryTable` under `src/`. Extracted from the
  holding-detail deposit/bond value-breakdown block —
  `HoldingDetailScreen` renders its own
  principal/gross/interest/tax/expected-profit rows through this (and,
  for a bond, a "Yield to maturity" text row: a two-decimal percent,
  testID `bond-yield-to-maturity`, left out when no lot has a stored
  price — the one text row in the interest table; the bond FORM shows
  the same yield, formatted by the same `yieldToMaturityText`, as a
  one-row `SummaryTable` after the purchase date with a caption
  `textSecondary` value like its ISIN summary, testID
  `bond-form-yield-to-maturity`), passing
  `<MoneyText money={...} tone={...} />` as each row's `value`, with NO
  visual change from before the extraction. Every other caller reuses the SAME row
  layout/alignment/styling for its own summary rows — never the deposit table's
  value/percent/tax COLUMNS, only its layout. A loan's linked and scheduled
  payments are NOT `SummaryTable` rows (they are
  `EntryCard` rows in the day-grouped ledger, see **EntryCard**). A property
  owned in part swaps the priced
  Cost / Value / Gain rows for Whole value / Your share / Your value /
  Cost (your share) / Gain (`sharedPropertyBreakdownRows`,
  `holding-detail.screen.tsx`; testIDs `ownership-whole-value`,
  `ownership-share`, `ownership-owned-value`, `ownership-owned-cost`,
  `ownership-gain`); "Your share" is the one text row, a `body` `Text`
  reading the share as typed plus its day (`1/3 · 33.33% since
  01.06.2025`, or `50% since …` for a percent). The two-value display
  on the holding card follows the converted-to-base line's shape: the
  owned value stays the main `MoneyText`, and a `caption`
  `textSecondary` line under it reads the share of the whole (`1/3 of
  3,000,000.00 ₴`, testID `holding-card-whole`) — only when the
  property is owned in part (`propertyOwnershipView`). `value` is always a caller-rendered `ReactNode`
  (a plain `Text` or a `MoneyText`) — `SummaryTable` itself never formats a
  value. A row's own `testID` wraps ONLY that row's value (never its
  label), so a caller migrating an existing row's testID (e.g.
  `statement-import-transaction-count`) keeps the exact same
  `toHaveTextContent` assertion it had before, scoped to the value text
  alone — RNTL's `toHaveTextContent` matcher requires an EXACT match by
  default (unlike jest-dom's substring default on web), so a testID
  spanning both label and value would break every such assertion.
- **EntryCard** (`src/design-system/components/entry-card/`) — the shared
  ledger card: a label, an amount, and footer lines. The `lead` holds only
  the category icon; the link marker goes in `amountCaptionIcon` beside the
  time (`amountCaption`); `footerLines` are lines under the WHOLE row (the
  scheduled split lines, and the linked loan-payment transaction card's
  split and balance-left lines). An optional `subtitle` (caption, `textSecondary`, no new
  token) sits `spacing(2)` under the label in the `rowDescription` column, wrapping with the
  title and never beside the amount; that is `TransactionCard`'s title-to-meta step
  (`rowDescriptionWithSubtitle` in `entry-card.styles.ts`). Read `entry-card.props.d.ts` for
  the props.
  `TransactionCard`'s `rowFooterMeta` is `alignItems: 'center'`, so the link
  icon shares the caption's centre line (Q5 = A, the Home footer;
  `transaction-card.styles.ts`).
- **EntryDateHeader** (`src/design-system/components/entry-date-header/`) —
  the date heading drawn above an `EntryCard`. Read
  `entry-date-header.props.d.ts` for the props. A transaction list's day sections come from
  `groupByDay` and `DaySection` (`src/transactions/group-by-day/`), shared by Home and the
  holding-detail ledger; never regroup by day inline.
- **Field and filter helpers.** A field's nested testID comes from `deriveFieldTestID`
  (`src/design-system/derive-field-test-id/`), a `FilterMenu` toggle from `toggleFilterValue`
  (`src/design-system/toggle-filter-value/`); never re-implement either.
- **ExpandToggle** (`src/design-system/components/expand-toggle/`) — the
  shared "Show all" / "Show less" link with a chevron. `testID` is required
  (`expand-toggle.props.d.ts`); the chevron takes `${testID}-chevron`. Its
  copy reads `components.expandToggle.*` (en, uk). Never inline a second Show all / Show less
  copy. A consumer: `scheduled-payments-toggle`, the last child of the loan
  list header, shown only past `SCHEDULED_PAYMENT_PREVIEW_COUNT`.
- Characterization first: before extracting a shared component, pin the
  current rendered tree with `layoutOf` BEFORE moving any JSX, and keep that
  pin as a consumer test when the visual is locked.
- **CurrencyField** (`src/design-system/components/currency-field/`) —
  the shared currency-picker trigger + `BottomSheet`: a labeled trigger
  showing the current selection (or a placeholder) that opens a sheet
  listing a REQUIRED `groups: readonly CurrencyGroup[]` prop (no default
  set; `CurrencyGroup` lives in `src/currency/currency-group/`). A caller
  builds `groups` with `useCurrencyPickerGroups(context)` /
  `currencyPickerGroups(context, ordering)` in
  `src/holdings/currency-picker-groups/`; read that file for the contexts
  and the group kinds. A heading row shows only while MORE THAN ONE group is showing, and a
  search drops a group it empties. Each group is ordered by `orderCurrencies` (read
  `currency-group.ts` for the rule), and an empty group is dropped.
  Supports `hideLabel` for a caller that already labels the
  control externally (the Settings base-currency row), `required`, and
  a `disabled` read-only state. `error` follows every field's contract:
  `FieldTrigger` renders it under the trigger (reflow, not reserve, testID
  `<testID>-error`) and tints the label (the holding form's share
  Currency check). A field opens a picker sheet for one
  selection among many options; `ChipRow` below toggles inline
  among a small fixed set instead.
- **DateRangeField** (`src/design-system/components/date-range-field/`) —
  the date-range picker trigger + sheet. The range behind a DateRangeField
  is shared by Home and Statistics (kiko-domain 'The "no custom range = derive the default from now"
  pattern');
  never give a screen its own range state.
- **ChipRow** (`src/design-system/components/chip-row/`) — the ONE
  shared wrap-flow chips component: a compact wrap-flow row for a short
  code/label chip, never an equal-width column grid (that is
  `DayOfMonthGrid`, below). Read the folder
  directly for the current props; the load-bearing ones beyond
  `options`/`selected`/`onSelect`: `Option` is `string | number` (the
  trend-filter amount pills are `1 | 2 | 3 | 4 | 5`); `selected` accepts
  `undefined` for a PICK LIST with no single-select toggle semantics —
  `DescriptionSuggestions` passes `undefined` so no chip ever renders
  highlighted, rather than faking it with a value (`''`) that matches
  nothing. ChipRow is single-select (`selected`/`onSelect`) OR
  multi-select (`selectedValues`/`onToggle`), with the same chip look.
  The props type is a union and the two modes cannot be mixed
  (`chip-row.props.d.ts`). In multi mode the owner builds the new set:
  `onToggle` only reports the tapped value. Example: `WeekdayField`
  (`src/screens/forms/weekday-field/`). `labels` is an optional value -> display-text map;
  `labelVariant` (default `'body'`) drops the chip label a type step
  for a value sitting under its own larger section label (the
  trend-filter sheet's amount/measure rows pass `'caption'`). The chip
  keeps the approved compact look at EVERY step — a 34pt visible
  `minHeight` with `spacing(1)` vertical padding (`chip-row.styles.ts`),
  the same visible height as `Button`'s `small` size — and restores the
  44pt tap target with vertical `hitSlop` (`CHIP_HIT_SLOP`,
  `chip-row.component.tsx`), never with a taller chip. `labelVariant`
  only changes the label's type step, not the chip's size. **Selection
  look (the user-approved native iOS filter-chip style):** a selected
  chip is the `accent` fill with an `onAccent` label; an unselected chip
  is the faint `neutralSubtle` fill with a `textPrimary` label — never a
  solid dark `surface`/`surfaceHigh` pill. The icon picker's tiles
  (`icon-picker-modal.component.tsx`) follow the same look. A chip or
  segment on a glass sheet is a plain fill, never a `GlassSurface` (no
  glass on glass). See
  `kiko-statement-import`'s column-mapping section for the fullest
  worked comparison against `SegmentedControl` below. Because a
  design-system component may never import from `src/screens/**`
  (`kiko-no-import-screens-outside-ui`), `ChipRow` lives in
  `design-system/components/` since a design-system component
  (`LanguageSwitch`, `AppearanceSwitch`) renders one — the SAME reason `FieldTrigger` lives
  there too; a screen-level consumer imports it from there like any
  other design-system component.
- **AppearanceSwitch** (`src/design-system/components/appearance-switch/`)
  — the System / Light / Dark control of the Settings system screen: a
  `ChipRow` over `appearanceModes` with a label per mode from
  `appearance.*` (the active UI language, as a mode name is a word, not an
  endonym). It only reports the chosen mode; the screen writes the row
  (see "Light and dark themes" in SKILL.md).
- **DayOfMonthGrid** (`src/design-system/components/day-of-month-grid/`)
  — single-select day of month, 1 to 31, as a 7-column calendar-shaped
  grid (days 29-31 on a short last row), replacing a 31-row select sheet
  (user request 2026-09-30, "render day of month as a chips grid").
  Grounded in the iOS Reminders custom repeat "Monthly > Each" day grid
  and the HIG Pickers page ("A picker works well when displayed in
  context"; a short list suits a non-picker control). Each chip is
  ChipRow's approved look (`accent` + `onAccent` selected,
  `neutralSubtle` + `textPrimary` otherwise, `radii.sm`, 34pt), drawn
  inside a real 44pt cell with no `hitSlop` (see "Touch targets"); the
  grid pulls its footprint back with negative margins so its outer
  chips line up with the caption and the other fields. **Locked
  (user request 2026-09-30, "Use the same cell sizes/gaps in 'day of
  the month' as in 'day of the week'."):** the day chips take the weekday row's (`WeekdayField`,
  a `ChipRow`) chip height and horizontal gap from ONE shared source,
  `src/design-system/chip-geometry/` (`CHIP_MIN_HEIGHT`, `CHIP_GAP_STEP`,
  `CHIP_TAP_INSET`; read the values in `chip-geometry.ts`) — ChipRow
  and the grid both import it, never a copy. Each cell pads
  `spacing(1)` a side, so two neighbours sit 8pt apart like the
  weekday chips. The row gap stays 10pt (2 x `CHIP_TAP_INSET`), not
  ChipRow's 8pt: a 34pt chip on a 42pt pitch cannot carry a 44pt
  target without overlapping the next row's. Math on a 390pt iPhone:
  form row 358pt (390 - 2 x `spacing(4)`), grid row 366pt, cell
  52.26pt, chip 44.26 x 34pt; 7 chips + 6 gaps = 357.8pt <= 358pt. A
  content-sized ChipRow chip with a two-digit body label is ~43-44pt
  wide (label ~19-20pt + 2 x `spacing(3)`), so 7 columns hold the
  weekday chip size. The component test compares the grid against a
  rendered ChipRow and checks the 44pt cell on the narrowest 375pt
  iPhone (cell 50.1pt). It is NOT a
  `ChipRow` variant: ChipRow is a wrap-flow row, never an equal-width
  column grid. Accessibility: each cell is a `button` with
  `accessibilityState.selected`, its number as its label, and the group
  `label` as its hint (the SegmentedControl reasoning: a non-accessible
  container gives VoiceOver nothing to read, so the grid container
  carries no `accessibilityLabel`). The day number is `numberOfLines={1}`
  with `adjustsFontSizeToFit` (`minimumFontScale` 0.7, as
  `SegmentedControl`), so "31" never splits at accessibility text sizes.
  **Layout traps:** the cell width is `SEVEN_COLUMN_WIDTH`
  (`src/design-system/seven-column-width/`, shared with `ColorPicker`), never `100 / 7`; the
  Yoga float reason is documented in that file. The
  chip inset (`CHIP_TAP_INSET` in `chip-geometry.ts`, half of the
  44pt cell minus the 34pt chip; read the value there) is the cell's
  vertical padding, not a fixed cell height, so a chip grown by Dynamic Type keeps the inset the grid's
  negative margin undoes. **Hit-testing:** the grid's negative margins
  make the outer 44pt cells overflow the parent by 5pt vertically (and
  `spacing(1)` horizontally); taps there still land only because
  Fabric does not clip overflow by default — never put the grid inside
  an `overflow: 'hidden'` parent. Props: `label`/`selected`/`onSelect`/`testID` (cells are
  `${testID}-option-<day>`). The caller renders any hint below it (the
  reminder form's short-month hint for days 29-31). Consumer: the
  reminder form's monthly schedule.
- **SegmentedControl** (`src/design-system/components/segmented-control/`)
  — a JS implementation of Apple's iOS `UISegmentedControl`, per the Human
  Interface Guidelines
  (https://developer.apple.com/design/human-interface-guidelines/segmented-controls):
  a rounded track in the faint neutral fill (`theme.colors.neutralSubtle`,
  the native iOS segmented track — the user-approved native style),
  holding N equal-width segments, with the SELECTED segment a lighter
  raised thumb (`theme.colors.segmentSelected`) under a `textPrimary`
  semibold label. The track is translucent, so the thumb's WCAG 1.4.11
  3:1 non-text contrast (a dark-theme rule; the light thumb is the
  user's accepted exception, P2) is checked against the track composited over
  BOTH backdrops the control sits on (true-black `background` and
  `surface`, which a card or the glass sheet composites to); that is
  why the thumb is lighter than iOS's own `#636366`, which only reaches
  ~2.4:1 over `surface`. Read `theme.ts`'s own doc comment on
  `segmentSelected` for the current hex and measured ratios rather than
  trusting a copy restated here. This is still NOT the app's other
  filled-accent selection vocabulary (`ChipRow`/`SelectableRow`) — a
  segmented control reads as its own distinct iOS control, never an
  accent fill. No segmented-control
  NATIVE library is a dependency of this app; this
  renders the same visual/interaction contract in plain
  `Pressable`/`Box`/`Text` instead of adding one. Touch target: each segment `Pressable` is a REAL layout box with
  `minHeight` 44pt and no `hitSlop` (`minHeight`, not `height`, so
  Dynamic Type can grow it). The native-matching visible track (32pt)
  and selected pill (24pt, a 4pt ring of track around it) are
  absolutely-positioned DECORATIVE insets (`pointerEvents="none"`), so
  they grow with the segment. The container carries a negative
  `marginVertical` equal to the track inset, so the parent lays the
  control out at the 32pt track and no empty band appears above or below
  it. The 44pt frame then overflows the parent, and RN 0.87 Fabric keeps
  that band touchable: the parent's `overflowInset` is built from its
  children's frames (`YogaLayoutableShadowNode::getContentBounds`), and
  `RCTViewComponentView betterHitTest` only drops an outside-bounds touch
  when `overflowInset` is zero or the view clips. So never wrap the
  control in an `overflow: 'hidden'` parent. Jest cannot hit-test; see
  `segmented-control.styles.ts` for the exact geometry rather than a copy
  of the pixel values restated here. The selected label is semibold
  (`fontWeight: '600'`), matching UIKit, composed alongside (not
  duplicating) the base label's own `textAlign: 'center'`. The 32pt
  visible track (answering a device-feedback question, "is this how iOS
  does them?" — a segment "seeming short"): this component's
  `TRACK_HEIGHT` constant matches `UISegmentedControl`'s commonly
  MEASURED intrinsic height at its standard control size — there is no
  Apple-documented public constant for this number (the HIG page above
  covers behavior and appearance, not a numeric height), so treat 32pt
  as a community-measured convention, not an Apple primary source, until
  confirmed on a real device.
  Props: `options`/`selected`/`onSelect`/`labels`/`accessibilityLabel`
  (required — every segment folds it into its own `accessibilityHint`)
  /`testID`. Accessibility: each segment keeps
  `accessibilityRole="button"` with `accessibilityState={{ selected }}`
  — NOT `"tab"`/`"tablist"`, which RN 0.87 maps to NO accessibility trait
  on iOS (confirmed against `RCTViewManager`/Fabric's
  `accessibilityPropsConversions` — only `"tabbar"` maps to a trait there.
  A `"tab"`/`"tablist"` role loses
  the Button trait VoiceOver needs to announce "can be activated"); each
  segment's own `accessibilityLabel` is its visible text, and its
  `accessibilityHint` folds in the group's `accessibilityLabel` plus a
  TRANSLATED position string (`common.segmentPosition`, "N of M" — never
  a hardcoded `"N / M"` literal, which VoiceOver would read as "N slash
  M" and which never translates). VoiceOver behavior should still be
  confirmed on a real device — Jest only asserts prop values.
  `SegmentedControl` carries no VISIBLE label prop of its own (only the
  non-visual `accessibilityLabel`) — a caller that needs a visible
  caption above it composes its own `FieldLabel` above the control, the
  same way `ChipRow` does internally (grep `<SegmentedControl` for the
  consumers that do this, e.g. the Bond form's "ISIN / Manual" mode).

  **The tabs-vs-chips rule (binding), quoted verbatim from the user:**
  "Tabs (SegmentedControl) are used when the selection changes the
  appearance, for example it shows different form fields (like import
  mapping's currency field). Otherwise use chips (a value selection
  that leaves the form the same)." A long-label option set — even one
  that leaves the form unchanged — still uses `SelectField`'s select
  sheet instead: a chip row's width scales with its label text, and a
  handful of long labels (the loan-kind picker's 4 kind names —
  Автокредит, Споживчий кредит, Іпотека, Позика в особи — already ran
  too wide for a comfortable chip row) breaks its wrap-flow layout,
  which `SelectField`'s list rows do not. Verify EVERY choice control
  against this rule before adding or changing one — do not assume a
  control's existing type is correct, and never move a control between
  `ChipRow`/`SegmentedControl`/`SelectField` as an unrequested DEFAULT
  without a specific instruction naming that control. Current app state
  (a representative sample, not the closed set — grep `<SegmentedControl`
  / `<ChipRow` for the current consumers):
  - `SegmentedControl` (changes fields): the reminder form's Repeat
    (frequency) selector (`ReminderFormScreen` — each frequency shows
    its own field: weekdays, day of month, or interval); the Bond
    form's ISIN/Manual mode (`BondIsinSection`,
    `src/screens/forms/holding-form/bond/bond-isin-section/`); the Lot
    form's Buy/Sell toggle (`LotFormScreen` — Buy alone shows the
    Total-cost field).
  - `ChipRow` (leaves the form the same): the reminder form's weekday
    picker (`WeekdayField`, multi-select); the holding form's metal
    form/unit chips. The reminder form's day of month uses the same chip
    look in a calendar grid (`DayOfMonthGrid`), not a select sheet.
  - `SelectField` (long list, regardless of field-change): the
    property-category and loan-kind pickers (6 and 4 options — too
    wide for a `ChipRow`); the bond coupon-frequency picker (shared by
    both the ISIN mode's unmapped-frequency picker and the Manual
    mode's own frequency field — one control everywhere it appears);
    the holding-type picker (up to 9 long type names); the account-kind
    and transaction-type pickers (`AccountKindField`/`ModeSelectField`,
    both now thin wrappers over `SelectField`). The transaction-type
    picker is a DOCUMENTED EXCEPTION to the tabs-vs-fields half of the
    rule: its choice does change visible fields (Exchange/Split add
    their own fields), which is tabs territory by the letter of the
    rule, but it stays a select sheet on purpose — 4 options on create,
    already the same shape `AccountKindField`/`BankTypeField` use, so
    converting it to `SegmentedControl` would trade one working pattern
    for another rather than fixing a real violation.
- **BarChart**, **PieChart**, **NetWorthLine** — the `react-native-svg`
  visualization components; see the dedicated `kiko-charts` skill for
  their coordinate-space and testID conventions before touching any
  of the three. `NetWorthLine` has a scrub line with its own label
  (see `kiko-charts`). `PieChart` additionally supports `innerRatio` (ring
  thickness) and `centerTotal` (an amount centered in the donut hole;
  its sizing rule is in `kiko-charts`).
- **ColorPicker** (`src/design-system/components/color-picker/`) — a seven-column swatch grid
  whose cell width is `SEVEN_COLUMN_WIDTH` (`src/design-system/seven-column-width/`, shared with
  `DayOfMonthGrid`) with a theme `rowGap`, so the swatches fill whole rows; read
  `color-picker.styles.ts` and the palette for the current count.
- **TransactionCard** (`src/design-system/components/transaction-card/`) — `selected` sets the
  `Card` selected surface, and a category glyph with no colour of its own then takes `onAccent`.
  Home marks a `TransactionRow` selected through `useDetailPaneRoute` and `detailParamOf`
  (`kiko-architecture`, "Row marking").
- **Form header** (`useFormHeaderItems`, `src/screens/forms/use-form-header-items/`) — see
  "Form Save and Cancel live in the native nav bar" in SKILL.md.
