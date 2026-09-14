# Strip Screenshot Subsystem from the Release Binary (App Store 5.6 fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shipping App Store Release binary contain NO trace of the screenshot/demo subsystem and NO auth-bypass, while keeping the `ENVFILE=.env.screenshots*` screenshot builds (rich/empty/locked) fully working.

**Architecture:** Every production module that statically imports `src/screenshot/*` is changed so the screenshot code is reached only through a build-time-foldable guard (`SCREENSHOT_MODE === 'true'` inlined by react-native-dotenv), with the seed pulled in by a LAZY `require` inside that guard. In a Release build the flag inlines to `undefined`, the guard constant-folds to `false`, and Metro's constant-folding pass deletes the branch — including the `require` — before dependency collection, exactly as it does for `if (__DEV__) require(...)`. With no production module importing `screenshot-mode.ts` or the seed, both modules become unreachable and are absent from the Release bundle. The LockGate biometric-suppression branch is removed from LockGate entirely; the "don't auto-prompt during capture" concern moves to `useAppLock` (still foldable, still stripped from Release), so LockGate has zero screenshot-awareness.

**Tech Stack:** React Native (Metro bundler), TypeScript, react-native-dotenv (`@env` virtual module), Biome, Jest/RNTL, Maestro + pixelmatch (check:screenshots).

**Spec:** This plan is the spec. Source of truth for the screenshot build/scenario machinery is `CLAUDE.md` → "check:screenshots (App Store screenshot visual regression)". Grounding facts verified in-repo (cited per task).

## Global Constraints

- **Version stays 1.0.0. Do NOT bump `MARKETING_VERSION` or `CURRENT_PROJECT_VERSION` (build number).** This is build 7 on branch `build7-5-6-fix`, base = `main` @ 3a624b6.
- **Keep the diff MINIMAL and on the release line. Change nothing unrelated.**
- **Do NOT add a user-facing demo/sample-data mode in this pass.** Structure the code so it can be added later without rework.
- **ACCEPTANCE (ops verifies against the built embedded Release JS bundle — see Task 6):** a case-sensitive grep of the Release `main.jsbundle` for each of these MUST return ZERO matches — `SCREENSHOT_MODE`, `isScreenshotMode`, `seedScreenshotData`, `buildScreenshotDataset`, `SCREENSHOT_STABLE_GLASS`, `SCREENSHOT_SCENARIO`, and the seed's fake-data literals (e.g. `Сільпо`, `Rozetka`, `Монобабанк`/`Монобанк`, `Binance`, `Date.UTC(2026, 8, 10` / anchor 2026-09-10).
- **check:screenshots (rich), check:screenshots:empty, check:screenshots:locked MUST still pass** on their matching `.env.screenshots*.stable` builds. Do NOT break the screenshot capture flow.
- **The DCE mechanism is load-bearing and already proven in this repo.** `src/env.d.ts` documents that an absent `@env` key inlines to `undefined` in a production build; `src/screenshot/screenshot-mode.test.ts`'s header comment states react-native-dotenv "replaces each import reference with the literal read from `.env` ... then deletes the import (verified in node_modules/react-native-dotenv/index.js)". `.env` is copied from `.env.example` by `postinstall` and carries NO `SCREENSHOT_*` key (verified: `grep SCREENSHOT .env.example` returns nothing). `.env.screenshots` sets `SCREENSHOT_MODE=true`; `.env.screenshots.locked.stable` adds `SCREENSHOT_STABLE_GLASS=true` + `SCREENSHOT_SCENARIO=locked`.
- **Prerequisite:** the worktree has no `node_modules`/`.env` yet. Run `npm install` first (its `postinstall` creates `.env` from `.env.example`), or the hooks and Jest cannot run.
- **Foldability rule (why we do NOT keep an `isScreenshotMode()` guard):** Metro's constant-folding removes a `require` only when the `if` condition folds to a literal AT TRANSFORM TIME, before dependency collection. react-native-dotenv turns the bare `@env` identifier into a literal, so `SCREENSHOT_MODE === 'true'` folds; but `isScreenshotMode()` is a CALL expression that never folds, so a `require` guarded by it would still be collected and BUNDLED. Every guard in this plan is therefore a direct `@env` comparison in the SAME module as the code it gates — never a function call, and never a boolean imported from another module (cross-module constants do not fold either).

## Production import inventory (exhaustive)

Command run: `grep -rn "screenshot" src --include="*.ts" --include="*.tsx"`, each hit inspected. NON-test, ships-to-device modules that statically import `src/screenshot/*` — there are exactly FOUR, plus one module that must GAIN a foldable check to relocate the LockGate suppression. No barrel/index re-exports screenshot code (verified: the only files importing from `screenshot/*` are the four below plus the seed itself importing `../screenshot-mode`).

| # | File | Current static import | Used at | Transform |
|---|---|---|---|---|
| 1 | `src/auth/lock-gate/lock-gate.component.tsx` | `isScreenshotMode` (line 10) | mount `useEffect`, lines 67-78 (skip auto-`attemptUnlock`) | REMOVE import + branch entirely; consume `promptOnMount` from `useAppLock` |
| 2 | `src/migration/migrations-gate/migrations.gate.tsx` | `isScreenshotMode` (10) + `seedScreenshotData` (11) | `seedScreenshotDataIfEnabled`, lines 100-104 | Drop both imports; inline `SCREENSHOT_MODE === 'true'` guard with LAZY `require` of the seed |
| 3 | `src/design-system/components/screen/screen.component.tsx` | `isScreenshotMode` (1) | `bounces={isScreenshotMode() ? false : undefined}` (75) | Drop import; inline `bounces={SCREENSHOT_MODE === 'true' ? false : undefined}` |
| 4 | `src/design-system/components/glass-surface/glass-surface.component.tsx` | `isStableGlass` (2) | `if (isStableGlass())` early return (251) | Drop import; inline `if (SCREENSHOT_MODE === 'true' && SCREENSHOT_STABLE_GLASS === 'true')` |
| + | `src/auth/use-app-lock.ts` | (none today) | new `promptOnMount` field | ADD inline `SCREENSHOT_MODE !== 'true'` so LockGate stays screenshot-free |

Not touched (correct as-is): `src/screenshot/**` (screenshot-only, DCE'd out of Release once nothing production imports it), `src/env.d.ts` (ambient types only, erased), and all `*.test.*` files except the ones named in the tasks below. `screenshot-mode.ts` keeps its exports UNCHANGED — `screenshot-mode.test.ts` still imports and exercises `isScreenshotMode`/`isStableGlass`/parsers, so Knip still sees them used; the seed still imports `screenshotLanguage`/`screenshotScenario` from it. In Release, the seed is DCE'd, so `screenshot-mode.ts` becomes unreachable and drops out too.

**DCE risk flags (all mitigated by the above):**
- No production `require`/import of the seed survives outside a folded-out branch → seed and its fake data absent from Release. ✅
- No top-level side-effect import of `screenshot/*` exists in production code (all four are named-value imports used inside functions/render). ✅
- No barrel re-exports `screenshot/*` unconditionally. ✅
- `screenshot-mode.ts` is NOT imported by any production module after Task 1-4, so its identifiers (`isScreenshotMode`, `SCREENSHOT_SCENARIO`, …) cannot appear in the bundle. ✅
- `StableSurface` (a local component in `glass-surface.component.tsx`) contains NO screenshot strings, so even if terser retained it, the grep stays clean; in practice its only call site is the folded-out branch, so terser drops it. ✅

---

### Task 1: `useAppLock` — add a foldable `promptOnMount` flag

**Files:**
- Modify: `src/auth/use-app-lock.ts`
- Test: `src/auth/use-app-lock.test.ts`

**Interfaces:**
- Produces: `useAppLock()` returns `{ isReady: boolean; isLocked: boolean; unlock: () => Promise<AuthResult>; promptOnMount: boolean }`. `promptOnMount` is `true` in every real build (production default) and `false` only in a screenshot-mode build (so the capture never triggers a system biometric sheet). LockGate (Task 2) consumes it.

- [ ] **Step 1: Write the failing test**

Add to `src/auth/use-app-lock.test.ts` (keep existing tests):

```ts
it('returns promptOnMount true under the committed .env (production auto-prompts on mount)', () => {
  // `promptOnMount` is `SCREENSHOT_MODE !== 'true'`, and react-native-dotenv
  // inlines the absent key as `undefined` under Jest — so production must
  // auto-prompt. The screenshot-capture (false) path is build-time only and is
  // covered by check:screenshots:locked, not here (same @env limitation the
  // screenshot-mode.test.ts header documents).
  const { result } = renderHook(() => useAppLock());
  expect(result.current.promptOnMount).toBe(true);
});
```

If `use-app-lock.test.ts` does not already `renderHook`, follow the file's existing render/setup pattern for driving the hook; match its existing mocks for `settingsRepo`/`useLiveQuery`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/auth/use-app-lock.test.ts -t promptOnMount`
Expected: FAIL — `promptOnMount` is `undefined`.

- [ ] **Step 3: Implement the flag**

In `src/auth/use-app-lock.ts`:
- Add at top (after existing imports): `import { SCREENSHOT_MODE } from '@env';`
- Add to the `AppLock` type: `promptOnMount: boolean;` with a doc line:
  `// True in every real build; false ONLY in a screenshot-capture build, so LockGate does not auto-invoke the biometric sheet during Maestro capture. Build-time constant (react-native-dotenv inlines SCREENSHOT_MODE), stripped from Release.`
- In the returned object, add:

```ts
return {
  isReady: !APP_LOCK_ENABLED || locked !== undefined,
  isLocked: lockEnabled && locked === true,
  unlock,
  // `SCREENSHOT_MODE` is inlined by react-native-dotenv at build time
  // (babel.config.js). The committed `.env` has no such key, so a production
  // build inlines `undefined` and this folds to a constant `true` — the
  // screenshot suppression is stripped from the Release binary.
  promptOnMount: SCREENSHOT_MODE !== 'true',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/auth/use-app-lock.test.ts`
Expected: PASS (new + all existing). Also confirm `src/auth/use-app-lock.disabled.test.ts` still passes.

- [ ] **Step 5: Commit**

```bash
git add src/auth/use-app-lock.ts src/auth/use-app-lock.test.ts
git commit -m "feat(auth): add foldable promptOnMount to useAppLock (5.6 prep)"
```

---

### Task 2: `LockGate` — remove all screenshot-awareness

**Files:**
- Modify: `src/auth/lock-gate/lock-gate.component.tsx`
- Modify: `src/auth/lock-gate/lock-gate.component.test.tsx`
- Delete: `src/auth/lock-gate/lock-gate.screenshot.test.tsx`

**Interfaces:**
- Consumes: `useAppLock().promptOnMount` (Task 1).

- [ ] **Step 1: Update the failing tests**

In `src/auth/lock-gate/lock-gate.component.test.tsx`, add `promptOnMount: true` to the `mockAppLock.current` default in `beforeEach` and to every per-test `mockAppLock.current = { ... }` override (all currently `{ isReady, isLocked, unlock }`). Then add a new describe covering the relocated suppression:

```ts
describe('promptOnMount', () => {
  it('does NOT auto-invoke on mount when promptOnMount is false, but still shows the lock and unlocks manually', async () => {
    mockAppLock.current = {
      isReady: true,
      isLocked: true,
      unlock: mockUnlock,
      promptOnMount: false,
    };
    const { getByTestId, getByText } = await renderGate();

    expect(getByTestId('lock-gate')).toBeTruthy();
    expect(mockUnlock).not.toHaveBeenCalled();

    await act(async () => {
      await fireEvent.press(getByText('Unlock'));
    });
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });
});
```

The existing test "prompts once on mount" now proves the `promptOnMount: true` path.

- [ ] **Step 2: Run tests to verify the new expectations fail**

Run: `npx jest src/auth/lock-gate/lock-gate.component.test.tsx -t promptOnMount`
Expected: FAIL — LockGate still auto-invokes regardless of `promptOnMount` (it does not read it yet). The existing "prompts once on mount" may still pass.

- [ ] **Step 3: Strip screenshot code from LockGate**

In `src/auth/lock-gate/lock-gate.component.tsx`:
- DELETE line 10 `import { isScreenshotMode } from '../../screenshot/screenshot-mode';`
- Pull `promptOnMount` out of the hook: `const { isReady, isLocked, unlock, promptOnMount } = useAppLock();`
- Replace the mount effect's screenshot branch (current lines 60-79) with a screenshot-free version:

```ts
useEffect(() => {
  if (!isLocked) {
    setLastResult(undefined);

    return;
  }

  // `promptOnMount` is true in every real build, so production auto-invokes the
  // biometric/passcode sheet on cold launch exactly as before. It is false only
  // in a screenshot-capture build (see `useAppLock`), where auto-invoking would
  // block Maestro on a system dialog (or SIGABRT on a Keychain read with no
  // enrolled biometrics) while the lock frame is captured. The manual Unlock
  // button below still calls `attemptUnlock` in every build.
  if (!promptOnMount) {
    return;
  }

  attemptUnlock();
}, [isLocked, attemptUnlock, promptOnMount]);
```

LockGate now imports nothing from `screenshot/*` and mentions no screenshot flag.

- [ ] **Step 4: Delete the obsolete screenshot test**

```bash
git rm src/auth/lock-gate/lock-gate.screenshot.test.tsx
```

Its coverage (no auto-invoke during capture) is replaced by the Task 2 Step 1 `promptOnMount:false` test.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/auth/lock-gate/`
Expected: PASS (component test incl. new promptOnMount describe; `lock-gate.disabled.test.tsx` and `lock-gate.native-throw.test.tsx` unchanged and green). Confirm `lock-gate.screenshot.test.tsx` is gone.

- [ ] **Step 6: Commit**

```bash
git add src/auth/lock-gate/lock-gate.component.tsx src/auth/lock-gate/lock-gate.component.test.tsx
git commit -m "fix(auth): remove screenshot auth-bypass from LockGate (5.6)"
```

---

### Task 3: `MigrationsGate` — lazy-require the seed behind a foldable guard

**Files:**
- Modify: `src/migration/migrations-gate/migrations.gate.tsx`
- Test: `src/migration/migrations-gate/migrations.gate.test.tsx` (verify only; no seed mock exists there today)

**Interfaces:** none new (internal helper only).

- [ ] **Step 1: Confirm the current test baseline is green**

Run: `npx jest src/migration/migrations-gate/migrations.gate.test.tsx`
Expected: PASS. This test does not reference the screenshot seed (verified: `grep screenshot` finds nothing there); it mocks the DB/migration chain and asserts the gate resolves. It stays valid because the seed is a no-op under Jest either way (`SCREENSHOT_MODE !== 'true'`).

- [ ] **Step 2: Replace the static seed import with a guarded lazy require**

In `src/migration/migrations-gate/migrations.gate.tsx`:
- DELETE line 10 `import { isScreenshotMode } from '@kiko/screenshot/screenshot-mode';`
- DELETE line 11 `import { seedScreenshotData } from '@kiko/screenshot/seed/screenshot-seed';`
- ADD `import { SCREENSHOT_MODE } from '@env';` (with the other imports; keep the length-sorted import convention).
- Replace `seedScreenshotDataIfEnabled` (current lines 90-104) with:

```ts
/**
 * DEV/TEST-ONLY. In a build made against `.env.screenshots*`
 * (`SCREENSHOT_MODE=true`), rebuild the deterministic App Store screenshot
 * dataset before the gate paints its children.
 *
 * PRODUCTION SAFETY (App Store Guideline 5.6): the committed `.env` carries no
 * `SCREENSHOT_MODE`, so react-native-dotenv inlines `undefined` here
 * (babel.config.js), this comparison constant-folds to `false`, and Metro's
 * constant-folding pass deletes the whole block — INCLUDING the `require` —
 * BEFORE dependency collection, exactly as it does for `if (__DEV__)
 * require(...)`. The screenshot seed and its fabricated dataset are therefore
 * never bundled into the shipping binary. The `require` is intentionally lazy
 * and lexically inside the guard for precisely this reason; a static import (or
 * a `require` behind an `isScreenshotMode()` CALL) would defeat the DCE.
 */
const seedScreenshotDataIfEnabled = async (): Promise<void> => {
  if (SCREENSHOT_MODE === 'true') {
    const { seedScreenshotData } =
      require('@kiko/screenshot/seed/screenshot-seed') as typeof import('@kiko/screenshot/seed/screenshot-seed');

    await seedScreenshotData();
  }
};
```

The `.then(seedScreenshotDataIfEnabled)` step in the boot chain (current line 131) is UNCHANGED. The `as typeof import(...)` annotation is type-only (erased). `require` is the same lazy pattern `src/auth/biometrics.ts` already uses and Biome accepts.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest src/migration/migrations-gate/migrations.gate.test.tsx`
Expected: PASS unchanged. Also run `npx jest src/auth/lock-gate/lock-gate.component.test.tsx` (it renders the real `MigrationsGate`) — expected PASS.

- [ ] **Step 4: Commit**

```bash
git add src/migration/migrations-gate/migrations.gate.tsx
git commit -m "fix(migration): DCE-strip screenshot seed via lazy require (5.6)"
```

---

### Task 4: `Screen` — inline the foldable bounce guard

**Files:**
- Modify: `src/design-system/components/screen/screen.component.tsx`
- Modify: `src/design-system/components/screen/screen.component.test.tsx`

- [ ] **Step 1: Update the test**

In `src/design-system/components/screen/screen.component.test.tsx`:
- DELETE the `jest.mock('@kiko/screenshot/screenshot-mode', ...)` factory (lines 20-22), the `mockIsScreenshotMode` const (line 23), the `import { isScreenshotMode }` (line 1), and the `beforeEach` body line `mockIsScreenshotMode.mockReturnValue(false);` (keep the `beforeEach` only if other setup remains — here it becomes empty, so remove the empty `beforeEach`).
- DELETE the test "disables the ScrollView bounce under screenshot mode …" (current lines 180-192): it drove behavior by mocking `isScreenshotMode`, which no longer exists in this module. Screenshot-ON bounce behavior is a build-time-only path (react-native-dotenv inlines `@env` — the exact limitation the screenshot-mode.test.ts header documents) and is exercised by the marketing capture flow, not Jest.
- KEEP the production-default test "leaves the ScrollView bounce at the RN default outside screenshot mode …" (lines 172-178) — it now proves the shipping behavior directly.

- [ ] **Step 2: Run the test to verify it fails to compile/resolve**

Run: `npx jest src/design-system/components/screen/screen.component.test.tsx`
Expected: FAIL — the removed mock/import leaves `screen.component.tsx` still importing `isScreenshotMode` (module still referenced) until Step 3; or a stale reference error. (If it happens to pass, proceed — Step 3 is the substantive change.)

- [ ] **Step 3: Inline the foldable guard**

In `src/design-system/components/screen/screen.component.tsx`:
- DELETE line 1 `import { isScreenshotMode } from '@kiko/screenshot/screenshot-mode';`
- ADD `import { SCREENSHOT_MODE } from '@env';`
- Change the `bounces` prop (current line 75) to:

```tsx
// Screenshot-mode ONLY: turn off the native iOS overscroll bounce so a
// bottom-clamped App Store shot lands at a fixed offset. `SCREENSHOT_MODE` is
// inlined by react-native-dotenv at build time; the committed `.env` has no
// such key, so a production build inlines `undefined`, this folds to
// `bounces={undefined}` (RN default `true`, real users unaffected), and no
// screenshot code reaches the Release bundle.
bounces={SCREENSHOT_MODE === 'true' ? false : undefined}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/design-system/components/screen/screen.component.test.tsx`
Expected: PASS — `bounces` is `undefined` (production default) in every case.

- [ ] **Step 5: Commit**

```bash
git add src/design-system/components/screen/screen.component.tsx src/design-system/components/screen/screen.component.test.tsx
git commit -m "fix(design-system): DCE-strip screenshot flag from Screen bounce (5.6)"
```

---

### Task 5: `GlassSurface` — inline the foldable stable-glass guard

**Files:**
- Modify: `src/design-system/components/glass-surface/glass-surface.component.tsx`
- Modify: `src/design-system/components/glass-surface/glass-surface.component.test.tsx`

**Interfaces:**
- Produces: `StableSurface` becomes a NAMED export of `glass-surface.component.tsx` (so its rendering stays unit-tested without needing to drive `@env`). It renders a fixed opaque themed surface with an optional flat tint wash; props `{ children, style, tint, testID }`.

- [ ] **Step 1: Rewrite the test's stable-glass coverage**

In `src/design-system/components/glass-surface/glass-surface.component.test.tsx`:
- DELETE the `jest.mock('@kiko/screenshot/screenshot-mode', ...)` factory (lines 80-82), the `mockIsStableGlass` const (line 83), the `import { isStableGlass }` (line 1), and the `beforeEach(() => { mockIsStableGlass.mockReturnValue(false); })` (lines 89-91).
- DELETE the `describe('under stable-glass regression mode (isStableGlass() true)', ...)` block (lines 818-870): it drove the branch by mocking `isStableGlass`, which is no longer imported here.
- ADD a screenshot-free describe that tests the now-exported `StableSurface` directly (no `@env`, no mock):

```tsx
import GlassSurface, { StableSurface } from '.'; // ensure StableSurface is imported

describe('StableSurface (opaque regression surface)', () => {
  it('renders a fixed opaque themed base and no live-glass props', async () => {
    const { getByTestId } = await render(
      <StableSurface testID="stable" style={undefined} tint={undefined}>
        <Text>content</Text>
      </StableSurface>,
    );
    const base = getByTestId('stable-base');
    expect(StyleSheet.flatten(base.props.style).backgroundColor).toBe(darkTheme.colors.surface);
    expect(base.props.effect).toBeUndefined();
    expect(base.props.tintColor).toBeUndefined();
  });

  it('paints the entity tint as a flat wash over the opaque base', async () => {
    const tint = 'rgba(255, 69, 58, 0.1)';
    const { getByTestId } = await render(
      <StableSurface testID="stable-tint" style={undefined} tint={tint}>
        <Text>content</Text>
      </StableSurface>,
    );
    expect(StyleSheet.flatten(getByTestId('stable-tint-base').props.style).backgroundColor).toBe(
      darkTheme.colors.surface,
    );
    expect(StyleSheet.flatten(getByTestId('stable-tint-wash').props.style).backgroundColor).toBe(
      tint,
    );
  });

  it('renders no wash when no tint is set', async () => {
    const { queryByTestId } = await render(
      <StableSurface testID="stable-plain" style={undefined} tint={undefined}>
        <Text>content</Text>
      </StableSurface>,
    );
    expect(queryByTestId('stable-plain-wash')).toBeNull();
  });
});
```

`StableSurface` is imported through the folder index `.` — update `src/design-system/components/glass-surface/index.ts` to also re-export it if the index only re-exports the default (add `export { StableSurface } from './glass-surface.component';`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/design-system/components/glass-surface/glass-surface.component.test.tsx`
Expected: FAIL — `StableSurface` is not exported yet, and the module still imports `isStableGlass`.

- [ ] **Step 3: Export `StableSurface` and inline the foldable guard**

In `src/design-system/components/glass-surface/glass-surface.component.tsx`:
- DELETE line 2 `import { isStableGlass } from '@kiko/screenshot/screenshot-mode';`
- ADD `import { SCREENSHOT_MODE, SCREENSHOT_STABLE_GLASS } from '@env';`
- Change `const StableSurface: FC<{...}> = ...` (line 78) to `export const StableSurface: FC<{...}> = ...` (named export; keep its body unchanged).
- Replace the `if (isStableGlass())` early return (current lines 251-257) with:

```tsx
// STABLE-GLASS regression mode: a build made against `.env.screenshots.stable`
// (or the empty/locked stable variants) sets BOTH `SCREENSHOT_MODE=true` and
// `SCREENSHOT_STABLE_GLASS=true`, so this renders a fixed opaque surface with no
// live LiquidGlass sampling and no bloom, giving pixelmatch byte-stable pixels.
// PRODUCTION SAFETY (5.6): both keys are absent from the committed `.env`, so
// react-native-dotenv inlines `undefined` for each, this AND folds to `false`,
// and Metro deletes the branch — no screenshot flag reaches the Release bundle,
// and the live tree below renders byte-for-byte unchanged.
if (SCREENSHOT_MODE === 'true' && SCREENSHOT_STABLE_GLASS === 'true') {
  return (
    <StableSurface style={[styles.surface, edge, sizing, style]} tint={tint} testID={testID}>
      {children}
    </StableSurface>
  );
}
```

This preserves the exact behavior of the old `isStableGlass()` (which was `isScreenshotMode() && SCREENSHOT_STABLE_GLASS === 'true'`). The early return stays AFTER the `useUnistyles`/`useBloomResample` hook calls (rules of hooks), same position as today.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/design-system/components/glass-surface/glass-surface.component.test.tsx`
Expected: PASS — all live/fallback tests unchanged; the new `StableSurface` describe green.

- [ ] **Step 5: Commit**

```bash
git add src/design-system/components/glass-surface/glass-surface.component.tsx src/design-system/components/glass-surface/glass-surface.component.test.tsx src/design-system/components/glass-surface/index.ts
git commit -m "fix(design-system): DCE-strip stable-glass flag from GlassSurface (5.6)"
```

---

### Task 6: Verify DCE, screenshots, and the full harness (ops-heavy)

**Files:** none (verification + gates).

- [ ] **Step 1: Static confirmation — no production import of `screenshot/*` remains**

Run: `grep -rn "from '@kiko/screenshot\|from '.*screenshot" src --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "^src/screenshot/"`
Expected: EMPTY. The only remaining `screenshot/*` importer is the seed (`src/screenshot/seed/screenshot-seed.ts` → `../screenshot-mode`) and test files.

- [ ] **Step 2: Full unit suite (catches cross-file regressions)**

Run: `npx jest` (or `make jest`)
Expected: PASS. A scoped run can miss a consumer regression of `useAppLock`'s new field; run the whole suite.

- [ ] **Step 3: Fast+medium harness gate**

Run: `npm run check:all` (or `make gate`)
Expected: PASS — lint, dup, knip (screenshot-mode.ts exports still used by its own test, so no unused-export failure), deps, security, rules, plist, secrets, overrides, typecheck all green.

- [ ] **Step 4 (ops, device/sim): build the embedded Release JS bundle and grep it — THE ACCEPTANCE TEST**

Build the production embedded Release bundle (the same recipe the memory note "Screenshot build recipe (embedded bundle)" / release build uses, but with the DEFAULT `.env` — NOT any `.env.screenshots*`): `FORCE_BUNDLING=1` Release `-iphoneos` build, then locate `main.jsbundle`. Grep it:

```bash
for s in SCREENSHOT_MODE isScreenshotMode seedScreenshotData buildScreenshotDataset SCREENSHOT_STABLE_GLASS SCREENSHOT_SCENARIO 'Date.UTC(2026, 8, 10' 'Сільпо' 'Rozetka'; do
  echo "== $s =="; grep -c "$s" <path-to>/main.jsbundle
done
```

Expected: every count is `0`. A non-zero count means a guard did not fold (most likely a `require`/import left outside a foldable `SCREENSHOT_MODE === 'true'` branch, or a stray `isScreenshotMode()`/`isStableGlass()` call still importing `screenshot-mode.ts`). Fix by moving the offending reference behind a direct `@env` comparison in the same module.

- [ ] **Step 5 (ops, sim): screenshot regression still passes on the stable builds**

For each scenario, ops builds+installs the matching `ENVFILE` variant on the pinned simulator, then runs the check (per CLAUDE.md → check:screenshots):
- `ENVFILE=.env.screenshots.stable` → `npm run check:screenshots`
- `ENVFILE=.env.screenshots.empty.stable` → `npm run check:screenshots:empty`
- `ENVFILE=.env.screenshots.locked.stable` → `npm run check:screenshots:locked`

Expected: all PASS. The LOCKED scenario is the one to watch: the seed still forces `lockEnabled: true` (`src/screenshot/seed/screenshot-seed.ts`, `buildScreenshotDataset` → `lockEnabled: scenario === 'locked'`, persisted via `settingsRepo.setLockEnabled`), so `useAppLock` reports `isLocked: true` and LockGate shows the `lock-gate` frame; `promptOnMount` is `false` in that build (`SCREENSHOT_MODE === 'true'`), so LockGate does NOT auto-invoke the biometric sheet — identical captured frame to the committed baseline. The rich/empty scenarios seed `lockEnabled: false`, so LockGate is a pass-through and never prompts.

- [ ] **Step 6: Deep gate**

Run: `npm run check:deep` (or `make deep`) — detached, await exit code only (do NOT read Stryker progress; see memory "check:deep has no incremental output"). Mutation runs on the changed source files. `StableSurface` retains direct unit tests (Task 5) so its mutants stay killed; `useAppLock.promptOnMount`, the LockGate `promptOnMount` branch, and the two design-system inline guards are covered by the Task 1/2/4/5 tests. osv-scanner may exit 2 on the known-accepted CVEs only (see memory "check:deep exits 2 on known osv CVEs") — classify via ops; effectively-green = mutation ≥ threshold AND osv only the known set.
Expected: mutation score ≥ 60; no NEW CVEs.

- [ ] **Step 7: Commit any verification-driven fixes, then hand back**

If Steps 4-6 surfaced a leak, fix it behind a same-module foldable `@env` guard, re-run Steps 4-6, and commit. Do NOT weaken any check. When green, the branch is ready for review (kiko:reviewer) and integration. Version stays 1.0.0; build number unchanged.

---

## Self-Review

**1. Spec coverage.** (a) Remove LockGate bypass entirely → Task 2. (b) DCE the seed via lazy require in migrations.gate → Task 3; same treatment for glass-surface stable-glass → Task 5 and screen bounce → Task 4. (c) Screenshot builds still work → Task 6 Step 5 (all three scenarios), locked reaches its frame via `lockEnabled:true` + `promptOnMount:false` with zero LockGate screenshot-awareness. (d) No user-facing demo mode added; `promptOnMount`/`StableSurface` are structured so a future demo mode can reuse the seed without rework. (e) Minimal diff, release line only — five source files + their tests, no unrelated change. (f) Acceptance grep enumerated verbatim → Task 6 Step 4. (g) Flag mechanism + foldability cited (env.d.ts, screenshot-mode.test.ts header, `.env.example`) → Global Constraints + each task's doc comment. (h) DCE risk flags (side-effect imports, barrels, cross-module constants, function-call guards) → "Production import inventory" risk list + Global "Foldability rule".

**2. Placeholder scan.** No TBD/TODO; every code step shows the exact edit and the exact command.

**3. Type consistency.** `promptOnMount: boolean` defined in Task 1's `AppLock` type, produced by `useAppLock`, consumed in Task 2's LockGate destructure and its mock objects. `StableSurface` exported in Task 5 with props `{ children, style, tint, testID }` and imported by the same task's test and index. The `@env` names used (`SCREENSHOT_MODE`, `SCREENSHOT_STABLE_GLASS`) match `src/env.d.ts` declarations.
</content>
</invoke>
