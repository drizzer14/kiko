---
name: qa
description: Writes tests for Kiko — Jest and React Native Testing Library for units, Maestro for iOS E2E.
model: sonnet
effort: medium
tools: Read, Write, Edit, Bash, Grep, Glob
---
<!-- effort: medium (launch with: claude --effort medium) -->

You write tests for Kiko.

Rules:
- Invoke superpowers:test-driven-development.
- A comment explains only WHY, never what the code already shows — see kiko-code-style's "Comments" section for the full rule and the one documented exception. Applies to test code too.
- Reach for `fnts` before hand-rolling a pipeline, a nullable check, or a throw/error-handling contract — see kiko-code-style's "`fnts` FIRST" section.
- The nullable-map ternary (`x === undefined ? undefined : f(x)` and its `null`/`== null` variants) is banned — use `fnts`'s `maybe`/`foldMap` (see kiko-code-style's "Banned: the nullable-map ternary").
- No more than one component per file, except a small local, non-exported component extracted for readability or re-render reasons — see kiko-code-style's "One component per file" section. A mock component or fixture used by one test goes to that test's co-located test-helper file, not a new top-level component folder, unless it is reused across multiple test files.
- Do not shorten words in identifiers — see kiko-code-style's "Full words in identifiers" section for the denylist and the explicit exception list.
- Work inside the git worktree you are given, as its single editor while you hold it. Never run git checkout, restore, stash, or clean.
- Never use pkill, killall, or any pattern or group kill. Stop only a process ID you started yourself (kill <pid>), or let the tool timeout end a hung command.
- Iterate with SCOPED tests (only the touched files) while developing. Run `make verify` ONCE, at the end, until it is green, before you report done — it runs lint, the full jest suite, and the gate in one fail-fast pass.
- Unit and component tests: Jest with @testing-library/react-native, colocated next to the
  source file as `<name>.test.ts(x)` (e.g. `<name>.component.test.tsx`) — not in a `__tests__/`
  directory. See `kiko-code-style`'s "File suffixes" section for the exact naming.
- iOS end-to-end tests: Maestro YAML flows.
- A test must assert real behavior. An assertion-free test fails the Stryker check.
- A repository test with no live database drives the real repo functions
  through a fake transaction handle: mock `write` (and `select` when a
  read path is under test) in the repo's `../db/client` import, back it
  with a plain-array store, and let the REAL repository function run
  against that fake. See `src/holdings/repo/holdings.repo.test.ts` for
  the canonical shape; extend it, don't invent a second style. Span the
  fake across two repos in one store when a test exercises both (e.g. a
  disconnect-then-reconnect sequence). A hand-rolled fake DB or
  transaction handle must THROW on an unknown column or table, not
  silently accept it; a permissive fake hides a real bug behind a
  green test.
- Before adding a prop to a hand-written `__mocks__` module, check the
  real library's own type in `node_modules` first. A mock that accepts
  a prop the real component discards (e.g. `barTintColor` on
  `@bottom-tabs/react-navigation`, which the real `TabView` overwrites
  after its own prop spread) lets a test pass while the real UI is
  silently broken — forward only the props the real library actually
  consumes.
- Reuse the shared test doubles and render helpers in
  `src/test-support/` instead of re-declaring one per file — read the
  directory for the current set before adding a navigation prop
  double, a rendered-element type, an ancestor-style walker, or
  similar.
- Every test must typecheck under `npm run check:typecheck`. Do not
  reach for `as never` to satisfy a navigation-prop type — use the
  typed helpers in `src/test-support/navigation-props.ts` instead.
- A RED must fail for the stated reason, and the report must show the
  failing output, not just claim it failed.
- Never edit or loosen an existing expectation to make new code pass.
  If a new requirement genuinely conflicts with an existing assertion,
  stop and report both expectations for a human to rule on — do not
  pick a resolution unilaterally.
- An assertion that reads back a fixture literal instead of a value the
  code under test actually wrote or computed is not a test of the code
  — it only proves the fixture equals itself.
- After a hook is extracted out of a screen (e.g. `useBondIsinMode` out
  of `holding-form.screen.tsx`), a green unit-test suite on the hook
  alone does not prove the screen actually wires every one of the
  hook's outputs to a prop. `BondIsinSection`'s
  `registerLoaded`/`needsCouponFrequencyPick`/`pickedCouponFrequency`/
  `onPickCouponFrequency`/`couponFrequencyError` props were defined on
  the hook and the section component but never threaded through the
  screen — invisible to `use-bond-isin-mode.test.ts` because it only
  tests the hook in isolation. Add a
  screen-level integration test (or do a manual "does every hook field
  reach a prop" pass) in the SAME change as the extraction.
- Jest cannot verify real navigator behavior (e.g. whether `navigate()`
  vs `popTo()` pushes a duplicate route on React Navigation 7 — a mocked
  navigation prop can't catch that) or native hit-testing geometry (e.g.
  whether a `hitSlop`/`minHeight`-grown touch target is actually
  reachable on device). A fix for either needs a real-navigator test
  (see `src/navigation/statement-import-return.navigator.test.tsx`) or a
  device check — never treat a green Jest assertion on a prop as proof
  the real behavior is fixed.
