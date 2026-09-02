# Redesign Round 1 — 2 feedback items report

Status: DONE (uncommitted, left in working tree per instruction).

## Item A — Currency breakdown → horizontal + wrappable

Changed to a horizontal, wrapping row.

Files changed:
- `src/design-system/components/currency-breakdown/currency-breakdown.styles.ts`
  — `StyleSheet.create(theme => ...)`; added `container`
  (`flexDirection: 'row'`, `flexWrap: 'wrap'`, `columnGap: theme.spacing(3)`,
  `rowGap: theme.spacing(1)`); renamed `row` → `item`
  (content-sized: `flexDirection: 'row'`, `alignItems: 'center'`,
  `gap: theme.spacing(1)`, no `justifyContent`, no full width).
- `src/design-system/components/currency-breakdown/currency-breakdown.component.tsx`
  — outer `<Box style={styles.container}>`; each pair `<Box style={styles.item}>`
  with the currency `<Text variant="caption" tone="textSecondary">` followed by
  `<MoneyText money={item} context="balance" />`.
- `src/design-system/components/currency-breakdown/currency-breakdown.component.test.tsx`
  — kept the label + formatted-amount assertions; added a test that walks up
  from a currency label to the wrapping container and asserts
  `{ flexDirection: 'row', flexWrap: 'wrap' }` (mirrors the style-layer
  inspection pattern in `transaction-filter-bar.component.test.tsx`).

## Item B — "Add account" button at the bottom

Already implemented in this worktree. The Accounts screen renders the
`PressableButton` through `<Screen scroll footer={...}>`; `Screen` renders the
footer as a non-scrolling `<View>` outside the `ScrollView`, inside the bottom
safe-area edge (`SCROLL_SAFE_AREA_EDGES = ['left','right','bottom']`), with
`footer` padding `theme.spacing(4)` and a top hairline. The button is full-width
(`accounts.styles.ts` `addAccountButton: { width: '100%' }`). The existing test
`renders "Add account" in the pinned footer, not inside the scrolled list`
already asserts this. No change needed; left untouched.

## Results

- `npx jest src/design-system/components/currency-breakdown` — 3 passed.
- `npx jest src/screens/accounts` — 6 passed.
- `npm run check:lint` — clean.

## Concerns

- Item B required no code change; it was already delivered by an earlier task.
  If the feedback expected a fresh change, confirm the current footer behavior
  on device matches the intent.
