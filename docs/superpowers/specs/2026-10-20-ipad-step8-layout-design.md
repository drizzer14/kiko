# iPad layout after the step 8 review (design)

Date: 2026-10-20. Track: ipad-phase3 (task 10/14 step 8/9 follow-up). Base spec:
`docs/superpowers/specs/2026-10-17-ipad-adaptive-design.md` (this document replaces the parts it
names; everything else in the base spec stays).

## Intent and why

The user reviewed the iPad layout on their own simulator (2026-10-20) and gave 9 points, verbatim in
`.superpowers/user-feedback-step8-2026-10-20.md`. The user wants a calmer, simpler iPad layout:
one Home screen instead of two tabs that show the same two panes, equal halves instead of a
2/3 + 1/3 split, side-by-side panes in portrait too, and charts that use their card fully. Two
points (5 and 7) are bugs; they are fixed first (section F).

## User decisions (2026-10-20, via the coordinator; questions in the track notes
`step8-feedback-questions.md`, rounds 1 and 2)

1. **Merge (point 1, Q1 = a).** On a window that can split, Home and Statistics are one "Home"
   screen in one tab; the Statistics tab is not shown there. iPhone and compact windows keep the
   two tabs. The open screen is kept when the window size changes.
2. **No Statistics title (point 2).** The merged screen shows no "Statistics" large title. This
   change of the locked fitting-large-title visual is approved for this one screen only.
3. **Charts (points 3-4, Q4 = a).** Net worth, By type and Trend by category are full width, one
   per row. Expenses by category and Account contribution share one row. In a narrow pane every
   chart is full width. The 3-column grid goes away.
4. **Equal halves (point 6, Q3 = a).** Every split is 1/2 + 1/2. The 2/3 share goes away.
5. **Portrait side by side (points 8-9, Q2 = a).** In portrait the panes sit side by side, as in
   landscape, each pane at least 360 pt.
6. **Sides (Q5 = a).** On the merged Home the cards are on the LEFT and Home on the RIGHT, as
   today; a detail opened from Home replaces the cards on the left. Settings and Accounts keep
   their list on the left.
7. **Duo unchanged (Q6 = b).** The Surface Duo keeps today's look: the new rules do not apply to
   its inner poses.
8. **Narrow tall window (Q7 = a).** A regular, tall window narrower than 721 pt keeps the
   top/bottom split.
9. **One card order everywhere (Q8 = a)**, iPhone too: Net worth, By type, Trend by category,
   Expenses by category, Account contribution.
10. **No content cap in a pane under a top tab bar (point 5, Q9 = b; scope narrowed by the user
    2026-10-20, widened by the user 2026-10-21).** Inside a pane whose tab bar is at the top
    (`useIsTabBarAtTop()`: every regular iPad window, small Stage Manager splits included, not
    only a large window of section A) the content spans the full pane width (16 pt padding), the
    same test that gives the native large title the content's margin, so title and content start
    at the same x. This changes the locked `paneMaxWidth` cap rule and TwoPaneLayout rule R13 for
    those panes (kiko-design-system), with the user's approval. The Duo inner panes (tab bar at
    the bottom) and every other window keep the 600 pt cap, centred.
11. **Bug 7 scope (user).** Every LEADING (left) header button in the RIGHT pane is hidden: back
    buttons and the form Cancel button.

## Goals

- The rules above on every iPad window from 320 to 1376 pt; the Duo and iPhone looks unchanged
  except the card order (decision 9).
- No code reads the device idiom (base spec rule). Size class and window size decide.

## Non-goals

- New chart types, hiding cards, a `UISplitViewController`.

## Anti-goals (a failure even if it works)

- A size change loses the open detail screen or form input.
- A layout jump while the user works: the split or the chart rows change only on a window or pane
  width change, never on a tap.
- An empty band in a card under a short chart (point 3).
- Any change to the Duo inner poses beyond decision 9 (the card order).

## Design

### A. The large-window condition (decision 7)

**Orchestrator call (the user asked for the cleanest condition):** a window is LARGE when its
size class is `regular` and its SHORTER side is at least 721 pt (`MINIMUM_SPLIT_LENGTH`, 2 x 360
+ 1, the constant the split rule already uses). It is the only size fact that separates them:
- every full-screen iPad is large (shorter side: mini 744, 11-inch 820/834, 13-inch 1032);
- the Duo inner poses are not (951 x 669 and 669 x 951: shorter side 669);
- the JS snapshot has no Duo-only signal (no hinge field; `foldRegion` was null in every simulator
  pose, task 10/14 step 7/9), so a fold-based rule is not possible.
Consequence: an iPad Stage Manager window with a side under 721 pt (for example the 13-inch top or
bottom half 1032 x 683, or a left/right half 683 x 909) also keeps today's two-tab layout. Its
split is still equal halves (section B).

The merged Home (C) and the chart rows (D) apply only on a large window that splits.

### B. Layout mode and equal halves (decisions 4, 5, 8)

- `resolveLayoutMode`: `compact` -> `single`; `regular` and width >= 721 -> `columns` (portrait and
  landscape); `regular`, width < 721, taller than wide, height >= 721 -> `rows` (unchanged; covers
  the Duo inner portrait 669 x 951 and the 683 x 909 window); otherwise `single`. The Duo inner
  landscape 951 x 669 stays `columns`.
- `resolveCompanionShare` returns 1/2 in every mode. `WIDE_SHARE`, `WIDE_SPLIT_MIN_WIDTH` and the
  `wideSlot` pane-config field go away. Pins at 1100, 1133, 1366, 1376 change to 1/2. The Duo
  already uses halves (no change there).

### C. Merged Home (decisions 1, 2, 6)

- On a large window that splits, the tab bar has no Statistics tab. The Home tab shows the cards
  pane on the left (companion, today's default) and Home on the right (primary), as today, and the
  cards pane has no Statistics large title or header: the filter bar is its first row.
- Elsewhere (iPhone, compact, `single`, non-large windows, the Duo) both tabs stay as today.
- Size change: large split -> otherwise: the Statistics tab appears; the user stays on the Home tab
  with its open detail or form. Otherwise -> large split while on the Statistics tab: that tab then
  holds only its root screen (`StatisticsStackParamList`, types.d.ts:339; Home and the forms are
  reachable only from the split companion), so the user lands on the Home tab with the cards pane
  showing. The tab-set change uses the existing settle delay (150 ms).
- Help: the "Open Statistics" action (help-topic.screen.tsx, `openStatistics`) goes to the Home tab
  on a large split window. **Orchestrator call:** the help step text gets wording that is true on
  both layouts, in en and uk (kiko-translator).

### D. Charts (decisions 3, 9)

- One card order everywhere: filter bar; Net worth over time; By type; Spending trend by category;
  Expenses by category; Account contribution.
- The column grid (`resolveGridColumns`, 700/1000 pt) goes away everywhere. Every card is full
  width, one per row, except: on a large window, when the cards pane is at least **480 pt** wide,
  Expenses by category and Account contribution share one row (two columns). **Orchestrator
  call:** 480 pt (2 x ~232 pt cards with the gap and padding) is a proposal; the user's simulator
  look decides. iPad cards pane with equal halves: 371.5 (mini portrait, stacked) to 688 (13-inch
  landscape, shared row).
- A full-width card is as tall as its content (no stretch, no empty band). In the shared row both
  cards take the row height and each chart is centred vertically in its card.
- iPhone, the Duo and non-large windows: one card per row, full width, the new order.

### E. Content width in a pane (decision 10)

- Inside a pane whose tab bar is at the top (`usePaneContext() !== null` and
  `useIsTabBarAtTop()`, user 2026-10-21; the panes of a non-large Stage Manager window included),
  Screen applies no `paneMaxWidth` cap: content spans the pane with its 16 pt padding, so it lines
  up with the native title.
- Everywhere else the 600 pt cap stays, centred (user, 2026-10-20): the Duo inner panes (~475 and
  669 pt; the 669 pt pane keeps its ~34.5 pt title offset) and a regular `single` window
  (widest under 721 pt, offset at most ~44 pt). A large window with a SIDE tab bar stays capped
  at 600 pt too, with no large-window exception (user, 2026-10-21); its shared chart row follows
  the content width (the pane's, limited by the cap), so a capped pane stacks the charts.

### F. Bug fixes first (points 5 and 7)

- **Point 5:** section E is the fix. Red tests first: `screen.component.test.tsx` renders `Screen`
  (scroll, bleedTop, plain) inside a `PaneContext` under a top tab bar and asserts no cap and the
  16 pt leading edge; the same render in a Duo inner pane (669 x 951, 951 x 669) keeps the cap. The
  current pin "caps the content in a pane" is rewritten on purpose for panes under a top tab bar
  (acceptance-pin rewrite, named in the plan).
- **Point 7:** in `columns` with the tab bar at the TOP, the native header of the RIGHT (primary)
  pane sits in the same band as the floating tab bar (y 32-76), so its leading items (back, form
  Cancel) are under the bar (user confirmed). The native items cannot move ("Header bar items"
  lock). **Orchestrator call:** offset the frame of every pane that touches the window top by the
  bar band (frame top = safe inset + 44) when the tab bar is at the top, both panes, so the two
  headers stay level; the plain-branch top clearance is re-derived so nothing counts the band
  twice. The left pane's trailing Save sits at the window centre with equal halves, so it is at the
  same risk. One simulator check after the fix: tap a back button and a Cancel in the right pane,
  and a Save in the left pane, on the 13-inch in both orientations.

### G. What stays

The floating top tab bar, the BottomSheet frames, the Duo fold rules, the native tab bar, the
locked "Header bar items" and "Form Save and Cancel" rules.

## Testing

- Jest: the layout-mode table (iPad portrait widths -> `columns`; 669 x 951 and 683 x 909 ->
  `rows`; 951 x 669 -> `columns`); the large-window predicate (744, 820, 1032 large; 669, 683 not);
  share 1/2 at every width; the tab set per window; the route mapping on size change; the chart
  row plan at 371.5 / 479 / 480 / 688 pt and on non-large windows; no cap in a pane under a top
  tab bar and the cap kept in a Duo inner pane; pane frames below the top bar band.
- Simulator (after the fixes and after the design): the user's look on the iPad Pro 13-inch and the
  iPad mini, portrait and landscape; the bug 7 taps; the Duo inner poses unchanged (one read each).

## What is left to the builder

- Component and file layout of the merged tab, the exact test files, how the shared chart row
  equalises card heights, the order of the tasks after F.
