# Bug hunt — tasks for the implementer (2026-09-06, main @ e36213c)

## Method

Six read-only reviewer agents each covered one area of the codebase — data
layer + domain (D), sync/rates/statistics/auth (S), forms + detail screens
(F), home/settings/statistics/calendar screens (H), design system (U), and
widget/i18n/navigation (W). Every non-test source file in scope was read
line by line; findings were confirmed either by tracing the code path or,
where cheap, by executing the real module (esbuild/node) against concrete
inputs. Baseline at `e36213c` after `npm install`: Jest 165 suites / 1545
tests green, `npm run check:all` green, `npx tsc --noEmit` reports 287
non-test errors (see T-26, the typecheck task, for the breakdown). Note:
`npm install` was required after the merge (`i18next` / `react-i18next`
were missing from `node_modules`) and it changed one line in
`package-lock.json` (adds a peer entry for `@react-navigation/elements`);
left uncommitted for the user.

## Tasks

Total: 43. Critical: 3. High: 8. Medium: 17. Low: 15.

### Critical

- [ ] **T-1 — Settings row is created only by a Monobank sync; every setting silently reverts on an install that never synced** (critical, confidence CONFIRMED)
  - Sources: D-1
  - Location: `src/repositories/settings.repo.ts:13-40` (all five setters are `UPDATE ... WHERE id = 1`); `src/monobank/sync.ts:93, :301` (the only `settingsRepo.ensure()` caller); `src/screens/use-auto-sync.ts:63` (`shouldAutoSync` gate)
  - What happens: the single settings row (`id = 1`) is created only by `settingsRepo.ensure()`, reachable only from `runSync()`, which `useAutoSync` runs only when a Monobank account is connected and a token is stored. No migration seeds the row (grep for a settings insert returns exactly one hit, the ensure). On any install that has not completed a Monobank sync, picking a base currency, switching language, choosing a default category, or turning on the Face ID app lock updates zero rows and reverts; `settings?.baseCurrency` at `settings.screen.tsx:67` stays `undefined`.
  - Confirm: fresh install, do not connect Monobank; Settings → base currency USD → the CurrencySwitch snaps back. Static: `grep -rn "settingsRepo\." src` → `ensure` only in `src/monobank/sync.ts:93`; `grep -rn "insert(settings)\|INSERT INTO .settings" src drizzle` → one hit.
  - Fix (in words): call `settingsRepo.ensure()` at launch in `MigrationsGate` after `runMigrations()` and before the gate reports success, or make each setter an upsert keyed on `id = 1`.
  - Test: `settings.repo.test.ts` — `setBaseCurrency` persists when no settings row exists; `migrations.gate.test.tsx` — `settingsRepo.ensure` is awaited in the launch chain.

- [ ] **T-2 — addMonths month-end overflow: bond coupon schedules and deposit maturity/period boundaries drift** (critical, confidence CONFIRMED)
  - Sources: D-2, D-3
  - Location: `src/holdings/interest.ts:38-42` (`addMonths`), `:63-64` (`periodBoundary`), `:74-75` (`depositMaturity`), `:241` (`depositLedger` maturity), `:371-387` (`bondCouponDates`); `src/holdings/holding-value.ts:140-157` (`bondExpectedProfitMinor`); `src/holdings/derived-entries.ts:211, :226-236`
  - What happens: `addMonths` uses `setMonth(getMonth()+n)`, which overflows when the target month is shorter than the source day. Bond side (`bondCouponDates` steps back from maturity with `addMonths(maturity, -k*months)` and never de-duplicates): a government bond, nominal 100,000.00 UAH, 16% semiannual, bought 1 May 2025, maturity 30 Oct 2026 → coupons 15.10.2025, 15.4.2026, 30.10.2026 → profit 2,400,000 minor; the same bond with maturity 31 Oct 2026 → 15.5.2025, 15.10.2025, 15.5.2026, 31.10.2026 → profit 3,200,000 minor (a fabricated 8,000.00 UAH coupon just from a one-day maturity change). Monthly with maturity 31.3.2026: 15.12.2025, 15.12.2025, 15.1.2026, 15.3.2026, 31.3.2026 (duplicate December, missing February). Deposit side: `depositMaturity([{date: 31 Aug 2025}], 6)` returns 3 Mar 2026 instead of 28 Feb 2026 (three extra days of interest, wrong maturity display); `periodBoundary` for a deposit opened 31 Jan 2026 gives 2.3.2026, 30.3.2026, 30.4.2026, 30.5.2026 — February gets no capitalization boundary and the anchor drifts to the 30th. Bi-weekly (default) capitalization is unaffected (`midCredit` clamps) but `depositMaturity` is wrong for every frequency.
  - Confirm: run against the real module via esbuild (hunter did): semiannual maturity 31.10.2026 bought 1.5.2025 → coupon count 4; monthly maturity 31.3.2026 → count 5, distinct 4; profit 3,200,000 vs 2,400,000 for a one-day maturity change. `depositMaturity([{ date: local(2025,7,31) }], 6)` → 3.3.2026; `addMonths(local(2026,0,31), 1)` → 3.3.2026. `interest.test.ts:318-350` only exercises maturity days 14, 20, 10, none of which trigger the overflow.
  - Fix (in words): in `addMonths`, compute the target year/month first, then clamp the day to that month's length (the same clamp `midCredit` already applies via `Math.min(openingDay, length)`). Also de-duplicate `bondCouponDates` as `biweeklyCreditDates` does. `periodBoundary`, `depositMaturity` and `depositLedger` inherit the fix once `addMonths` is corrected.
  - Test: `interest.test.ts` — `bondCouponDates(local(2025,4,1), local(2026,9,31), 'semiannually')` equals `[15.10.2025, 15.4.2026, 31.10.2026]`; a monthly month-end maturity yields no duplicate instants; `addMonths(local(2026,0,31), 1)` is 28 Feb 2026; `periodBoundary(local(2026,0,31), 'monthly', k)` for k=1..3 yields 28th/31st/30th month-ends with no month skipped.

- [ ] **T-3 — Disconnect + reconnect duplicates every synced holding; net worth double-counts** (critical, confidence CONFIRMED)
  - Sources: S-1
  - Location: `src/repositories/accounts.repo.ts:44-50, 117-136`; `src/repositories/holdings.repo.ts:53-77`; `src/monobank/sync.ts:199-217`; `src/crypto-sync/sync.ts:110-121`
  - What happens: `accountsRepo.disconnect` strips `monobankId` / `walletAddress` / `binanceAsset` from every synced holding's metadata but leaves the row with its full balance. Reconnecting runs `upsertByMetadataKey`, whose match `json_extract(metadata,'$.monobankId') = <id>` now returns NULL, so a second holding is inserted with the same balance. Net worth double-counts every card, jar, wallet and Binance balance. Transactions stay on the orphaned holding; the fresh one has none (the `(source, external_id)` unique index makes `addManyDedup` drop the re-imported items).
  - Confirm: `holdings.repo.test.ts` — `upsertMonobank({monobankId:'x'})`, `accountsRepo.disconnect(accountId)`, `upsertMonobank({monobankId:'x'})` again → 2 holdings rows. UI: Disconnect → paste token → Connect on one account.
  - Fix (in words): keep the sync key in metadata on disconnect (mark the holding manual via a separate flag or via the account's institution alone), or have the reconnect path re-adopt orphaned holdings by a stable secondary key (iban/maskedPan for Monobank, address for a wallet) before inserting.
  - Test: `holdings.repo.test.ts` — `upsertMonobank` after disconnect+reconnect of the same `monobankId` leaves exactly one row.

### High

- [ ] **T-4 — Category delete misses capitalized synced rows** (high, confidence CONFIRMED)
  - Sources: D-4, H-1
  - Location: `src/repositories/categories.repo.ts:70-88` (WHERE predicate at `:81`), triggered from `src/screens/settings/categories.screen.tsx:158-162`; `src/monobank/mcc-category.ts:39-58` (writes `'Groceries'`, `'Dining'`, `'Other'`) and `sync.ts:108`; contrast `drizzle/migrations/0002_seed_categories.sql:1-10`
  - What happens: `categoriesRepo.delete` reassigns with `eq(transactions.category, key)` (lowercase slug), but `categoryForMcc` writes capitalized values (`'Groceries'`, etc.) and the `transactions.category` text column has no `COLLATE NOCASE`. Deleting `groceries` reassigns zero synced rows; they keep a dangling `'Groceries'`. `resolveCategoryDisplay` masks it in the common path by lowercasing and folding unresolved keys into the default, so most views look fine, but the documented "never orphan" contract is not met and any raw reader sees the orphan. Executed real modules confirm the visible consequence: donut slices `[{key:"groceries", title:"Other", color:"#BF5AF2", share:0.83}, {key:"other", title:"Other", color:"#0A84FF", share:0.17}]` — a duplicate "Other" wedge with two different colors; Home chip color `#0A84FF` clashes with the row icon color `#BF5AF2` for what the user sees as one category.
  - Confirm: sync a statement with MCC 5411, delete groceries, `SELECT DISTINCT category FROM transactions` → `'Groceries'` still present.
  - Fix (in words): match case-insensitively on delete (`lower(category)` vs key) or read-filter-rewrite by id in JS as `upsertCategoryOverride` does; or normalize `categoryForMcc` output to the slug at import/sync time so only one casing is ever persisted. Apply the same normalization to `categoryOverrides`.
  - Test: `categories.repo.test.ts` — `delete('groceries')` issues an update whose predicate also matches a transaction stored with category `'Groceries'`, reassigning it to the default key.

- [ ] **T-5 — Monobank 60 s throttle is per `fetchAllStatements` call; second card 429s and sync aborts** (high, confidence CONFIRMED)
  - Sources: S-2
  - Location: `src/monobank/sync.ts:226-254` (`isFirstRequest` local at `:234`, guard `:238-241`), `:313-322`
  - What happens: the throttle lives inside one `fetchAllStatements` call. `runSync` loops accounts and calls `importAccount` → `fetchAllStatements` per card; the second card's statement request fires with zero delay → 429 → the error propagates, `setLastSyncAt` never runs, and the second and later cards never import. `fetchClientInfo` (`:303`) is also unthrottled; `useAutoSync` at mount plus pull-to-refresh adds a third unthrottled request.
  - Confirm: `sync.test.ts` `makeInMemoryDeps` exposes the sleep spy; with `statementFor` returning one item for both fixture accounts, `sleep.mock.calls.length` is 0 for 2 statement calls.
  - Fix (in words): hoist the throttle into a single token-scoped gate shared by the whole `runSync` invocation (`lastRequestAt` on `deps` or a `throttledFetch` wrapper), and route `fetchClientInfo` through it too.
  - Test: `sync.test.ts` — a two-card client-info causes exactly one `sleep(60_000)` between the two accounts' statement requests.

- [ ] **T-6 — Exchange legs need a structured marker: statistics counts the debit leg as spending, and the English descriptions are persisted** (high, confidence CONFIRMED)
  - Sources: S-5, H-2, F-6, H-10
  - Location: `src/statistics/transfer-exclusion.ts:64-68`; `src/statistics/internal-transfers.ts:37-41`; `src/repositories/transactions.repo.ts:136-170` (write side), `:146, :155, :204, :214` (description literals); `src/screens/statistics/statistics.screen.tsx:357-413`; `src/screens/home/home.screen.tsx:336-337, :362`; triggered from `src/screens/forms/transaction-form.screen.tsx:791-800` (`saveExchange`) and `:824-831` (`saveConvert`)
  - What happens: `recordExchange` writes the source leg as a plain manual negative transaction with `category` null, `mcc` null, and description `"Exchange to <name>"` / `"Exchange from <name>"` (hard-coded English, persisted — a later language switch does not fix it). No exclusion rule matches: the MCC rule bails on null, the description patterns are Ukrainian only, and `isMatchingCredit` requires same currency, which a cross-currency exchange never satisfies. Converting 10,000 UAH → USD shows a 10,000 UAH expense bucketed under "Other" in the category donut. Executed real modules: `excludedIds` is `[]` and the donut slice is `[{key:"other", amount:1000000, share:1}]` for a −1,000,000 UAH / +24,000 USD exchange pair. A same-currency exchange into a `term_deposit` leaks the same way (destination writes a metadata contribution, no credit row). On Home, both legs render their raw English description verbatim regardless of the active language.
  - Confirm: `transfer-exclusion.test.ts` — feed a −1,000,000 UAH "Exchange to Savings" plus a +24,000 USD "Exchange from Card"; none of `internalTransferTxIds` / `mccExcludedTransferTxIds` / `descriptionExcludedTransferTxIds` returns either id. `statistics.screen.test.tsx` — the same pair renders a nonzero "Other" wedge. `home.screen.test.tsx` — the leg renders in English under `uk`.
  - Fix (in words): give exchange legs a durable structural marker written by `recordExchange`/`recordExchangeCounterpart` — a reserved category key or a shared correlation id/flag on both legs — instead of relying on description text or MCC. Add a new exclusion rule in `transfer-exclusion.ts` keyed on that marker. Resolve the display description via `t` at render time from the marker + counterpart name (as `defaultTransactionDescription` already does), not by persisting an English string.
  - Test: `transfer-exclusion.test.ts` — both legs of a cross-currency exchange are returned as excluded ids. `statistics.screen.test.tsx` — a cross-currency exchange pair renders no category wedge. `transaction-form.screen.test.tsx` (uk block) — `mockRecordExchange` receives a description resolved from the uk catalogue. `home.screen.test.tsx` — an exchange leg renders its Ukrainian label under uk.

- [ ] **T-7 — Transaction form never writes the picked category onto the row** (high, confidence CONFIRMED)
  - Sources: F-1
  - Location: `src/screens/forms/transaction-form.screen.tsx:717-734` (`writeManual`), `:850-879` (`save`), `:740-753` (`applyOverride`/`cancelOverride`), `:156-168` (`isSaveDisabled`); `src/repositories/transactions.repo.ts:31-32, :63-87, :125` (`ManualTransaction`/`recordManualTx`/`recordManual`); `src/repositories/category-overrides.repo.ts:23-27`
  - What happens: `recordManualTx` inserts only `{id, holdingId, amountMinorUnits, time, description, source}`; `ManualTransaction` has no category field. The only path that sets `transactions.category` is `upsertCategoryOverride`, which returns early when `normalizeTransactionName(name) === ''`. `isSaveDisabled` forces the user to pick a category on create, but the pick is silently dropped when (a) the description is blank (override key `''` → nothing persisted; the confirm sheet even reads `Apply "Groceries" to all transactions named ""?`), or (b) the user taps Cancel on the override sheet (`cancelOverride` just `goBack()`s, with the row already written uncategorised).
  - Confirm: Holding detail → Add transaction → Amount 12.34, Description empty, category Groceries → Save → Apply. The row lists under the catch-all `other` category. Static: `grep "category" src/repositories/transactions.repo.ts` shows the insert has no category column; `category-overrides.repo.ts:25` is the `key===''` early return. `transaction-form.screen.test.tsx:188` picks a category but asserts only `holdingId`/`amountMinorUnits`/`description`.
  - Fix (in words): give `recordManual` an optional category and pass `selectedCategory` from `writeManual` so the row always carries the picked category; the override sheet then governs only propagation to same-name rows. Skip the sheet entirely when the normalized description is empty.
  - Test: `transaction-form.screen.test.tsx` — after picking a category with a blank description, assert `mockRecordManual` is called with `expect.objectContaining({ category: 'groceries' })`.

- [ ] **T-8 — Sub-1e-6 BTC amounts hydrate as garbage (50 sat → "57") and save as 57 BTC** (high, confidence CONFIRMED)
  - Sources: F-2
  - Location: `src/screens/forms/transaction-form.screen.tsx:221-231` (`toAmountFields`, `.toString()` at `:228`), `:283-285` (`resolveConvertView` `fixedValue`), `:679-681` (hydration); `src/screens/forms/holding-form.screen.tsx:288` (`openingBalance` hydration), `:51-56` (`seedContributions`), `:61-70` (`seedBondFields`); `src/screens/forms/amount-format.ts:33-34`
  - What happens: edit-form hydration converts minor units to a major string with `String(number)` then `groupAmount`. Below 100 satoshis `String()` emits exponential notation and `groupAmount` strips every non-digit: 50 sat → `5e-7` → `"57"`; 10 sat → `"17"`; 99 sat → `"9.97"`. Opening a 50-satoshi BTC transaction shows `57`; Save then stores `Money.fromMajor('BTC', 57)` = 5,700,000,000 sat and adjusts the holding balance by that delta. The same path hits `openingBalance` for a manual `crypto_asset` holding with a dust balance.
  - Confirm: `node -e "const g=(s)=>s.replace(/\s/g,'').replace(/\D/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,' ');console.log(String(50/1e8),'->',g(String(50/1e8)))"` → `5e-7 -> 57`. In-app: BTC `crypto_asset` holding, add transaction 0.0000005, reopen it → Amount field reads `57`.
  - Fix (in words): replace `String(major)` with fixed-decimal rendering at the currency scale (`toFixed(currencyScale[currency])` trimming trailing zeros) everywhere a stored minor-unit amount is hydrated into a text field. Make `groupAmount` fail safe on an `'e'`/`'-'` it does not understand.
  - Test: `amount-format.test.ts` — `groupAmount('5e-7')` must not render `'57'`; `transaction-form.screen.test.tsx` — a BTC transaction of −50 minor units hydrates the Amount field to `'0.0000005'`.

- [ ] **T-9 — No form guards a double-tap Save; writes happen twice** (high, confidence CONFIRMED)
  - Sources: F-3
  - Location: `src/screens/forms/contribution-form.screen.tsx:50-70, :73`; `transaction-form.screen.tsx:850-879, :910`; `holding-form.screen.tsx:417-472, :478`; `account-form.screen.tsx:103-150, :156`; `src/design-system/components/button/button.component.tsx` (bare `Pressable`, no debounce). Contrast: `src/screens/account-detail/account-detail.screen.tsx:148-169` (inFlight ref pattern on the sync button).
  - What happens: each save is async and calls `navigation.goBack()` only after awaiting the write, so a second tap re-reads the same state. Double-tap on the contribution form appends the same `{amountMinorUnits, date}` twice via `appendDepositContribution` (doubles principal and every derived interest/tax line); the transaction form inserts two transactions and adjusts the balance twice; the holding/account forms create two rows.
  - Confirm: term deposit → Add contribution → 1000 → double-tap Save → two "Top-up" entries, principal 2000. Static: `grep -n "inFlight\|isSaving\|useRef" src/screens/forms/*.screen.tsx` finds no guard.
  - Fix (in words): apply the inFlight-ref + try/finally guard the account-detail sync button already uses, or a shared submitting state that disables the Button for the duration of the write.
  - Test: `contribution-form.screen.test.tsx` — fire two press events on Save without awaiting between them; assert `mockAppendDepositContribution` called exactly once.

- [ ] **T-10 — `barTintColor` on `Tabs.Navigator` is silently discarded; bug B1 (tab bar flips light/dark) is not fixed, and the test asserts the wrong behavior** (high, confidence CONFIRMED)
  - Sources: W-1
  - Location: `src/navigation/root.navigator.tsx:43` (and comment `:27-36`); `node_modules/react-native-bottom-tabs/src/TabView.tsx:456, :477`; `__mocks__/@bottom-tabs/react-navigation.tsx:44, :52`; `src/navigation/root.navigator.test.tsx:39-47`
  - What happens: `barTintColor` is not a `NativeBottomTabNavigatorProps` member; it falls through `...rest` to `TabView`, which at `:477` re-declares `barTintColor={tabBarStyle?.backgroundColor}` after the spread. `tabBarStyle` is never passed, so the native view receives `undefined` and `configureWithDefaultBackground()` runs. `tsc` reports `TS2769` on this line; the runtime path confirms the type error is real. The hand-written mock accepts `barTintColor` and paints it on a `View`, so `root.navigator.test.tsx:46` passes for the wrong reason — this is the same test-passes-via-mock issue W-2 also produces (see T-11 and the Notes section).
  - Confirm: `npx tsc --noEmit | grep root.navigator`; read `TabView.tsx:456` and `:477`. On device: Light appearance, switch tabs — the bar still flips.
  - Fix (in words): pass `tabBarStyle={{ backgroundColor: darkTheme.colors.background }}` (a real `NativeBottomTabNavigationConfig` member). T-11 (W-2) removes the underlying root cause independently — do both. Update the mock to forward only props the real library actually consumes, so a future regression cannot hide behind it again.
  - Test: `root.navigator.test.tsx` — `tabBar.props.tabBarStyle.backgroundColor === darkTheme.colors.background`.

- [ ] **T-11 — Native interface style is never pinned dark; Light-mode devices get an invisible status bar and light alerts/pickers/keyboard/tab bar** (high, confidence PLAUSIBLE — plist facts CONFIRMED, one device check needed)
  - Sources: W-2
  - Location: `ios/Kiko/Info.plist:83` (`UIViewControllerBasedStatusBarAppearance = false`), no `UIUserInterfaceStyle`, no `UIStatusBarStyle`; `src/design-system/unistyles.ts:14-17`; `App.tsx`; no `<StatusBar>` anywhere in `src/` or `App.tsx`
  - What happens: the app is dark-only in JS but the process trait collection follows the device. On a Light device the status bar renders dark content over `#000000` (clock, battery invisible); `Alert.alert` (`swipeable-row.component.tsx:216`, `transaction-form.screen.tsx:887`, `contribution-form.screen.tsx:66`, `account-detail.screen.tsx:180,185`), the datetimepicker, the keyboard and the `UITabBar` glass all render light. This is the root cause of T-10 (W-1 / bug B1).
  - Confirm: `grep -n "UIUserInterfaceStyle\|UIStatusBarStyle" ios/Kiko/Info.plist` → nothing; `grep -rn "StatusBar" src App.tsx` → nothing. Device: Display & Brightness → Light, launch, open any delete alert.
  - Fix (in words): add `UIUserInterfaceStyle = Dark` to `ios/Kiko/Info.plist`; optionally also `UIStatusBarStyle = UIStatusBarStyleLightContent`.
  - Test: a plist assertion test (following the file-reading pattern of `src/db/schema.category-overrides.test.ts`) asserting `UIUserInterfaceStyle = Dark`.

### Medium

- [ ] **T-12 — `lastSyncAt` cursor persisted as `now()` instead of the queried window ceiling; permanent hole in imported history** (medium, confidence CONFIRMED)
  - Sources: S-3
  - Location: `src/monobank/sync.ts:306` (`toSeconds`), `:307-310` (`fromSeconds`), `:324` (`setLastSyncAt(deps.now())`)
  - What happens: the window ceiling `toSeconds` is captured before the loop, but the cursor persisted after is `deps.now()` (loop end). Transactions between those two instants are never queried again. One 500-item page (one 60 s sleep) leaves a ~60 s hole; after T-5 (S-2) is fixed it becomes N×60 s for N cards. Balance stays right (overwritten from `/client-info`), so the loss is silent: the ledger, the category pie, and the reconstructed net-worth line are all wrong.
  - Confirm: `sync.test.ts` — make `now` advance +120,000 per call; the value passed to `setLastSyncAt` ≠ `toSeconds*1000` used in `fetchStatement`.
  - Fix (in words): persist the queried ceiling instead of the current clock: `setLastSyncAt(toSeconds * 1000)`.
  - Test: `sync.test.ts` — `setLastSyncAt` receives the same instant as the statement `to` bound under an advancing clock.

- [ ] **T-13 — Account marked institution `'monobank'` before any network call; a failed connect leaves it half-connected** (medium, confidence CONFIRMED)
  - Sources: S-4
  - Location: `src/monobank/sync.ts:189` (`ensureMonobankAccount`), called at `:302` before `fetchClientInfo` at `:303`. Contrast `crypto-sync/sync.ts:103-107`, which marks only after a successful fetch.
  - What happens: wrong token / offline / 429 → connect fails, but the account is permanently marked connected: detail shows Disconnect instead of the token field, every other account's Connect is hidden (`connectedQuery`), and the account cannot be deleted until disconnected.
  - Confirm: `sync.test.ts` — `targetAccountId='acc-1'`, `fetchClientInfo` throws `'401'` → `accountsStore[0].institution` is `'monobank'`, expected `null`.
  - Fix (in words): split `ensureMonobankAccount` into a read-only resolve step and a mark step; call `updateAccount` only after `fetchClientInfo` resolves, mirroring `resolveTargetAccount`/`runBalanceSync`.
  - Test: `sync.test.ts` — a failing `fetchClientInfo` leaves the target account's `institution` null.

- [ ] **T-14 — Rates refresh is all-or-nothing; a CoinGecko failure discards fiat rates and fails the whole sync** (medium, confidence CONFIRMED)
  - Sources: S-6
  - Location: `src/rates/rates-refresh.ts:99-103`; `src/rates/coingecko.ts:33` (`data.bitcoin.usd` unchecked); `src/screens/use-sync.ts:36-51`; contrast `history-backfill.ts:186-191`, which uses `allSettled`
  - What happens: `Promise.all([loadFiat(), loadBTC()])` rejects when CoinGecko 429s or returns a body without `bitcoin` (a bare `TypeError`). Fetched Monobank UAH/USD/EUR rates are discarded, nothing is upserted, and fiat conversion keeps the stale table; the rejection propagates through `useSyncAction` so a successful Monobank import is shown to the user as a failed sync.
  - Confirm: `rates-refresh.test.ts` — `fetchBTCPrice` throws `'429'` with a working `fetchFiatRates` → `upsertMany` never called.
  - Fix (in words): switch to `Promise.allSettled`, treat each provider failure as an empty anchor list (as `runBackfill` does), and keep the pairs the surviving anchors support; validate the CoinGecko body before reading `data.bitcoin.usd`.
  - Test: `rates-refresh.test.ts` — fiat pairs are still stored when the BTC provider rejects.

- [ ] **T-15 — Biometric promise rejections unhandled; lock screen can dead-end with no feedback** (medium, confidence CONFIRMED)
  - Sources: S-7
  - Location: `src/auth/lock-gate/lock-gate.component.tsx:55-57`; `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx:44-55`; `src/auth/biometrics.ts:73-79`
  - What happens: `unlock().then(setLastResult)` has no rejection handler. `@sbaiahmed1/react-native-biometrics` rethrows native rejections (`lib/module/index.js:106-114`) and `loadNativeBiometrics`'s `require` throws when the pod is missing. With `APP_LOCK_ENABLED = true` (`db-config.ts:37`) a throw becomes an unhandled rejection: `setLocked(false)` never runs, `lastResult` stays `undefined`, and the user sits on the lock screen with the neutral hint; tapping Unlock repeats the throw. `isSensorAvailable().then` in Settings has the same gap: the switch stays disabled with no hint.
  - Confirm: `lock-gate.component.test.tsx` — mock `../biometrics` `authenticate` to reject, render with lock enabled → no hint rendered, unhandled rejection.
  - Fix (in words): fold the throw into the `AuthResult` union in `biometrics.ts` (wrap `authenticateWithOptions` / `isSensorAvailable` with `either`, returning `{kind:'failed',code}` / `{kind:'unavailable'}`) so callers always receive a value and can render a retry hint.
  - Test: `lock-gate.component.test.tsx` — `auth.hint.failed` copy renders when `authenticate` rejects.

- [ ] **T-16 — Monobank `hold` items imported as settled; settled amount never updates** (medium, confidence PLAUSIBLE)
  - Sources: S-8
  - Location: `src/monobank/sync.ts:98-112`; `src/monobank/monobank.types.d.ts:48`; `src/repositories/transactions.repo.ts:334-337`
  - What happens: `MonobankStatementItem.hold` is modelled but never read; `mapStatementItem` imports a pending authorization as settled (the fixture item 3 has `hold:true` and the existing tests assert it is imported anyway). `addManyDedup` uses `onConflictDoNothing` on `(source, external_id)`, so the re-fetched settled row with a different final amount is dropped and the provisional amount is kept forever; if Monobank re-issues under a new id, both rows persist and totals double-count.
  - Confirm: `sync.test.ts` — run `runSync` twice with the same `externalId` and a changed amount; the stored amount does not update.
  - Fix (in words): persist `hold` on the row and either skip held items on import, or switch `addManyDedup` to `onConflictDoUpdate` that refreshes amount/description for `source='monobank'` rows while preserving the user's category override.
  - Test: `sync.test.ts` — re-syncing a previously held item with a changed final amount leaves exactly one row with the settled amount.

- [ ] **T-17 — "Never" last-sync label is hard-coded English** (medium, confidence CONFIRMED)
  - Sources: F-4
  - Location: `src/screens/account-detail/format-last-sync.ts:5-6`; consumers `account-detail.screen.tsx:257-261`, `crypto-sync-section.component.tsx:110-112`; `format-last-sync.test.ts:6-8` asserts the literal
  - What happens: `formatLastSyncAt` returns `'Never'`, interpolated into the translated `accountDetail.lastSync` key. Under `uk` a never-synced account renders "Остання синхронізація: Never". No `never` key exists in either catalogue.
  - Confirm: `grep -n "never\|Never" src/i18n/locales/en.ts src/i18n/locales/uk.ts` → no match; switch to Ukrainian, open a never-synced bank account.
  - Fix (in words): add `accountDetail.never` to both catalogues and thread `t` (or the resolved string) into `formatLastSyncAt`, as `defaultTransactionDescription` and `derivedEntries` already do.
  - Test: `format-last-sync.test.ts` asserts the catalogue-resolved string; `crypto-sync-section.component.test.tsx` renders under `uk`.

- [ ] **T-18 — Editing a holding balance writes no manual transaction (kiko-domain invariant break); history shifts retroactively** (medium, confidence CONFIRMED)
  - Sources: F-5
  - Location: `src/screens/forms/holding-form.screen.tsx:97-101` (`buildHoldingPatch`), `:430-441` (update call); `src/repositories/holdings.repo.ts:168-169` (bare `set(patch)`); invariant `.claude/skills/kiko-domain/SKILL.md:40-41`; consequence `src/statistics/holding-value-at.ts:33-40`. `accountsRepo.createCashAccount` initial balance has the same gap.
  - What happens: a balance edit writes `balanceMinorUnits` directly. `holdingValueAt` back-derives opening balance as `currentBalance − sum(allTransactions)`, so changing 100→500 UAH today shifts the whole historical net-worth series by +400 with no ledger row; the holding-detail transaction list no longer reconciles with its displayed Value.
  - Confirm: cash holding with two transactions; note the Statistics line shape; edit Balance +400; the whole past Statistics series shifts up by 400, with no new ledger entry.
  - Fix (in words): route a balance edit through a repository function that, in one `db.transaction()`, writes the new balance and a `manual` transaction for the delta (mirroring `transactionsRepo.update`'s delta handling). Seed an opening transaction in `createCashAccount` the same way.
  - Test: `holding-form.screen.test.tsx` — edit balance 100→500, assert a manual transaction of +40000 minor units is recorded alongside the balance write.

- [ ] **T-19 — Two different "fold into default" rules: breakdown keeps unknown slugs as separate buckets, Home folds them** (medium, confidence CONFIRMED)
  - Sources: H-3
  - Location: `src/statistics/category-breakdown.ts:80-82, :137` vs `src/categories/category-display.ts:86-94`; `home.screen.tsx:355-358` (row icon) vs `:301` (filter chip). Cross-references T-4 (the merged D-4/H-1 category-delete task): T-4's orphaned rows are what makes this divergence visible.
  - What happens: `groupKey` keeps an unresolvable slug as its own bucket while `resolveCategoryDisplay` returns the default's title → several wedges all labelled "Other". `resolveCategoryKey` (the Home filter) folds onto `other`, so a row's icon color (hashed on the raw slug) and its filter chip color (hashed on the folded key) disagree. This is an independent, latent divergence; T-4 is what makes it visible in practice.
  - Confirm: n/a beyond the test below — the divergence is structural, reproducible by any unresolvable category slug.
  - Fix (in words): group `buildCategoryBreakdown` through the same `resolveCategoryKey` fold Home uses, and derive Home's row-icon color from the resolved key rather than the raw slug.
  - Test: `category-breakdown.test.ts` — a transaction whose category is absent from the display map merges into the default key's slice.

- [ ] **T-20 — Statistics date range does not scope the Expenses-by-Category donut** (medium, confidence PLAUSIBLE)
  - Sources: H-4
  - Location: `statistics.screen.tsx:228-229` (`rangeFrom`/`rangeTo` used only by `buildNetWorthSeries` `:292-308`), `:337-350` (`transactionsWithCurrency` unfiltered), `:494-514, :550-557`
  - What happens: the range field shows e.g. 07.08.2026 – 06.09.2026 but the donut and center total sum every expense ever recorded. The screen's own doc comment says the range scopes the first three sections.
  - Confirm: seed one expense inside and one outside the 30-day window → both appear in the donut total.
  - Fix (in words): filter `transactionsWithCurrency` by the active range before the exclusion/breakdown memos, or state in the UI that the donut is all-time.
  - Test: `statistics.screen.test.tsx` — an expense dated 60 days ago is absent from the donut center total under the default range.

- [ ] **T-21 — Ten seeded categories with null color collide onto 5 palette colors (four wedges identical blue)** (medium, confidence CONFIRMED)
  - Sources: H-5
  - Location: `src/statistics/category-breakdown.ts:51-58` (`categoryColor`); palette `theme.ts:66-75`; seed `0002_seed_categories.sql:1-10`
  - What happens: hashing over an 8-entry `chartSeries` palette collapses distinct categories: other/shopping/entertainment/transfers → `#0A84FF`; dining/transport → `#30D158`; groceries/cash → `#BF5AF2`.
  - Confirm: run the hash function over the ten seeded keys (script in the hunter's report) — confirms the three collision groups above.
  - Fix (in words): assign explicit distinct colors for the ten seeded categories in the seed (a new migration), or add a de-collision pass that walks the palette when a hue is already taken by a visible slice.
  - Test: `category-breakdown.test.ts` — the ten seeded keys resolve to ten distinct colors.

- [ ] **T-22 — BarChart has no sign guard; a negative type total draws a negative-width Rect** (medium, confidence CONFIRMED for the math and code path; negative-slice reachability PLAUSIBLE)
  - Sources: U-1
  - Location: `src/design-system/components/bar-chart/bar-chart.component.tsx:58, :78-86, :106`; producer `src/statistics/type-breakdown.ts:52` (filter keeps negatives)
  - What happens: `width = (slice.amount / max) * VIEW_WIDTH` goes straight into `<Rect width>`. An overdrawn Monobank credit card (`sync.ts:129` writes `account.balance` verbatim) yields width −160 → `CGPathAddRoundedRect` draws nothing while the money label still reads −$5,000.00. All-negative data: `max` is the largest negative, widths become 320 and 16000 — every bar renders full-width. The line-57 comment claims `max` is guarded non-zero, but nothing guards its sign. The passthrough `__mocks__/react-native-svg.tsx:20` accepts `width={-160}`, so no Jest test can catch it.
  - Confirm: `node -e "const d=[{a:1000000},{a:-500000}];console.log(d.map(x=>(x.a/d[0].a)*320))"` → `[320, -160]`.
  - Fix (in words): scale against `Math.max(...abs(amount))` and clamp the width to ≥ 0, or decide in `buildTypeBreakdown` whether negative type totals belong in an assets-only chart and drop/abs them there.
  - Test: `bar-chart.component.test.tsx` — with a negative card slice, assert `bar-chart-bar-card` width is ≥ 0 and ≤ 320.

- [ ] **T-23 — `account-contribution` uses bare `?? ` instead of `resolveEntityColor`** (medium, confidence CONFIRMED/PLAUSIBLE)
  - Sources: U-2, H-7
  - Location: `src/statistics/account-contribution.ts:57-60`, reached from `statistics.screen.tsx:310-320`; consumed by `pie-chart.component.tsx:113, :173`; contrast `accounts.screen.tsx:112`, which uses `resolveEntityColor`
  - What happens: `account.color ?? defaultAccountColor[account.kind]` is the pattern the `kiko-design-system` skill forbids (misses empty-string and an unmapped kind). This is the only remaining call site of the pattern; the other eight call sites already use `resolveEntityColor`. A row whose `kind` is a removed enum member (schema enum is TS-only, no CHECK constraint) with `color` null resolves to `slice.color` undefined → `<Path fill={undefined}>` renders black on the black card and the legend swatch is transparent, while the slice still consumes ring share.
  - Confirm: `buildAccountContribution` with `accounts:[{id:'a',name:'X',kind:'broker',color:null}]` → `slices[0].color` undefined.
  - Fix (in words): wrap the lookup with `resolveEntityColor` from `design-system/entity-tint`, like every other call site.
  - Test: `account-contribution.test.ts` — color `''` and a kind outside the enum both yield a color matching `/^#[0-9a-f]{6}$/i`.

- [ ] **T-24 — Widget strings are hard-coded English Swift literals; no localization** (medium, confidence CONFIRMED)
  - Sources: W-3
  - Location: `ios/KikoWidget/NetWorthWidgetView.swift:37, :39, :51`; `NetWorthWidget.swift:61, :62`; contract `src/widget/net-worth-snapshot.ts:14-20`
  - What happens: `"Net worth"`, `"Open Kiko"`, `"Track your net worth here"`, `configurationDisplayName("Net Worth")`, `description(...)` are all literal English. There is no `.lproj`/`Localizable.strings`. A `uk` user sees "Капітал" in the app and "Net worth" on the widget.
  - Confirm: read the literal Swift strings at the locations above; there is no localization resource in `ios/KikoWidget`.
  - Fix (in words): add localized labels to `NetWorthSnapshot` (`labels: { title, placeholderTitle, placeholderHint }` filled with `i18n.t` in `buildNetWorthSnapshot`) and render them in `NetWorthWidgetView`; this follows the in-app language, which `Localizable.strings` could not. Keep both sides in lockstep per the `kiko-widget` skill.
  - Test: `net-worth-snapshot.test.ts` — after `i18n.changeLanguage('uk')` the snapshot title equals `i18n.t('home.netWorth')`.

- [ ] **T-25 — Persisted language applied only inside AppRoot; MigrationsGate and LockGate render in the device language** (medium, confidence CONFIRMED)
  - Sources: W-4
  - Location: `App.tsx:36, :56-62`; `src/i18n/index.ts:19` (`lng: deviceLanguage()`); `src/i18n/use-sync-language-with-settings.ts:15-23` (the only `changeLanguage` caller); `src/db/migrations.gate.tsx:48, :56`; `src/auth/lock-gate/lock-gate.component.tsx:82, :85, :89`
  - What happens: device `en`, `settings.language 'uk'`, app lock on → cold launch shows "Preparing database…", then "Locked" / "Unlock with Face ID…" / "Unlock" in English; Ukrainian appears only after Face ID succeeds. The mirror case shows the lock screen in Ukrainian for an `en` device user.
  - Confirm: set device language `en`, `settings.language` `'uk'`, app lock enabled; cold launch and observe the English gate screens before unlock.
  - Fix (in words): resolve the persisted language before the first gate paints — read `settings.language` and `changeLanguage` inside `MigrationsGate`'s init chain (after `initDatabase`/`runMigrations`, before reporting success), or hoist `useSyncLanguageWithSettings` to a wrapper between `MigrationsGate` and `LockGate`.
  - Test: `lock-gate.component.test.tsx` — `settings.language 'uk'` with device `en` renders "Заблоковано", not "Locked".

- [ ] **T-26 — Make `npx tsc --noEmit` green and add a `check:typecheck` harness check** (medium, confidence CONFIRMED)
  - Sources: W-5 (plus the type-only findings noted by hunter U as "explicitly checked, not a bug": the `TFunction` imports in `crypto-sync/provider.ts`, `holdings/derived-entries.ts`, `transactions/default-description.ts`, and `screen.component.tsx:70`'s `AnimatedRef` mismatch — folded in here because they are part of the same 287-error typecheck baseline this task is meant to zero out)
  - Location: `src/i18n/locales/en.ts:363` (`} as const;`); `src/i18n/locales/uk.ts:5` (`export const uk: typeof en = {` and comment `:3-4`); `package.json` scripts (no `check:typecheck` today); `src/crypto-sync/provider.ts:1`; `src/holdings/derived-entries.ts:1`; `src/transactions/default-description.ts:1`; `src/design-system/components/screen/screen.component.tsx:70`
  - What happens: `as const` on `en.ts` makes `typeof en` carry string-literal value types, so `uk.ts`'s `typeof en` annotation demands the exact English literals — 261 errors, one per translated string, in `uk.ts` alone. This buries a genuinely missing key inside noise, so the "missing key is a tsc error" guard the comment claims is effectively dead. Runtime is unaffected. Separately, `crypto-sync/provider.ts:1`, `holdings/derived-entries.ts:1` and `transactions/default-description.ts:1` import a `TFunction` export that `react-i18next` no longer has (type-only, no runtime effect); `screen.component.tsx:70`'s `AnimatedRef` mismatch is also type-only (RN 0.87 codegen splits `ScrollView`/`ScrollViewInstance`; reanimated's `useAnimatedRef<T>` is parameterised on the component) — both runtime consumers (`use-scroll-to-top-on-tab-press` `scrollTo`, `react-native-sortables` `scrollableRef`) work correctly at runtime. There is no `check:typecheck` step in the harness today, so none of this fails CI or a hook. Baseline: repo-wide `npx tsc --noEmit` reports 287 non-test errors, 261 of them in `src/i18n/locales/uk.ts` from the `as const` issue above.
  - Confirm: `npx tsc --noEmit 2>&1 | grep -c "^src/i18n/locales/uk.ts"` → 261.
  - Fix (in words): drop `as const` from `en.ts` (`i18next.d.ts` needs only the key structure, not literal value types); fix the three `TFunction` imports (import from `i18next` instead of `react-i18next`); resolve or accept the `screen.component.tsx:70` `AnimatedRef` mismatch; then add a `check:typecheck` script under `scripts/checks/` gated on zero errors so this whole class of regression fails the harness going forward.
  - Test: the harness check itself — `npx tsc --noEmit`, zero errors.

- [ ] **T-27 — The widget hook holds a live query over the whole transactions table and computes a 31-bucket trend the widget never renders** (medium, confidence CONFIRMED)
  - Sources: W-6
  - Location: `src/widget/use-net-worth-widget.ts:63-72, :98, :105-118`; `src/statistics/net-worth-series.ts:86-99`; `src/repositories/rate-history.repo.ts:48-62`; `ios/KikoWidget/NetWorthWidgetView.swift` never reads `trend`
  - What happens: `useNetWorthWidget` is mounted app-wide; each snapshot write runs `buildNetWorthSeries` over 31 daily buckets, rescanning all `currency_rate_history` rows and re-valuing every holding from its full transaction list. With ~5000 transactions × 400 history rows, that is roughly 170k synchronous JS-thread operations per write, on every transaction/holding/rate change and on every backgrounding, for output nothing on the Swift side consumes. This is the dominant cost during a Monobank sync; the background write competes with iOS's ~5 s suspension window.
  - Confirm: `grep -n "trend" ios/KikoWidget/*.swift` → only the struct definition and the preview constant, never rendered.
  - Fix (in words): drop `trend` from both sides and remove the `transactions` + `currency_rate_history` live queries from the hook (total and breakdown need only holdings/accounts/rates/settings), or render the trend in the widget so the cost buys something. One commit for both sides, per the `kiko-widget` skill.
  - Test: `use-net-worth-widget.test.ts` — `mockUseLiveQuery` is not called with `['transactions']` once the trend is removed.

- [ ] **T-28 — Info.plist declares `NSLocationWhenInUseUsageDescription` with an empty string; nothing uses location; App Store Connect rejects this** (medium, confidence CONFIRMED)
  - Sources: W-7
  - Location: `ios/Kiko/Info.plist:62-63`
  - Confirm: `sed -n '62,63p' ios/Kiko/Info.plist`; `grep -rni "geolocation\|Location" src` → no location API use anywhere in the app.
  - Fix (in words): delete the key entirely.
  - Test: extend the T-11 (W-2) plist test to assert no purpose-string key has an empty value.

### Low

- [ ] **T-29 — recap-OFF and recap-ON deposit engines disagree on the first accrual day** (low, confidence PLAUSIBLE)
  - Sources: D-5
  - Location: `src/holdings/interest.ts:326-342` (`depositAccruedMajor` via `daysBetween(c.date, end)`) vs `:137-140, :244-247` (`dayAfter` / tranches in `depositLedger`)
  - What happens: `depositLedger` (recap-ON, statement-validated) earns from the day after the tranche lands; `depositAccruedMajor` (recap-OFF) counts from the contribution date, so 10,000 at 10% over a year yields 365 days of interest instead of 364. `interest.test.ts:259-263` pins the recap-OFF behavior as-is.
  - Confirm: `depositAccruedMajor([{amountMajor:10000, date:START}], 10, 120, START+365*DAY)` → 1000.00 (365 days) vs 364 days computed in `depositLedger` for the equivalent recap-ON case.
  - Fix (in words): pick one convention (presumably `dayAfter`) and route both engines through it; resolve against a real recap-OFF statement first to confirm which convention Monobank/the bank actually uses.
  - Test: `interest.test.ts` — a single-contribution recap-OFF deposit and the equivalent recap-ON first period agree on the accrual day count.

- [ ] **T-30 — 500-item page boundary drops same-second items (`min(time) - 1`)** (low, confidence CONFIRMED)
  - Sources: S-9
  - Location: `src/monobank/sync.ts:250-251`
  - What happens: on a capped page, the next ceiling is computed as `min(item.time) − 1`. Items sharing that exact second that did not fit in the page are excluded from every later window and never imported.
  - Fix (in words): set the next ceiling to the earliest item timestamp itself (no `−1`); the `(source, external_id)` unique index makes the resulting one-second overlap idempotent.
  - Test: `sync.test.ts` — a paged fetch uses `to === min(item.time)` and an extra item at that exact second is imported.

- [ ] **T-31 — Binance payload unvalidated; malformed body writes 0 or NaN balance** (low, confidence PLAUSIBLE)
  - Sources: S-10
  - Location: `src/crypto-sync/binance/binance.provider.ts:40-42, 61-63`
  - What happens: `fetchAccount` returns the parsed body unchecked; `(account.balances ?? [])` turns a malformed payload into a 0-satoshi balance written over the stored BTC holding. `toSatoshis` runs `Number(balance.free)` with no finite check → `NaN` written into a `notNull` integer column.
  - Confirm: `binance.provider.test.ts` — stub `fetchAccount` → `{}` then `{balances:[{asset:'BTC',free:'x',locked:'0'}]}` → 0 and NaN respectively.
  - Fix (in words): validate the payload (`balances` is an array, `free`/`locked` parse to finite numbers) and throw a typed error surfaced through `useSyncAction`, instead of writing a fabricated balance.
  - Test: `binance.provider.test.ts` — `fetchBalances` rejects on a body with no `balances`.

- [ ] **T-32 — Statistics/Home range end uses a fixed 86,400,000 ms day; DST days lose or gain an hour** (low, confidence CONFIRMED)
  - Sources: S-11
  - Location: `src/screens/statistics/statistics.screen.tsx:229`; `src/screens/home/home.screen.tsx:68`
  - What happens: `end = startOfLocalDay(dateTo) + DAY_MS − 1`. On the fall-back Sunday (a 25-hour local day) transactions from 23:00–24:00 local are dropped from charts and the Home filter; on spring-forward the range spills one hour into the next day.
  - Confirm: device in Europe/Kyiv, range `to = 2026-10-25`, transaction at 23:30 local → missing from the range.
  - Fix (in words): compute an exclusive end as the start of the next local calendar day minus 1 ms (`new Date(y, m, d + 1)`), not a fixed millisecond offset.
  - Test: `src/dates/default-range.test.ts` or a statistics-range test — the range end for a DST fall-back date is 25 hours after its local midnight.

- [ ] **T-33 — Zero-amount manual transaction is accepted despite the guard's comment** (low, confidence CONFIRMED)
  - Sources: F-7
  - Location: `src/screens/forms/transaction-form.screen.tsx:836-848` (`tryWriteManual`), `:156-168` (`isSaveDisabled`); contrast `saveExchange` `:780-786`, which rejects `<= 0`
  - What happens: the guard tests only empty/NaN; `"0"` passes and a 0.00 transaction row is created.
  - Fix (in words): reject a non-positive magnitude the same way `saveExchange`/`saveConvert` do, or drop the "no zero-amount row" claim from wherever it is documented.
  - Test: `transaction-form.screen.test.tsx` add-mode — `mockRecordManual` not called when Amount is `0`.

- [ ] **T-34 — Home header total drops unconvertible currencies; the breakdown beneath still lists them** (low, confidence CONFIRMED)
  - Sources: H-6
  - Location: `home.screen.tsx:231-233`; `net-worth-view.ts:34-42` (`guardedNetWorth` drops) vs `currency-totals.ts:15-26` (`sumByCurrency` keeps)
  - What happens: with a BTC holding and no cached BTC:UAH rate, the headline excludes BTC while the breakdown beneath still lists it, so the rows do not add up to the headline total.
  - Fix (in words): have the breakdown mark or omit a currency the total could not convert, so the two views agree.
  - Test: `home.screen.test.tsx` — with no rates cached, a foreign-currency holding is flagged in or excluded from the breakdown to match the headline.

- [ ] **T-35 — Date-range calendar never receives `initialDate`; always opens on the current month** (low, confidence CONFIRMED)
  - Sources: H-8
  - Location: `src/screens/home/date-range-field/date-range-field.component.tsx:229-236`; prop in `src/screens/calendar/kiko-calendar/kiko-calendar.props.d.ts`
  - What happens: after applying a range in March, reopening the picker shows September (the current month) with no marks visible.
  - Fix (in words): pass the draft start (or `dateFrom`) as `initialDate`.
  - Test: `date-range-field.component.test.tsx` — the calendar receives `initialDate` matching the active `dateFrom`.

- [ ] **T-36 — Categories card grid: 200 ms sortables hold claims presses inside the rename TextInput** (low, confidence PLAUSIBLE)
  - Sources: H-9
  - Location: `src/screens/settings/categories.screen.tsx:346-367` (grid) wrapping the TextInput at `:173-200`; library default `dragActivationDelay 200`, `customHandle false` (`node_modules/react-native-sortables/src/constants/props.ts:28,31`)
  - What happens: a hold on the rename field to place the cursor or open Paste likely starts a card drag instead. No handle or delay override exists in `src/`.
  - Fix (in words): give the category card an explicit drag handle (`customHandle`) or raise its activation delay above the iOS text-selection threshold.
  - Test: `categories.screen.test.tsx` — the grid is configured with a drag handle / non-default activation delay. Verify on device.

- [ ] **T-37 — Pie legend percents rounded independently; column sums to 99% or 101%** (low, confidence CONFIRMED)
  - Sources: U-3
  - Location: `src/design-system/components/pie-chart/pie-chart.component.tsx:96` (`toPercent`), `:131-135`
  - What happens: `Math.round(share*100)` is applied per slice. Three equal shares → 33/33/33 (sums to 99). `[0.5,0.25,0.125,0.125]` → 50/25/13/13 (sums to 101). Both pie charts show this under the ring.
  - Confirm: compute `Math.round(x*100)` over `[0.5,0.25,0.125,0.125]` → sums to 101, not 100.
  - Fix (in words): use a largest-remainder (Hare) allocation across the slice set once in the component, instead of rounding each slice independently.
  - Test: `pie-chart.component.test.tsx` — four slices `[0.5,0.25,0.125,0.125]`; the parsed `*-legend-percent-*` integers sum to 100.

- [ ] **T-38 — NetWorthLine Y axis renders four identical ticks and coincident gridlines on a flat series** (low, confidence CONFIRMED)
  - Sources: U-4
  - Location: `net-worth-line.component.tsx:90-100` (`buildTicks`), `:218, :241-251`; `compact.ts:62` fallthrough can collapse labels too
  - What happens: when every amount equals `startReference`, `buildTicks` returns four ticks with the same value at the same y (99.999… for height 200): four overdrawn labels and four coincident `<Line>`s. `buildXTicks` has the analogous single-instant guard (`:116-119`); the Y axis has none.
  - Confirm: `<NetWorthLine points={[{t:1,amount:5000},{t:2,amount:5000}]} startReference={5000} baseCurrency="UAH"/>` → `tick-0`..`tick-3` share the same top position.
  - Fix (in words): mirror the X-axis collapse guard in `buildTicks`: when `maxValue === minValue` (or labels collapse to one string), return a single tick.
  - Test: `net-worth-line.component.test.tsx` — a flat series → `queryByTestId('net-worth-line-tick-1')` is null.

- [ ] **T-39 — NetWorthLine Y gridlines have no testID (kiko-charts invariant)** (low, confidence CONFIRMED)
  - Sources: U-5
  - Location: `net-worth-line.component.tsx:242-250`
  - What happens: the Y gridlines are the only chart primitives in the app without a testID; the `kiko-charts` skill states every primitive carries one. This gap is why T-38 (U-4) is invisible to the existing test suite.
  - Fix (in words): add `testID` `net-worth-line-y-grid-${tick.key}` following the existing naming convention.
  - Test: same file — four `net-worth-line-y-grid-*` nodes exist with strictly increasing `y1` for a non-flat series.

- [ ] **T-40 — Home double-counts the bottom safe-area inset in its list clearance (130pt vs 96pt)** (low, confidence CONFIRMED)
  - Sources: U-6
  - Location: `src/screens/home/home.screen.tsx:144-145`, applied at `:454`; contract `screen.component.tsx:57`, `screen.styles.ts:37-44`; contradictory comment `home.styles.ts:107-109` vs `home.screen.tsx:138-145`
  - What happens: Home opts out via `bleedBottom` and passes `listBottomClearance = tabBarHeight` (the full 80), whereas `Screen` normally passes `Math.max(tabBarHeight − insets.bottom, 0)` because `SafeAreaView` already adds `insets.bottom`. Result: 80 + 16 + 34 = 130pt of dead space under the last transaction, versus 16 + 80 = 96pt on every other screen.
  - Confirm: compare `screen.component.test.tsx:88` (`BOTTOM_CLEARANCE = 46`, total 96) with Home's 130.
  - Fix (in words): export the clearance computation from the `Screen` module for `bleedBottom` consumers, or subtract `useSafeAreaInsets().bottom` in `home.screen.tsx` and fix the `listContent` comment to match.
  - Test: `home.screen.test.tsx` — with tab-bar height and bottom inset mocked non-zero, `home-transactions` paddingBottom plus ancestors' paddingBottom equals `16 + tabBarHeight`.

- [ ] **T-41 — Button forces `textTransform: 'capitalize'`; Ukrainian labels render in Title Case** (low, confidence CONFIRMED)
  - Sources: U-7
  - Location: `src/design-system/components/button/button.styles.ts:63`; `button.component.tsx:44`; call sites `accounts.screen.tsx:73`, `account-detail.screen.tsx:224`, `holding-detail.screen.tsx:222`, `contribution-form.screen.tsx:73`; `uk.ts:200` "Додати рахунок", `:136` "Зберегти внесок"
  - What happens: under `uk`, "Додати рахунок" renders "Додати Рахунок" — Ukrainian UI labels conventionally use sentence case, not title case.
  - Fix (in words): drop the blanket `textTransform` and let each catalogue supply cased labels, or gate the transform on the active language.
  - Test: `button.component.test.tsx` — the label style `textTransform` is not `'capitalize'` when the i18next language is `uk`.

- [ ] **T-42 — MigrationsGate pending/error branches are unstyled; white flash on Light devices, text under the status bar** (low, confidence CONFIRMED)
  - Sources: W-8
  - Location: `src/db/migrations.gate.tsx:45-59`
  - Fix (in words): use a full-bleed `Box` on the dark surface token with centered `Text`, as `LockGate` styles its pre-navigator UI via `lock-gate.styles`.
  - Test: `migrations.gate.test.tsx` — the pending container carries the dark background token and `flex: 1`.

- [ ] **T-43 — A language-only settings change does not re-write the widget snapshot** (low, confidence CONFIRMED)
  - Sources: W-10
  - Location: `src/widget/use-net-worth-widget.ts:103, :118` (`writeNow` deps exclude `settingsRows`; `baseCurrency` unchanged)
  - What happens: switching language writes only `settings.language`; `writeNow`'s identity is unchanged, so the debounce never re-fires, and the snapshot's formatted strings keep the previous locale's number grouping (₴1,234.56 vs 1 234,56 ₴) until another table changes. The AppState background handler (`:131-142`) usually hides this; it will matter once T-24 (W-3) lands localized widget strings.
  - Fix (in words): add the persisted language (or `i18n.language`) to `writeNow`'s dependency list.
  - Test: `use-net-worth-widget.test.ts` — changing only `settings[0].language` triggers a second `mockWriteSnapshot` call after the debounce.

## Dismissed

- **W-9 — `wallet.pass` / `wallet.pass.fill` possibly iOS 16-only against the 15.1 deployment target.** The hunter flagged this but could not read the SF Symbols catalog. The coordinator verified in `/Applications/SF Symbols Beta.app/.../name_availability.plist`: both symbols are iOS 14.0. False positive — no task.

## Notes, not bugs

- The `kiko-domain` skill lists `Money.convert`/`format`/comparison helpers that do not exist in `src/currency/money.ts:9-57` (conversion actually lives in `src/rates`, formatting in `src/currency/format.ts`). Skill drift — hand to retrospect/scribe to fix by pointing at the source file rather than restating the method list.
- The `kiko-design-system` skill mentions a `blendOverWhite` export in `entity-tint.ts` that no longer exists. Skill drift, same class as above.
- `src/db/db-config.ts:17` and `:37` set `DB_ENCRYPTION_ENABLED` and `APP_LOCK_ENABLED` to `true` while their doc comments still say "Default OFF … supervised migration test." The values are correct per memory (the migration already ran and was verified); only the comments are stale.
- `src/navigation/root.navigator.test.tsx` passes only because `__mocks__/@bottom-tabs/react-navigation.tsx` accepts and paints `barTintColor`, a prop the real library discards. This is the root cause noted in T-10 (W-1) and is called out here again as a general lesson: the mock currently forwards more props than the real library consumes, which can hide a real regression behind a green test.

## Coverage

- **D (data layer + domain):** all 14 migrations + journal + `migrations.js` (no drift via a scratch `drizzle-kit generate`); `src/db` (client, migrations gate, schema, encrypted-database key/plaintext ordering, Keychain lock-safety); `src/repositories` (atomic single-`write()` transactions, FK-ordered deletes, exchange legs atomic); non-date parts of `src/holdings`; `src/currency`, `src/dates`, `src/categories`, `src/transactions`; no unchecked `JSON.parse`, no SQL string concatenation, no logged secrets. Baseline: 39 in-scope suites / 392 tests pass.
- **S (sync, rates, statistics, auth):** Monobank currency-code/mcc-category/token modules; `monobank.client` window arithmetic (apart from T-30/S-9); disconnect ordering (DB commits before Keychain) for both Monobank and crypto-sync; Binance HMAC/client signing correctness, credentials, btc-wallet, provider, resync, run-crypto-sync; rates conversion/net-worth-view/currency-totals/history modules; statistics buckets/category-breakdown/account-contribution/type-breakdown/net-worth-series; `use-app-lock`/`biometrics` bootstrap ordering; `use-sync*` family and `App.tsx`/`MigrationsGate` bootstrap order; concurrent `runSync` cannot duplicate rows; `.env` is public-only.
- **F (forms + detail screens):** `amount-format.ts` non-exponential round trip; date/time fields; chip-row, color-picker, holding-identity-field, category-field, holding-select-field, exchange-fields, convert-exchange-fields; account-form edit path; exchange legs atomicity, destination picker exclusions; holding-detail derived ids, no interest/tax double-count; account-detail drag/gestures, card-context-menu; icon-editor, headers. All SF Symbols in scope predate iOS 17; all 135 `t()` keys in scope resolve in `en` and `uk` with matching placeholders.
- **H (home, settings, statistics, calendar screens):** `grid-interaction.ts` gesture safety; accounts.screen tuning; settings.screen family (language persistence, app-lock gating); calendar header/weekday localization; home filter-menu/transaction-filter-bar key-based selection; day grouping and local-day math; i18n catalog key-set parity; `useLiveQuery`/`activeHoldings`/`holdingValue`/`buildTypeBreakdown`/`bucketTimes`/`buildNetWorthSeries`/`PieChart` (no NaN arcs, no double-counting). 17 suites / 223 tests pass.
- **U (design system):** `theme.ts`/`unistyles.ts` single dark theme; `entity-tint.ts` (`darkenHex` edge case unreachable); `symbol.component`/`symbol.color` (all 181 SF Symbol names verified, highest min iOS 26.0); `formatMoney`/`Money`/`currency.ts` correctness incl. negative zero and BTC scale-8; `MoneyText`/`CurrencyBreakdown`; `BottomSheet`, `SwipeableRow`, `GlassSurface` gesture safety; `Box`/`Text`/`Switch`/`TextField`/`OptionPills`/`CurrencySwitch`/`LanguageSwitch`. 242 design-system + currency tests pass.
- **W (widget, i18n, navigation):** `net-worth-snapshot.ts` ↔ Swift struct field-for-field match; App Group id consistency; `SnapshotLoader` failure handling; timeline scheduling; widget numeric parity with `home.screen.tsx`; no DB/Keychain/token access from the widget extension; all static/dynamic `t()` keys resolve in both catalogues with identical interpolation; navigation param lists, no duplicate route names, no deep links; `migrations.gate` sequencing; `useAppLock`/`useLiveQuery`/`useNetWorthWidget` cleanup correctness; `App.tsx` import order (unistyles before i18n) is load-bearing and correct. 42 tests across widget/i18n/navigation pass.
