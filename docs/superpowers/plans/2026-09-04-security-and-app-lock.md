# Security Hardening + Biometric App Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the SQLite database with SQLCipher behind a device-only Keychain key (migrating existing plaintext data once), harden the Monobank token's Keychain policy, pin `api.monobank.ua`, exclude the DB from backups, mechanize the no-`console` rule, and add a Face ID / passcode `LockGate` with a settings toggle, a foreground grace period, and a native app-switcher snapshot cover.

**Architecture:** `src/db/client.ts` stops opening the database at module load and instead exposes a lazy connection handle plus an async `initDatabase()` that `MigrationsGate` awaits before `runMigrations()`. A new `src/db/encrypted-database.ts` owns the SQLCipher open and the one-time `sqlcipher_export` of the legacy plaintext `pff.db` into `kiko-encrypted.db` (the key is persisted to the Keychain only after the export completes, so a crash never leaves an unreadable half-written file). A new `src/auth/` module wraps `@sbaiahmed1/react-native-biometrics`, holds the `useAppLock` hook (cold-launch lock + `AppState` grace math), and renders the `LockGate` that wraps the navigator inside `MigrationsGate`. Native changes (`AppDelegate.swift` privacy overlay + backup exclusion, `Info.plist` pins + Face ID string) are not unit-testable and carry explicit manual device-verification steps.

**Tech Stack:** React Native 0.87.1 (bare, Hermes, new arch), TypeScript, `@op-engineering/op-sqlite` 18.1.4 (SQLCipher build via `package.json` `"op-sqlite": { "sqlcipher": true }`), `drizzle-orm` 0.45.2 + `drizzle-kit`, `react-native-keychain` 10.0.0, new dependency `@sbaiahmed1/react-native-biometrics@0.16.0`, `fnts` 3, `ts-pattern` 5, `react-native-unistyles` 3, Jest 29 + `@testing-library/react-native` 14, Biome 2.5, Swift (AppDelegate).

**Spec:** `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md` (source of truth; research inputs `docs/research/2026-09-04-security-pass.md` and `docs/research/2026-09-04-biometric-app-lock.md`).

## Global Constraints

- Work in the main repo `/Users/drizzer14/Developer/Projects/pff-ios` on a feature branch off `main` (coordinator chooses the branch/worktree). Do not push. Hold commits for user review per the project's commit convention: one commit per task, conventional-commit subjects (`feat(db): …`, `feat(auth): …`, `chore(harness): …`, `build(native): …`).
- Standing harness rule (root `CLAUDE.md`): **fix the underlying issue, never weaken a check.** No `|| true`, no bare `biome-ignore` (only `OVERRIDE(...)`-justified), no unjustified `knip.json` / `.depcheckrc.json` / `.gitleaks.toml` entries.
- `npm run check:all` must be green at every task's commit checkpoint (`check:lint`, `check:dup`, `check:knip`, `check:deps`, `check:security`, `check:secrets`, `check:overrides`). `npm run check:deep` (Stryker mutation ≥ 60 + osv-scanner) runs once before declaring the feature done (Task 15). The 2 known `image-size` CVEs are accepted debt per `CLAUDE.md` — do not suppress them.
- `.npmrc` `min-release-age=7`: the new dependency is pinned to the exact version `0.16.0`, published 2026-08-07 (verified with `npm view @sbaiahmed1/react-native-biometrics time`), so it clears the 7-day floor with no `.npmrc` exclude. Its only peer beyond `react`/`react-native` is `expo`, declared `optional: true` — no Expo runtime is pulled in.
- Style rules from `.claude/skills/kiko-code-style/SKILL.md` apply to every file: single quotes, 2-space indent, 100-char width, trailing commas, `(x) =>` parens; **blank line before every `return` / `if` / `for` / `while` / `switch`** (except as the first statement in a block); imports in two groups (external + aliased, then relative), each group sorted shortest-line-first; `import type` / inline `type` for types; `ts-pattern` `match(...).exhaustive()` for closed literal unions; `fnts` `either` / `eitherSync` / `isLeft` / `bifold` instead of `try`/`catch`; full unabbreviated names with uppercase acronyms (`DB`, `SQL`, `ID`); components are default exports in `<name>.component.tsx` inside their own folder with `.props.ts` / `.styles.ts` siblings, one component per file, explicit `return`; infrastructure React modules (gates, hooks) stay unsuffixed; helpers that close over nothing live at module scope; components read theme tokens only (no raw colors/spacing); blank line between sibling JSX nodes; UI headings in Title Case.
- Repository rules (`kiko-architecture`): every write goes through `write()` from `src/db/client.ts`; read functions return Drizzle query builders; repositories are plain modules with `satisfies Repository`.
- Tests: Jest via `npx jest <path>`; RNTL `render`/`renderHook` are awaited (see existing tests). Test files sit beside the module (`<name>.test.ts[x]`). Test factories may only reference variables prefixed `mock` (babel-plugin-jest-hoist).
- Copy for the user-facing strings in this plan is final: `"Unlock Kiko with Face ID"` (Info.plist), `"Unlock Kiko"` (biometric prompt title), `"App Lock"` (settings row), `"Lock again after"` (grace label), grace labels `Immediately` / `30 sec` / `1 min` / `5 min`.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `biome.json` | modify | Add `suspicious.noConsole: "error"`. |
| `docs/harness/review-to-biome-inventory.md` | modify | Record `noConsole` as now enforced. |
| `.env` | modify | Header note: public-only values, inlined into the bundle. |
| `CLAUDE.md` | modify | `.env` public-only paragraph under "Dependency hygiene". |
| `src/monobank/token.ts` (+ `token.test.ts`) | modify | `accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` on `saveToken`. |
| `src/db/keys/db-key.ts` (+ `db-key.test.ts`) | create | Keychain read/store of the DB key, CSPRNG key generation, SQLCipher raw-key formatting. |
| `src/db/encrypted-database.ts` (+ `.test.ts`) | create | `openEncryptedDatabase()`: SQLCipher-build guard, key resolution, one-time plaintext→encrypted export, leftover cleanup. |
| `package.json` | modify | `"op-sqlite": { "sqlcipher": true }`; new dependency. |
| `src/db/client.ts` (+ `client.test.ts`) | modify | Lazy `rawDatabase` proxy, `initDatabase()`, proxy-based `wrapClientForDrizzle`. |
| `src/db/migrations.gate.tsx` (+ new `migrations.gate.test.tsx`) | modify | `initDatabase()` then `runMigrations()`. |
| `src/db/use-live-query.ts` (+ `.test.ts`) | modify | Add `isLoading` to the return shape. |
| `ios/Kiko/AppDelegate.swift` | modify | Privacy overlay on resign-active/background; backup exclusion of DB files. |
| `ios/Kiko/Info.plist` | modify | `NSPinnedDomains` for `api.monobank.ua`; `NSFaceIDUsageDescription`. |
| `docs/security/README.md` | create | Pin rotation runbook + accepted-risk register (jailbreak, pre-existing token, migration residuals). |
| `jest/setup.js` | modify | Global mock for `@sbaiahmed1/react-native-biometrics`. |
| `src/auth/biometrics.ts` (+ `.test.ts`) | create | Thin wrapper: `isSensorAvailable()` → `SensorStatus`, `authenticate()` → `AuthResult`. |
| `src/auth/lock-grace.ts` (+ `.test.ts`) | create | `LOCK_GRACE_OPTIONS` tuple, `LockGraceSeconds`, default, labels. |
| `src/db/schema.ts` | modify | `settings.lockEnabled`, `settings.lockGraceSeconds`. |
| `drizzle/migrations/0007_add_lock_settings.sql`, `meta/0007_snapshot.json`, `meta/_journal.json`, `migrations.js` | generate | Drizzle migration for the two columns. |
| `src/repositories/settings.repo.ts` (+ `.test.ts`) | modify | `setLockEnabled`, `setLockGraceSeconds`. |
| `src/auth/use-app-lock.ts` (+ `.test.ts`) | create | `shouldRelock()` pure helper; `useAppLock()` hook. |
| `src/auth/lock-gate/lock-gate.component.tsx`, `lock-gate.styles.ts` (+ `.component.test.tsx`) | create | Full-screen unlock prompt vs. children. |
| `App.tsx`, `__tests__/App.test.tsx` | modify | Wrap `AppRoot` in `LockGate`. |
| `src/design-system/components/option-pills/option-pills.component.tsx`, `.props.ts`, `index.ts` (+ test) | create | Generic pill selector extracted from `CurrencySwitch`. |
| `src/design-system/components/currency-switch/currency-switch.component.tsx` | modify | Delegate to `OptionPills`. |
| `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx`, `.props.ts` (+ test) | create | Lock toggle + sensor hint + grace pills card. |
| `src/screens/settings/settings.screen.tsx` (+ `.test.tsx`) | modify | Mount `AppLockSetting`. |

Spec items with **no code change**, handled as verification steps: `monobank-token-field.component.tsx` prefill (Task 15 — the token has no `accessControl`, so its eager `readToken()` is a silent double *read*, not a prompt; existing tests already cover the prefill), `knip.json` / `.depcheckrc.json` (Task 9 verifies the new dependency is seen through `src/auth/biometrics.ts`; no exception is added), jailbreak detection (documented as accepted risk in Task 8's doc).

Spec deviations, decided here: (1) `getOrCreateDbKey()` is split into `readDbKey` / `generateDbKey` / `storeDbKey` because the key must be persisted *after* the plaintext export succeeds — the composed "get or create" behavior (idempotent, generate-only-when-absent) is tested on `openEncryptedDatabase()` in Task 4. (2) The encrypted file is `kiko-encrypted.db`, not `pff.db`: op-sqlite has no rename API, so the export writes to a new file and deletes the plaintext one. (3) `useAppLock` returns `{ isReady, isLocked, unlock }` — `isReady` is needed so `LockGate` never renders real data before `settings.lockEnabled` has loaded. (4) `LockGate` lives in `src/auth/lock-gate/` (component-folder convention) rather than flat `src/auth/lock-gate.component.tsx`. (5) `Screen` cannot be used by `LockGate` (its `useBottomTabBarHeight()` throws outside the tab navigator), so the gate composes `SafeAreaView` + `Box` directly.

---

### Task 1: Mechanize `noConsole` and document the `.env` public-only rule

**Files:**
- Modify: `biome.json:31`
- Modify: `docs/harness/review-to-biome-inventory.md` (after the "Key findings" bullet list, line 19)
- Modify: `.env:1-4`
- Modify: `CLAUDE.md` ("Dependency hygiene" section, after the `.npmrc` code block explanation)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run check:lint` fails on any `console.*` call in Biome-scanned files.

- [ ] **Step 1: Write the failing "test" — a scratch file the rule must reject**

Create `src/tmp-no-console.ts`:

```ts
export const leak = (): void => {
  console.log('this must fail lint');
};
```

- [ ] **Step 2: Run lint to confirm it currently passes (the rule is missing)**

Run: `npx --no-install biome lint src/tmp-no-console.ts`
Expected: exit 0, no `noConsole` diagnostic (the rule is not configured yet).

- [ ] **Step 3: Add the rule**

In `biome.json`, replace the `suspicious` line:

```json
      "suspicious": { "noExplicitAny": "error", "noConsole": "error" },
```

- [ ] **Step 4: Run lint to verify the scratch file now fails, then delete it**

Run: `npx --no-install biome lint src/tmp-no-console.ts`
Expected: exit 1 with `lint/suspicious/noConsole` on line 2.

Run: `rm src/tmp-no-console.ts && npm run check:lint`
Expected: silent success (a repo-wide grep confirmed there is no `console.` call in any scanned `.ts`/`.tsx`/`.js` today).

- [ ] **Step 5: Record the rule in the inventory**

Append to the bullet list under `## Key findings` in `docs/harness/review-to-biome-inventory.md`:

```markdown
- 2026-09-04: `suspicious/noConsole` ("error") added to `biome.json` by the
  security-and-app-lock plan, mechanizing the "no `console.*` in `src`"
  convention that previously relied on manual review. No `allow` list.
```

- [ ] **Step 6: Document the `.env` public-only rule**

Replace the first four comment lines of `.env` with:

```
# Committed, PUBLIC (non-secret) configuration consumed via `@env`
# (react-native-dotenv). Keeping this file tracked means Jest and CI build
# the same values with no mock. SECURITY: react-native-dotenv inlines every
# value here into the JS bundle at build time, so anything in this file ships
# in plaintext to every device. Never put a token, key, or credential here —
# secrets live in the iOS Keychain (see src/monobank/token.ts). For
# local-only overrides, copy a key into an untracked `.env.local` (gitignored)
# instead of editing this file.
```

Add to `CLAUDE.md`, at the end of the "Dependency hygiene" section (immediately before the `### Known dependency CVEs` heading):

```markdown
### `.env` is public-only

`react-native-dotenv` inlines every `.env` value into the JS bundle at
build time, so anything placed there ships in plaintext to every device.
Only public, non-secret values (a public API URL, a feature flag) belong
in `.env`. Secrets live in the iOS Keychain (`react-native-keychain`),
never in `.env`, `.env.local`, the database, or a log.
```

- [ ] **Step 7: Run the fast checks and commit**

Run: `npm run check:lint && npm run check:secrets && npm run check:overrides`
Expected: silent success.

```bash
git add biome.json docs/harness/review-to-biome-inventory.md .env CLAUDE.md
git commit -m "chore(harness): enforce noConsole via Biome; document .env public-only rule"
```

---

### Task 2: Harden the Monobank token's Keychain policy

**Files:**
- Modify: `src/monobank/token.ts:5-7`
- Modify: `src/monobank/token.test.ts`

**Interfaces:**
- Consumes: `react-native-keychain` `setGenericPassword(username, password, options?: SetOptions)`, `ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY` (= `'AccessibleWhenUnlockedThisDeviceOnly'`).
- Produces: `saveToken(token: string): Promise<void>` unchanged signature; the stored item now carries `accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`. `readToken` / `clearToken` unchanged.

- [ ] **Step 1: Write the failing test**

Replace `src/monobank/token.test.ts` with:

```ts
import * as Keychain from 'react-native-keychain';
import { clearToken, readToken, saveToken } from './token';

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(async (username: string, password: string) => {
      store = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async () => store ?? false),
    resetGenericPassword: jest.fn(async () => {
      store = null;
      return true;
    }),
  };
});

describe('monobank token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves and reads the token', async () => {
    await saveToken('secret-token');
    expect(await readToken()).toBe('secret-token');
  });

  it('clears the token', async () => {
    await saveToken('secret-token');
    await clearToken();
    expect(await readToken()).toBeUndefined();
  });

  it('stores the token readable only while unlocked and never migrated off-device', async () => {
    await saveToken('secret-token');

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('monobank', 'secret-token', {
      service: 'pff.monobank.token',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('adds no accessControl (a biometric prompt would break the silent auto-sync read)', async () => {
    await saveToken('secret-token');

    const [, , options] = (Keychain.setGenericPassword as jest.Mock).mock.calls[0];
    expect(options).not.toHaveProperty('accessControl');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/monobank/token.test.ts`
Expected: FAIL — the `accessible` assertion fails because the call receives `{ service: 'pff.monobank.token' }` only.

- [ ] **Step 3: Implement**

Replace `src/monobank/token.ts` lines 5-7 with:

```ts
/**
 * Storage-at-rest policy for the token: readable only while the device is
 * unlocked, and bound to this device (never restored onto another one from
 * an encrypted backup). Deliberately NO `accessControl` — a biometric prompt
 * on this item would break the silent background auto-sync read
 * (`useAutoSync` -> `readToken`). The app-wide biometric gate is `LockGate`
 * (`src/auth`), not the Keychain item. A token saved before this shipped keeps
 * its old (default) policy until the user reconnects and re-saves it — see
 * docs/security/README.md "Accepted risks".
 */
export const saveToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword('monobank', token, {
    service,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/monobank/token.test.ts src/screens/use-auto-sync.test.ts src/screens/account-detail/monobank-token-field.component.test.tsx`
Expected: PASS (auto-sync and the token field mock `readToken`, so they are unaffected — this run proves it).

- [ ] **Step 5: Commit**

Run: `npm run check:lint`
Expected: silent success.

```bash
git add src/monobank/token.ts src/monobank/token.test.ts
git commit -m "feat(security): store the Monobank token WHEN_UNLOCKED_THIS_DEVICE_ONLY"
```

---

### Task 3: Database key module (`src/db/keys/db-key.ts`)

**Files:**
- Create: `src/db/keys/db-key.ts`
- Create: `src/db/keys/db-key.test.ts`

**Interfaces:**
- Consumes: `react-native-keychain` (`getGenericPassword`, `setGenericPassword`, `ACCESSIBLE`), `@op-engineering/op-sqlite` `open({ name, location: ':memory:' })` → `DB` with `executeSync(sql, params): { rows: Array<Record<string, Scalar>> }` and `close(): void`.
- Produces (all named exports):
  ```ts
  export const DB_KEY_SERVICE = 'pff.db.key';
  export const readDbKey: () => Promise<string | undefined>;   // 64 lowercase hex chars, or undefined
  export const storeDbKey: (keyHex: string) => Promise<void>;  // accessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY
  export const generateDbKey: () => string;                    // 64 lowercase hex chars (32 random bytes)
  export const toSQLCipherRawKey: (keyHex: string) => string;  // "x'<hex>'" — SQLCipher raw-key syntax
  ```

Design note (why not `crypto.getRandomValues`): Hermes ships no WebCrypto — a `strings` scan of the RN 0.87 `hermesvm` binary under `ios/Pods/hermes-engine` finds no `getRandomValues`. SQLite's `randomblob()` is a ChaCha20 stream keyed with 44 bytes from the OS CSPRNG (`/dev/urandom` via the unix VFS) — CSPRNG-grade and already in the app. `Math.random` is banned for secrets by `rules/semgrep-mobile.yml` (`kiko-insecure-random-for-secrets`). If review prefers the platform CSPRNG directly, the drop-in alternative is the `react-native-get-random-values` package (`SecRandomCopyBytes`); that is a new dependency and needs user approval.

- [ ] **Step 1: Write the failing tests**

Create `src/db/keys/db-key.test.ts`:

```ts
import * as Keychain from 'react-native-keychain';
import { open } from '@op-engineering/op-sqlite';
import { DB_KEY_SERVICE, generateDbKey, readDbKey, storeDbKey, toSQLCipherRawKey } from './db-key';

const HEX_KEY = 'ab'.repeat(32);

jest.mock('react-native-keychain', () => {
  let store: { username: string; password: string } | null = null;
  return {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
    setGenericPassword: jest.fn(async (username: string, password: string) => {
      store = { username, password };
      return true;
    }),
    getGenericPassword: jest.fn(async () => store ?? false),
    resetGenericPassword: jest.fn(async () => {
      store = null;
      return true;
    }),
  };
});

const mockClose = jest.fn();
const mockExecuteSync = jest.fn(() => ({ rows: [{ keyHex: 'ab'.repeat(32) }] }));
jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ executeSync: mockExecuteSync, close: mockClose })),
}));

describe('db-key', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await Keychain.resetGenericPassword({ service: DB_KEY_SERVICE });
    mockExecuteSync.mockReturnValue({ rows: [{ keyHex: HEX_KEY }] });
  });

  it('reads undefined when no key is stored', async () => {
    expect(await readDbKey()).toBeUndefined();
    expect(Keychain.getGenericPassword).toHaveBeenCalledWith({ service: 'pff.db.key' });
  });

  it('round-trips a stored key', async () => {
    await storeDbKey(HEX_KEY);
    expect(await readDbKey()).toBe(HEX_KEY);
  });

  it('stores the key device-only and readable only while unlocked, under its own service', async () => {
    await storeDbKey(HEX_KEY);

    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('kiko', HEX_KEY, {
      service: 'pff.db.key',
      accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
    });
  });

  it('generates 32 random bytes as 64 lowercase hex chars from an in-memory SQLite connection', () => {
    const keyHex = generateDbKey();

    expect(keyHex).toBe(HEX_KEY);
    expect(open).toHaveBeenCalledWith({ name: 'kiko-key-entropy', location: ':memory:' });
    expect(mockExecuteSync).toHaveBeenCalledWith(expect.stringContaining('randomblob(?)'), [32]);
  });

  it('closes the entropy connection after drawing the key', () => {
    generateDbKey();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('throws instead of returning a malformed key', () => {
    mockExecuteSync.mockReturnValue({ rows: [{ keyHex: 'too-short' }] });
    expect(() => generateDbKey()).toThrow('Could not generate a database key');
  });

  it('formats the SQLCipher raw-key literal', () => {
    expect(toSQLCipherRawKey(HEX_KEY)).toBe(`x'${HEX_KEY}'`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/db/keys/db-key.test.ts`
Expected: FAIL — `Cannot find module './db-key'`.

- [ ] **Step 3: Implement**

Create `src/db/keys/db-key.ts`:

```ts
import { open } from '@op-engineering/op-sqlite';
import * as Keychain from 'react-native-keychain';

/** Keychain service holding the SQLCipher key. Separate from the Monobank token's service. */
export const DB_KEY_SERVICE = 'pff.db.key';

const KEY_USERNAME = 'kiko';
const KEY_BYTES = 32;
const HEX_CHARS_PER_BYTE = 2;

export const readDbKey = async (): Promise<string | undefined> => {
  const credentials = await Keychain.getGenericPassword({ service: DB_KEY_SERVICE });

  return credentials ? credentials.password : undefined;
};

/**
 * Same storage policy as the Monobank token: readable only while the device
 * is unlocked, never migrated to another device via backup restore. No
 * `accessControl` — the key is read silently at every launch before any UI.
 */
export const storeDbKey = async (keyHex: string): Promise<void> => {
  await Keychain.setGenericPassword(KEY_USERNAME, keyHex, {
    service: DB_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
};

/**
 * 32 random bytes as 64 lowercase hex chars. Hermes ships no WebCrypto
 * (`crypto.getRandomValues` is undefined), so the entropy comes from SQLite's
 * `randomblob()` — a ChaCha20 stream seeded from the OS CSPRNG — drawn on a
 * throwaway in-memory connection so no file is touched. Never `Math.random`.
 */
export const generateDbKey = (): string => {
  const entropy = open({ name: 'kiko-key-entropy', location: ':memory:' });
  const result = entropy.executeSync('SELECT lower(hex(randomblob(?))) AS keyHex', [KEY_BYTES]);
  entropy.close();
  const keyHex = result.rows[0]?.keyHex;

  if (typeof keyHex !== 'string' || keyHex.length !== KEY_BYTES * HEX_CHARS_PER_BYTE) {
    throw new Error('Could not generate a database key');
  }

  return keyHex;
};

/**
 * SQLCipher's raw-key syntax. Skips the PBKDF2 passphrase derivation, which
 * adds nothing to an already-random 256-bit key and costs hundreds of
 * milliseconds on every open.
 */
export const toSQLCipherRawKey = (keyHex: string): string => "x'".concat(keyHex, "'");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/db/keys/db-key.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

Run: `npm run check:lint && npm run check:security`
Expected: silent success (the Semgrep `Math.random` rule has nothing to match).

```bash
git add src/db/keys/db-key.ts src/db/keys/db-key.test.ts
git commit -m "feat(db): Keychain-backed SQLCipher key module"
```

---

### Task 4: SQLCipher build + `openEncryptedDatabase()` with the one-time plaintext→encrypted migration

This is the highest-risk task in the plan: it moves every existing user's data. The unit tests pin the exact statement sequence and the crash-safe ordering (export → persist key → delete plaintext); the manual step at the end proves real data survives on a device.

**Files:**
- Modify: `package.json` (top-level `"op-sqlite"` block)
- Modify: `ios/Podfile.lock` (via `pod install`)
- Create: `src/db/encrypted-database.ts`
- Create: `src/db/encrypted-database.test.ts`

**Interfaces:**
- Consumes: from Task 3 `readDbKey`, `generateDbKey`, `storeDbKey`, `toSQLCipherRawKey`; op-sqlite `open(options: { name; location?; encryptionKey?; failOnCreate? }): DB`, `isSQLCipher(): boolean`, `DB.execute(sql, params?): Promise<QueryResult>`, `DB.delete(): void`, `DB.getDbPath(): string`; `fnts/either` `eitherSync`, `isLeft`, `bifold`.
- Produces:
  ```ts
  export const PLAINTEXT_DATABASE_NAME = 'pff.db';
  export const ENCRYPTED_DATABASE_NAME = 'kiko-encrypted.db';
  export const openEncryptedDatabase: () => Promise<DB>;
  ```

Behavior contract of `openEncryptedDatabase()`:
1. Throws if `isSQLCipher()` is false (misconfigured native build must fail loudly, never fall back to plaintext).
2. Key present in Keychain → delete any leftover `pff.db` (a crash window from a previous run) → open `kiko-encrypted.db` with the key.
3. Key absent → generate → if `pff.db` exists (opened with `failOnCreate: true`): discard any stale partial `kiko-encrypted.db`, then `ATTACH DATABASE <path> AS encrypted KEY <rawKey>` + `SELECT sqlcipher_export('encrypted')` + `DETACH DATABASE encrypted` on the plaintext connection → `storeDbKey` → `plaintext.delete()` → open encrypted. If `pff.db` does not exist (fresh install): `storeDbKey` → open encrypted.
4. Any export failure propagates (MigrationsGate shows it); the key is not stored and the plaintext is untouched, so the next launch retries from scratch.

- [ ] **Step 1: Enable the SQLCipher backend in the native build**

Add to `package.json` as a new top-level key (after `"overrides"`):

```json
  "op-sqlite": {
    "sqlcipher": true
  }
```

Run: `cd ios && pod install && cd ..`
Expected: pod install succeeds; `op-sqlite.podspec` reads `app_package["op-sqlite"]["sqlcipher"] == true` and compiles `cpp/sqlcipher/sqlite3.c` with `OP_SQLITE_USE_SQLCIPHER=1` (visible in `ios/Pods/Target Support Files/op-sqlite/op-sqlite.debug.xcconfig` under `GCC_PREPROCESSOR_DEFINITIONS`).

Run: `grep -c "OP_SQLITE_USE_SQLCIPHER=1" "ios/Pods/Target Support Files/op-sqlite/op-sqlite.debug.xcconfig"`
Expected: `1`.

- [ ] **Step 2: Write the failing tests**

Create `src/db/encrypted-database.test.ts`:

```ts
import {
  ENCRYPTED_DATABASE_NAME,
  PLAINTEXT_DATABASE_NAME,
  openEncryptedDatabase,
} from './encrypted-database';

const HEX_KEY = 'cd'.repeat(32);
const RAW_KEY = `x'${HEX_KEY}'`;
const LIBRARY_DIR = '/var/mobile/Containers/Data/Application/APP/Library';

type FakeDb = {
  name: string;
  execute: jest.Mock;
  delete: jest.Mock;
  getDbPath: () => string;
};

// Files that "exist on disk" for the fake `open`; `failOnCreate: true` throws
// for a name not in this set, mirroring op-sqlite.
const mockFiles = new Set<string>();
const mockHandles = new Map<string, FakeDb>();
const mockOpen = jest.fn();
const mockIsSQLCipher = jest.fn(() => true);

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
  isSQLCipher: () => mockIsSQLCipher(),
}));

const mockReadDbKey = jest.fn<Promise<string | undefined>, []>();
const mockGenerateDbKey = jest.fn(() => 'cd'.repeat(32));
const mockStoreDbKey = jest.fn(async () => undefined);
jest.mock('./keys/db-key', () => ({
  readDbKey: () => mockReadDbKey(),
  generateDbKey: () => mockGenerateDbKey(),
  storeDbKey: (keyHex: string) => mockStoreDbKey(keyHex),
  toSQLCipherRawKey: (keyHex: string) => "x'".concat(keyHex, "'"),
}));

const handleFor = (name: string): FakeDb => {
  const existing = mockHandles.get(name);

  if (existing !== undefined) {
    return existing;
  }

  const handle: FakeDb = {
    name,
    execute: jest.fn(async () => ({ rows: [], rowsAffected: 0 })),
    delete: jest.fn(() => {
      mockFiles.delete(name);
    }),
    getDbPath: () => `${LIBRARY_DIR}/${name}`,
  };
  mockHandles.set(name, handle);

  return handle;
};

const orderOf = (mock: jest.Mock, callIndex = 0): number => mock.mock.invocationCallOrder[callIndex];

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockHandles.clear();
  mockIsSQLCipher.mockReturnValue(true);
  mockReadDbKey.mockResolvedValue(undefined);
  mockOpen.mockImplementation((options: { name: string; failOnCreate?: boolean }) => {
    if (options.failOnCreate === true && !mockFiles.has(options.name)) {
      throw new Error(`no such file: ${options.name}`);
    }

    mockFiles.add(options.name);

    return handleFor(options.name);
  });
});

describe('openEncryptedDatabase', () => {
  it('refuses to run on an op-sqlite build without SQLCipher', async () => {
    mockIsSQLCipher.mockReturnValue(false);

    await expect(openEncryptedDatabase()).rejects.toThrow('without SQLCipher');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  describe('steady state: key already in the Keychain', () => {
    beforeEach(() => {
      mockReadDbKey.mockResolvedValue(HEX_KEY);
      mockFiles.add(ENCRYPTED_DATABASE_NAME);
    });

    it('opens the encrypted database with the stored key and generates nothing', async () => {
      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenCalledWith({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: RAW_KEY });
      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });

    it('is idempotent: a second call reuses the same stored key', async () => {
      await openEncryptedDatabase();
      await openEncryptedDatabase();

      expect(mockGenerateDbKey).not.toHaveBeenCalled();
      const encryptedOpens = mockOpen.mock.calls.filter(
        ([options]) => options.name === ENCRYPTED_DATABASE_NAME && options.encryptionKey === RAW_KEY,
      );
      expect(encryptedOpens).toHaveLength(2);
    });

    it('removes a leftover plaintext file from an interrupted earlier migration', async () => {
      mockFiles.add(PLAINTEXT_DATABASE_NAME);

      await openEncryptedDatabase();

      expect(handleFor(PLAINTEXT_DATABASE_NAME).delete).toHaveBeenCalledTimes(1);
      expect(mockFiles.has(PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('does not create a plaintext file just to check for one', async () => {
      await openEncryptedDatabase();

      const plaintextOpens = mockOpen.mock.calls.filter(([options]) => options.name === PLAINTEXT_DATABASE_NAME);
      expect(plaintextOpens).toEqual([[{ name: PLAINTEXT_DATABASE_NAME, failOnCreate: true }]]);
      expect(mockFiles.has(PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('recreates a fresh encrypted database when the key exists but the file was removed (no export misfires)', async () => {
      mockFiles.delete(ENCRYPTED_DATABASE_NAME);

      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: RAW_KEY });
      expect(handleFor(ENCRYPTED_DATABASE_NAME).execute).not.toHaveBeenCalled();
      expect(mockStoreDbKey).not.toHaveBeenCalled();
    });
  });

  describe('fresh install: no key, no plaintext file', () => {
    it('generates and stores a key, then opens a new encrypted database without any export', async () => {
      const db = await openEncryptedDatabase();

      expect(mockGenerateDbKey).toHaveBeenCalledTimes(1);
      expect(mockStoreDbKey).toHaveBeenCalledWith(HEX_KEY);
      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: RAW_KEY });
      expect(mockHandles.get(PLAINTEXT_DATABASE_NAME)).toBeUndefined();
    });

    it('persists the key before opening the encrypted file (a crash in between must not orphan the file)', async () => {
      await openEncryptedDatabase();

      const encryptedOpenIndex = mockOpen.mock.calls.findIndex(
        ([options]) => options.name === ENCRYPTED_DATABASE_NAME,
      );
      expect(orderOf(mockStoreDbKey)).toBeLessThan(orderOf(mockOpen, encryptedOpenIndex));
    });
  });

  describe('upgrade: no key, existing plaintext pff.db with data', () => {
    beforeEach(() => {
      mockFiles.add(PLAINTEXT_DATABASE_NAME);
    });

    it('exports the plaintext database into an encrypted copy beside it, keyed with the new key', async () => {
      await openEncryptedDatabase();

      const plaintext = handleFor(PLAINTEXT_DATABASE_NAME);
      expect(plaintext.execute.mock.calls).toEqual([
        ['ATTACH DATABASE ? AS encrypted KEY ?', [`${LIBRARY_DIR}/${ENCRYPTED_DATABASE_NAME}`, RAW_KEY]],
        ["SELECT sqlcipher_export('encrypted')"],
        ['DETACH DATABASE encrypted'],
      ]);
    });

    it('stores the key only after the export finished, and deletes the plaintext only after the key is stored', async () => {
      await openEncryptedDatabase();

      const plaintext = handleFor(PLAINTEXT_DATABASE_NAME);
      const detachIndex = plaintext.execute.mock.calls.findIndex(([sql]) => sql === 'DETACH DATABASE encrypted');
      expect(orderOf(plaintext.execute, detachIndex)).toBeLessThan(orderOf(mockStoreDbKey));
      expect(orderOf(mockStoreDbKey)).toBeLessThan(orderOf(plaintext.delete));
      expect(mockFiles.has(PLAINTEXT_DATABASE_NAME)).toBe(false);
    });

    it('then opens the encrypted database with that same key', async () => {
      const db = await openEncryptedDatabase();

      expect(db).toBe(handleFor(ENCRYPTED_DATABASE_NAME));
      expect(mockOpen).toHaveBeenLastCalledWith({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: RAW_KEY });
    });

    it('discards a stale partial encrypted file before exporting into it', async () => {
      mockFiles.add(ENCRYPTED_DATABASE_NAME);

      await openEncryptedDatabase();

      const stale = handleFor(ENCRYPTED_DATABASE_NAME);
      const plaintext = handleFor(PLAINTEXT_DATABASE_NAME);
      expect(stale.delete).toHaveBeenCalledTimes(1);
      expect(orderOf(stale.delete)).toBeLessThan(orderOf(plaintext.execute));
    });

    it('leaves the plaintext intact and stores no key when the export fails', async () => {
      const plaintext = handleFor(PLAINTEXT_DATABASE_NAME);
      plaintext.execute.mockImplementation(async (sql: string) => {
        if (sql.includes('sqlcipher_export')) {
          throw new Error('disk full');
        }

        return { rows: [], rowsAffected: 0 };
      });

      await expect(openEncryptedDatabase()).rejects.toThrow('disk full');

      expect(mockStoreDbKey).not.toHaveBeenCalled();
      expect(plaintext.delete).not.toHaveBeenCalled();
      expect(mockFiles.has(PLAINTEXT_DATABASE_NAME)).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/db/encrypted-database.test.ts`
Expected: FAIL — `Cannot find module './encrypted-database'`.

- [ ] **Step 4: Implement**

Create `src/db/encrypted-database.ts`:

```ts
import { bifold, eitherSync, isLeft } from 'fnts/either';
import { type DB, isSQLCipher, open } from '@op-engineering/op-sqlite';

import { generateDbKey, readDbKey, storeDbKey, toSQLCipherRawKey } from './keys/db-key';

/** The unencrypted file every install before encryption shipped wrote to. */
export const PLAINTEXT_DATABASE_NAME = 'pff.db';

/**
 * The SQLCipher-encrypted database. A different file name because op-sqlite
 * exposes no rename: the one-time export below writes here, then deletes the
 * plaintext file. Mirrored by name in `ios/Kiko/AppDelegate.swift`
 * (`excludeDatabaseFilesFromBackup`) — keep the two in sync.
 */
export const ENCRYPTED_DATABASE_NAME = 'kiko-encrypted.db';

const ATTACHED_ALIAS = 'encrypted';

/** Opens an existing file only; `undefined` when it does not exist (nothing is created). */
const openExisting = (name: string): DB | undefined => {
  const attempt = eitherSync<unknown, DB>(() => open({ name, failOnCreate: true }));

  if (isLeft(attempt)) {
    return undefined;
  }

  return bifold(attempt);
};

const assertSQLCipherBuild = (): void => {
  if (!isSQLCipher()) {
    throw new Error(
      'op-sqlite was built without SQLCipher. Set "op-sqlite": { "sqlcipher": true } in package.json and re-run pod install.',
    );
  }
};

const encryptedPathBeside = (plaintext: DB): string =>
  plaintext.getDbPath().replace(/[^/]+$/, ENCRYPTED_DATABASE_NAME);

/**
 * SQLCipher's documented plaintext -> encrypted conversion: attach the target
 * with a key, export every table into it, detach. Runs on the plaintext
 * connection; the target file is created by ATTACH.
 */
const exportPlaintextInto = async (plaintext: DB, encryptedPath: string, rawKey: string): Promise<void> => {
  await plaintext.execute(`ATTACH DATABASE ? AS ${ATTACHED_ALIAS} KEY ?`, [encryptedPath, rawKey]);
  await plaintext.execute(`SELECT sqlcipher_export('${ATTACHED_ALIAS}')`);
  await plaintext.execute(`DETACH DATABASE ${ATTACHED_ALIAS}`);
};

/**
 * First launch with no key: either a fresh install (no plaintext file) or an
 * upgrade from the plaintext era. Ordering is the crash-safety contract:
 *   1. export the plaintext into a fresh encrypted copy,
 *   2. only then persist the key (a crash before this leaves plaintext + no
 *      key, so the next launch simply redoes the export from scratch and never
 *      trusts a partial file),
 *   3. only then delete the plaintext (a crash before this leaves a stale
 *      plaintext file, removed by `removeLeftoverPlaintext` next launch).
 */
const establishKey = async (keyHex: string): Promise<void> => {
  const plaintext = openExisting(PLAINTEXT_DATABASE_NAME);

  if (plaintext === undefined) {
    await storeDbKey(keyHex);

    return;
  }

  // A partial target from an interrupted earlier attempt would make the export
  // fail on duplicate tables — start from a clean file.
  openExisting(ENCRYPTED_DATABASE_NAME)?.delete();
  await exportPlaintextInto(plaintext, encryptedPathBeside(plaintext), toSQLCipherRawKey(keyHex));
  await storeDbKey(keyHex);
  plaintext.delete();
};

const removeLeftoverPlaintext = (): void => {
  openExisting(PLAINTEXT_DATABASE_NAME)?.delete();
};

const resolveDbKey = async (): Promise<string> => {
  const existingKey = await readDbKey();

  if (existingKey !== undefined) {
    removeLeftoverPlaintext();

    return existingKey;
  }

  const keyHex = generateDbKey();
  await establishKey(keyHex);

  return keyHex;
};

/**
 * Opens the app database encrypted with SQLCipher, keyed from the Keychain,
 * running the one-time plaintext migration when needed. Called once per
 * process by `initDatabase()` in `client.ts`, before any schema migration.
 */
export const openEncryptedDatabase = async (): Promise<DB> => {
  assertSQLCipherBuild();
  const keyHex = await resolveDbKey();

  return open({ name: ENCRYPTED_DATABASE_NAME, encryptionKey: toSQLCipherRawKey(keyHex) });
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/db/encrypted-database.test.ts src/db/keys/db-key.test.ts`
Expected: PASS (13 + 7 tests).

- [ ] **Step 6: Commit**

Run: `npm run check:lint && npm run check:dup`
Expected: silent success.

```bash
git add package.json ios/Podfile.lock src/db/encrypted-database.ts src/db/encrypted-database.test.ts
git commit -m "feat(db): SQLCipher build flag + encrypted open with one-time plaintext export"
```

- [ ] **Step 7: MANUAL DEVICE VERIFICATION (do after Task 6 wires it in; recorded here because this task owns the risk)**

Upgrade path — existing data must survive:
1. On the simulator or device, install the **current `main`** build (`git stash` / a separate checkout is fine), create at least one account + holding + a manual transaction, and note the exact balances.
2. Install the feature build over it (do not delete the app). Launch.
3. Expected: the app opens straight to Home with the same accounts, holdings, and balances. No "Migration error" text.
4. Inspect the container: `xcrun simctl get_app_container booted com.dmytro.pff data` → `ls -la <container>/Library/` shows `kiko-encrypted.db` (plus `-wal`/`-shm`) and **no** `pff.db`.
5. `sqlite3 <container>/Library/kiko-encrypted.db 'SELECT count(*) FROM accounts;'` from the Mac must print `Error: file is not a database` — proof the file is encrypted (the stock macOS `sqlite3` has no SQLCipher).

Fresh-install path:
6. Delete the app, install the feature build, launch. Expected: opens to an empty Home; `ls Library/` shows `kiko-encrypted.db` only.
7. Kill and relaunch twice. Expected: no migration error; data persists (proves the stored key reopens the file).

---

### Task 5: Lazy connection handle + `initDatabase()` in `src/db/client.ts`

**Files:**
- Modify: `src/db/client.ts` (whole file)
- Modify: `src/db/client.test.ts`

**Interfaces:**
- Consumes: Task 4 `openEncryptedDatabase(): Promise<DB>`.
- Produces (named exports, existing consumers unchanged):
  ```ts
  export const rawDatabase: DB;            // lazy proxy — forwards to the live connection; throws 'Database is not initialized' before initDatabase() resolves
  export const initDatabase: () => Promise<void>;  // opens (+ migrates) the encrypted DB, enables foreign_keys; memoized in-flight, retryable after failure
  export const wrapClientForDrizzle: (client: DB) => DB & { executeRawAsync(query: string, params?: Scalar[]): Promise<Scalar[][]> };
  export const database: OPSQLiteDatabase<typeof schema>;  // built at module load over the lazy proxy; query builders work before init, execution needs init
  export const write: <T>(work: (db: typeof database) => Promise<T>) => Promise<T>;  // unchanged
  ```

Design note: repository tests build queries with the real `database` and never execute them, and `run-migrations` / `use-live-query` / `write` call `rawDatabase.<method>` at call time. A `Proxy` keeps every one of those call sites and test mocks unchanged; the only new runtime requirement is that `initDatabase()` resolves before the first execution, which `MigrationsGate` guarantees (Task 6). drizzle's op-sqlite session calls exactly `client.execute`, `client.executeAsync`, and `client.executeRawAsync` (verified in `node_modules/drizzle-orm/op-sqlite/session.js`), all of which resolve through the proxy.

- [ ] **Step 1: Write the failing tests**

Replace `src/db/client.test.ts` with:

```ts
import type { DB } from '@op-engineering/op-sqlite';

// client.ts imports the op-sqlite binding; stub the module so the import
// never touches native code (the connection is opened lazily now, so no
// `open` stub is needed — only the module must resolve).
jest.mock('@op-engineering/op-sqlite', () => ({}));

const mockExecute = jest.fn(async () => ({ rows: [], rowsAffected: 0 }));
const mockOpened = { execute: mockExecute, executeRaw: jest.fn() };
const mockOpenEncryptedDatabase = jest.fn(async () => mockOpened);
jest.mock('./encrypted-database', () => ({
  openEncryptedDatabase: () => mockOpenEncryptedDatabase(),
}));

import { wrapClientForDrizzle } from './client';

// `initDatabase` memoizes its run in module state, so the init tests load a
// fresh module instance each time (same pattern as run-migrations.test.ts).
const loadClient = (): typeof import('./client') => require('./client') as typeof import('./client');

describe('wrapClientForDrizzle', () => {
  it('unwraps executeRaw().rawRows for drizzle reads (executeRawAsync)', async () => {
    const rawRows = [
      ['a1', 100],
      ['a2', 250],
    ];
    const executeRaw = jest.fn(async () => ({
      rawRows,
      columnNames: ['id', 'balance'],
      rowsAffected: 0,
    }));
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);
    const rows = await wrapped.executeRawAsync('SELECT id, balance FROM accounts WHERE k = ?', [
      'x',
    ]);

    expect(rows).toBe(rawRows);
    expect(Array.isArray(rows)).toBe(true);
    expect(executeRaw).toHaveBeenCalledWith('SELECT id, balance FROM accounts WHERE k = ?', ['x']);
  });

  it('leaves the write-path method (executeAsync) delegating unchanged', () => {
    const executeAsync = jest.fn();
    const executeRaw = jest.fn();
    const client = { executeAsync, executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect((wrapped as unknown as { executeAsync: unknown }).executeAsync).toBe(executeAsync);
  });

  it('overrides only executeRawAsync, not the underlying executeRaw reference', () => {
    const executeRaw = jest.fn();
    const client = { executeRaw } as unknown as DB;

    const wrapped = wrapClientForDrizzle(client);

    expect(wrapped.executeRawAsync).not.toBe(executeRaw);
    expect((wrapped as unknown as { executeRaw: unknown }).executeRaw).toBe(executeRaw);
  });
});

describe('initDatabase / rawDatabase', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('throws a clear error when the connection is used before initDatabase()', () => {
    const { rawDatabase } = loadClient();

    expect(() => rawDatabase.execute('SELECT 1')).toThrow('Database is not initialized');
  });

  it('opens the encrypted database and enables foreign keys on it', async () => {
    const { initDatabase } = loadClient();

    await initDatabase();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith('PRAGMA foreign_keys = ON');
  });

  it('forwards rawDatabase calls to the live connection after init', async () => {
    const { initDatabase, rawDatabase } = loadClient();

    await initDatabase();
    await rawDatabase.execute('SELECT 1');

    expect(mockExecute).toHaveBeenLastCalledWith('SELECT 1');
  });

  it('lets drizzle query builders be constructed before init (no execution)', () => {
    const { database } = loadClient();
    const { settings } = require('./schema') as typeof import('./schema');

    expect(database.select().from(settings).toSQL().sql).toContain('settings');
    expect(mockOpenEncryptedDatabase).not.toHaveBeenCalled();
  });

  it('shares one open across concurrent callers and memoizes a completed init', async () => {
    const { initDatabase } = loadClient();

    await Promise.all([initDatabase(), initDatabase()]);
    await initDatabase();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed init instead of replaying the rejection', async () => {
    const { initDatabase } = loadClient();
    mockOpenEncryptedDatabase.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(initDatabase()).rejects.toThrow('keychain unavailable');
    await expect(initDatabase()).resolves.toBeUndefined();

    expect(mockOpenEncryptedDatabase).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/db/client.test.ts`
Expected: FAIL — `initDatabase` is not exported; the module-load `open(...)` call also throws because the op-sqlite stub has no `open`.

- [ ] **Step 3: Implement**

Replace `src/db/client.ts` with:

```ts
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import { drizzle } from 'drizzle-orm/op-sqlite';

import * as schema from './schema';
import { openEncryptedDatabase } from './encrypted-database';

let connection: DB | undefined;

const requireConnection = (): DB => {
  if (connection === undefined) {
    throw new Error(
      'Database is not initialized: await initDatabase() (MigrationsGate does this) before any query.',
    );
  }

  return connection;
};

/**
 * The raw op-sqlite connection handle, exposed as a lazy proxy. Reactive
 * consumers (`useLiveQuery`) call `rawDatabase.reactiveExecute`, the migrator
 * calls `rawDatabase.execute`/`transaction`, `write` calls `transaction`.
 *
 * WHY A PROXY: the SQLCipher key lives in the Keychain, whose API is async, so
 * the connection can no longer be opened at module load. Every property access
 * on this handle forwards to the live connection once `initDatabase()` has
 * opened it, which keeps every existing `rawDatabase.<method>(...)` call site
 * (and every test mock of this module) unchanged. Before init it throws a
 * clear error instead of an opaque `undefined is not a function`.
 */
export const rawDatabase: DB = new Proxy({} as DB, {
  get: (_target, property) => {
    const live = requireConnection();
    const value = live[property as keyof DB];

    // Methods are bound to the live handle (op-sqlite's methods need their own
    // `this`). The cast collapses the union of every DB method signature, which
    // TypeScript cannot `.bind` as a union.
    return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(live) : value;
  },
});

const openAndConfigure = async (): Promise<void> => {
  const opened = await openEncryptedDatabase();
  // SQLite defaults foreign_keys OFF per connection and op-sqlite's open() does
  // not change it. Enable enforcement once, on the raw connection, before any
  // transaction/write runs. The pragma is per-connection and a no-op inside a
  // transaction, so it must run here rather than inside `write`.
  await opened.execute('PRAGMA foreign_keys = ON');
  connection = opened;
};

// A concurrent or repeat invocation (a gate remount) must not open two
// connections or run the plaintext export twice, so every caller shares this
// one in-flight run. A failed run clears the memo so the next call retries.
let initialization: Promise<void> | undefined;

/**
 * Opens the encrypted database (running the one-time plaintext export on the
 * first launch after encryption shipped) and enables foreign-key enforcement.
 * Must resolve before the first query; `MigrationsGate` awaits it before
 * `runMigrations()`. Idempotent.
 */
export const initDatabase = (): Promise<void> => {
  initialization ??= openAndConfigure().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });

  return initialization;
};

/**
 * The op-sqlite connection shape drizzle's op-sqlite session actually calls.
 *
 * drizzle's fielded read path (`values()` -> `all()`/`get()`) invokes
 * `client.executeRawAsync(sql, params)` and expects a bare positional row
 * matrix `Scalar[][]`, which it maps directly. op-sqlite 18.1.4's runtime
 * `executeRawAsync`, however, resolves to its `RawQueryResult` OBJECT
 * (`{ rawRows, columnNames, rowsAffected, insertId? }`) — the method is not
 * even declared on the exported `DB` type. The mismatch makes every read
 * throw `TypeError: rows.map is not a function`, which `useLiveQuery`
 * swallows into empty data, so the whole UI renders blank.
 */
type DrizzleOPSQLiteClient = DB & {
  executeRawAsync(query: string, params?: Scalar[]): Promise<Scalar[][]>;
};

/**
 * Forwards every method to the given op-sqlite handle but overrides
 * `executeRawAsync` to return the unwrapped `Scalar[][]` drizzle's reads
 * expect. A proxy (not a spread copy) so that it composes with the lazy
 * `rawDatabase` handle above, which has no own properties to copy. Writes are
 * untouched: drizzle mutations and the transaction begin/commit/rollback all
 * route through `run()` -> `executeAsync`, whose `QueryResult` return shape
 * this wrapper preserves verbatim.
 */
export const wrapClientForDrizzle = (client: DB): DrizzleOPSQLiteClient =>
  new Proxy(client as DrizzleOPSQLiteClient, {
    get: (target, property, receiver) =>
      property === 'executeRawAsync'
        ? async (query: string, params?: Scalar[]) => (await target.executeRaw(query, params)).rawRows
        : Reflect.get(target, property, receiver),
  });

/**
 * The Drizzle ORM instance layered over the same op-sqlite connection.
 * Reads (query builders passed to `useLiveQuery`) use this directly;
 * writes must go through `write` so they run inside a transaction. Building
 * a query (`.toSQL()`) needs no connection; executing one needs `initDatabase`.
 */
export const database = drizzle(wrapClientForDrizzle(rawDatabase), { schema });

/**
 * The one sanctioned write path for the app.
 *
 * REACTIVE RULE: op-sqlite fires a reactive query's callback only when the
 * mutation that changed the table ran inside `rawDatabase.transaction(...)`.
 * A write issued outside a transaction is invisible to every live query
 * watching that table, so the UI silently goes stale. Therefore `write`
 * wraps the Drizzle operations in the *raw* op-sqlite transaction (not
 * Drizzle's own `database.transaction`, which does not drive op-sqlite's
 * reactive flush). Because `database` is built over `rawDatabase`, the
 * Drizzle statements run on the same connection inside the native
 * transaction, and reactive queries fire on commit. Errors auto-rollback.
 *
 * The callback receives the global `database` instance (not a
 * transaction-scoped Drizzle handle) — its statements run on `rawDatabase`,
 * which is already inside the open native transaction.
 *
 * Every insert/update/delete in the app — even a single statement — must
 * go through here.
 */
export const write = async <T>(work: (db: typeof database) => Promise<T>): Promise<T> => {
  let result!: T;
  await rawDatabase.transaction(async () => {
    result = await work(database);
  });
  // Idempotent: flushes only the pending reactive queue. If the transaction
  // commit already flushed, this is a harmless no-op. Guarantees live queries
  // refresh after every write, removing the runtime uncertainty about whether
  // the commit alone drives the reactive flush.
  await rawDatabase.flushPendingReactiveQueries();
  return result;
};
```

- [ ] **Step 4: Run the client tests, then the whole suite**

Run: `npx jest src/db/client.test.ts`
Expected: PASS (9 tests).

Run: `npx jest`
Expected: PASS. Every repository / screen / navigator test keeps its existing `jest.mock('@op-engineering/op-sqlite', () => ({ open: … }))` stub; none of them execute a query, so the lazy handle is never dereferenced. `client.ts` now transitively imports `react-native-keychain` (via `encrypted-database` → `keys/db-key`); its CommonJS entry only destructures `NativeModules.RNKeychainManager` at load (verified in `node_modules/react-native-keychain/lib/commonjs/index.js` and `enums.js`), so the import is safe under Jest and no global stub is expected to be needed. Only if a suite nevertheless fails at import with a keychain native-module error, add this global stub to `jest/setup.js` (per-file `jest.mock('react-native-keychain', …)` calls in `token.test.ts` and `db-key.test.ts` still take precedence):

```js
// react-native-keychain is a native module with no Jest binary. client.ts now
// reaches it transitively (encrypted-database -> keys/db-key), so every test
// that imports a repository loads it. Stub the surface the app calls; tests
// that exercise Keychain behavior register their own stateful mock.
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly' },
  setGenericPassword: jest.fn(async () => true),
  getGenericPassword: jest.fn(async () => false),
  resetGenericPassword: jest.fn(async () => true),
}));
```

- [ ] **Step 5: Commit**

Run: `npm run check:all`
Expected: silent success.

```bash
git add src/db/client.ts src/db/client.test.ts jest/setup.js
git commit -m "feat(db): lazy connection handle + async initDatabase over the encrypted open"
```

(Omit `jest/setup.js` from the `git add` if Step 4 did not need it.)

---

### Task 6: `MigrationsGate` initializes the database before running migrations

**Files:**
- Modify: `src/db/migrations.gate.tsx:1-30`
- Create: `src/db/migrations.gate.test.tsx`

**Interfaces:**
- Consumes: Task 5 `initDatabase(): Promise<void>`; existing `runMigrations(): Promise<void>`.
- Produces: `MigrationsGate` (default export, unchanged props `{ children: ReactNode }`) renders children only after `initDatabase()` **then** `runMigrations()` both resolve; shows `Migration error: <message>` if either rejects.

- [ ] **Step 1: Write the failing test**

Create `src/db/migrations.gate.test.tsx`:

```tsx
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import MigrationsGate from './migrations.gate';

const mockInitDatabase = jest.fn<Promise<void>, []>();
const mockRunMigrations = jest.fn<Promise<void>, []>();
jest.mock('./client', () => ({ initDatabase: () => mockInitDatabase() }));
jest.mock('./run-migrations', () => ({ runMigrations: () => mockRunMigrations() }));

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

describe('MigrationsGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitDatabase.mockResolvedValue(undefined);
    mockRunMigrations.mockResolvedValue(undefined);
  });

  it('shows the preparing state, then the children once init and migrations both resolve', async () => {
    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('ready')).toBeTruthy();
    expect(queryByText('Preparing database...')).toBeNull();
  });

  it('runs the schema migrations only after the database is initialized', async () => {
    const init = deferred<void>();
    mockInitDatabase.mockReturnValue(init.promise);

    const { findByText, getByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(getByText('Preparing database...')).toBeTruthy();
    expect(mockRunMigrations).not.toHaveBeenCalled();

    await act(async () => {
      init.resolve();
      await init.promise;
    });

    expect(mockRunMigrations).toHaveBeenCalledTimes(1);
    expect(await findByText('ready')).toBeTruthy();
  });

  it('surfaces an initialization failure instead of rendering children', async () => {
    mockInitDatabase.mockRejectedValue(new Error('keychain unavailable'));

    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('Migration error: keychain unavailable')).toBeTruthy();
    expect(queryByText('ready')).toBeNull();
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  it('surfaces a migration failure instead of rendering children', async () => {
    mockRunMigrations.mockRejectedValue(new Error('Missing migration: m0007'));

    const { findByText, queryByText } = await render(
      <MigrationsGate>
        <Text>ready</Text>
      </MigrationsGate>,
    );

    expect(await findByText('Migration error: Missing migration: m0007')).toBeTruthy();
    expect(queryByText('ready')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/db/migrations.gate.test.tsx`
Expected: FAIL — "runs the schema migrations only after the database is initialized" fails because `runMigrations` is called immediately (init is never awaited), and the init-failure test renders `ready`.

- [ ] **Step 3: Implement**

In `src/db/migrations.gate.tsx`, change the imports and the effect body:

```tsx
import { type FC, type ReactNode, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { initDatabase } from './client';
import { runMigrations } from './run-migrations';
```

```tsx
  useEffect(() => {
    let cancelled = false;

    // The encrypted connection (and, on the first launch after encryption
    // shipped, the plaintext -> encrypted export) must exist before the schema
    // migrator can run against it.
    initDatabase()
      .then(runMigrations)
      .then(() => {
        if (!cancelled) {
          setState({ status: 'success' });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setState({ status: 'error', error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/db/migrations.gate.test.tsx __tests__/App.test.tsx`
Expected: PASS (`App.test.tsx` mocks `MigrationsGate` as a passthrough and is unaffected).

- [ ] **Step 5: Commit**

Run: `npm run check:all`
Expected: silent success.

```bash
git add src/db/migrations.gate.tsx src/db/migrations.gate.test.tsx
git commit -m "feat(db): MigrationsGate awaits initDatabase before running migrations"
```

Now perform Task 4 Step 7 (manual upgrade + fresh-install verification) — the app is fully wired for encryption at this point. Build with `npm run ios` (or via the ops agent).

---

### Task 7: AppDelegate — app-switcher privacy overlay and backup exclusion (manual verification)

Not unit-testable; verified on the simulator/device.

**Files:**
- Modify: `ios/Kiko/AppDelegate.swift:13-34`

**Interfaces:**
- Consumes: file names `kiko-encrypted.db` / `pff.db` (Task 4 constants; mirrored as Swift literals).
- Produces: a black overlay over the key window whenever the app is not active (redacting the app-switcher snapshot); `NSURLIsExcludedFromBackupKey` set on every DB file present in `Library/`.

Why native, per the spec's "check op-sqlite's own API first": op-sqlite 18.1.4 exposes no backup-exclusion or file-attribute API (verified against `lib/typescript/src/functions.d.ts` and `types.d.ts` — only `getDbPath`, `delete`, `moveAssetsDatabase`). Setting the attribute in the AppDelegate, which this task already edits for the overlay, avoids a new dependency or a hand-rolled native module for one flag.

- [ ] **Step 1: Add the lifecycle hooks and helpers**

In `ios/Kiko/AppDelegate.swift`, inside `class AppDelegate`, add after the `application(_:didFinishLaunchingWithOptions:)` method (before the closing brace of the class):

```swift
  // MARK: - Privacy: app-switcher snapshot redaction

  // Tag used to find and remove the overlay; arbitrary non-zero value.
  private let privacyOverlayTag = 0x5046_4600

  func applicationWillResignActive(_ application: UIApplication) {
    showPrivacyOverlay()
  }

  func applicationDidEnterBackground(_ application: UIApplication) {
    showPrivacyOverlay()
    excludeDatabaseFilesFromBackup()
  }

  func applicationDidBecomeActive(_ application: UIApplication) {
    hidePrivacyOverlay()
  }

  /// A native cover, not a JS one: the app-switcher snapshot is taken as soon
  /// as the app resigns active, before a React render could paint, so only a
  /// view added synchronously here is guaranteed to be in the snapshot. Solid
  /// black matches the app's true-black theme background.
  private func showPrivacyOverlay() {
    guard let window, window.viewWithTag(privacyOverlayTag) == nil else { return }
    let overlay = UIView(frame: window.bounds)
    overlay.tag = privacyOverlayTag
    overlay.backgroundColor = .black
    overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    window.addSubview(overlay)
  }

  private func hidePrivacyOverlay() {
    window?.viewWithTag(privacyOverlayTag)?.removeFromSuperview()
  }

  // MARK: - Privacy: keep the database out of iCloud / iTunes backups

  /// op-sqlite stores its files in the app's Library directory (OPSQLite.mm:
  /// NSLibraryDirectory), which iOS backs up by default. Mark the encrypted
  /// database and its SQLite sidecar files as excluded. Runs at launch and on
  /// every background transition because JS creates the files lazily after
  /// launch; the attribute persists once set. File names mirror
  /// `src/db/encrypted-database.ts` (ENCRYPTED_DATABASE_NAME / PLAINTEXT_DATABASE_NAME).
  private func excludeDatabaseFilesFromBackup() {
    let fileManager = FileManager.default
    guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
    let baseNames = ["kiko-encrypted.db", "pff.db"]
    let suffixes = ["", "-wal", "-shm", "-journal"]
    for baseName in baseNames {
      for suffix in suffixes {
        var url = library.appendingPathComponent(baseName + suffix)
        guard fileManager.fileExists(atPath: url.path) else { continue }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
      }
    }
  }
```

Also add one line at the end of `application(_:didFinishLaunchingWithOptions:)`, immediately before `return true`:

```swift
    excludeDatabaseFilesFromBackup()
```

- [ ] **Step 2: Build**

Run: `npm run ios` (or `xcodebuild -workspace ios/Kiko.xcworkspace -scheme Kiko -sdk iphonesimulator -configuration Debug build`)
Expected: compiles with no Swift errors or warnings in `AppDelegate.swift`.

- [ ] **Step 3: MANUAL VERIFICATION — snapshot redaction**

1. Launch the app on the simulator, navigate to Home with visible balances.
2. Open the app switcher (Simulator: Device → App Switcher, or swipe up and hold).
3. Expected: the Kiko card is solid black — no balances, no account names visible.
4. Tap the card to return. Expected: the overlay is gone immediately and the UI is interactive.
5. Pull down Control Center over the app and dismiss it. Expected: the app reappears with no lingering black cover.

- [ ] **Step 4: MANUAL VERIFICATION — backup exclusion**

Run (after the app has been backgrounded at least once):

```bash
CONTAINER=$(xcrun simctl get_app_container booted com.dmytro.pff data)
ls -la "$CONTAINER/Library/" | grep kiko
xattr -l "$CONTAINER/Library/kiko-encrypted.db"
```

Expected: the `xattr` output lists a backup-exclusion attribute — `com.apple.MobileBackup` (iOS naming) or `com.apple.metadata:com_apple_backup_excludeItem` (macOS naming the simulator may use). If `-wal` / `-shm` files exist, `xattr -l` on them shows the same attribute.

- [ ] **Step 5: Commit**

```bash
git add ios/Kiko/AppDelegate.swift
git commit -m "build(native): privacy overlay on resign-active and backup exclusion for the database"
```

---

### Task 8: ATS certificate pinning for `api.monobank.ua` + security runbook

Not unit-testable; the plist is lint-checked and the pins are verified on device (positive and negative).

**Files:**
- Modify: `ios/Kiko/Info.plist:29-35` (`NSAppTransportSecurity` dict)
- Create: `docs/security/README.md`

**Interfaces:**
- Consumes: nothing from code.
- Produces: `NSPinnedDomains` → `api.monobank.ua` with two `NSPinnedCAIdentities` SPKI-SHA256 pins; the runbook.

Pin selection (verified 2026-09-04 with `openssl s_client -connect api.monobank.ua:443 -servername api.monobank.ua -showcerts`): the served chain is `CN=monobank.ua` (leaf, expires 2027-03-10) ← `Amazon RSA 2048 M01` (intermediate, expires 2030-08-23) ← `Amazon Root CA 1` (root, expires 2037-12-31). Amazon ACM issues renewals from any of its RSA intermediates `M01`–`M04`, so pinning **the root** (`Amazon Root CA 1`) is the primary pin that survives leaf and intermediate renewals; the current intermediate is the backup pin. CA pins (not leaf pins) so a routine leaf renewal never breaks the app. Recompute both before committing — the values below must match what the commands print.

- [ ] **Step 1: Recompute the pins**

```bash
cd "$(mktemp -d)"
openssl s_client -connect api.monobank.ua:443 -servername api.monobank.ua -showcerts </dev/null 2>/dev/null > chain.pem
awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
for i in 1 2 3; do
  echo "cert$i: $(openssl x509 -in cert$i.pem -noout -subject) SPKI=$(openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
done
```

Expected (as of 2026-09-04):
- `cert2` `CN=Amazon RSA 2048 M01` → `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=`
- `cert3` `CN=Amazon Root CA 1` → `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=`

If the chain has changed, use the freshly printed root and intermediate values instead and update the runbook's "current chain" table accordingly.

- [ ] **Step 2: Add the pins to `Info.plist`**

Replace the `NSAppTransportSecurity` dict (lines 29-35) with:

```xml
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsArbitraryLoads</key>
		<false/>
		<key>NSAllowsLocalNetworking</key>
		<true/>
		<!-- Certificate pinning for the token-bearing host only. CA (not leaf)
		     pins: primary = Amazon Root CA 1, backup = the current Amazon RSA
		     intermediate. Rotation runbook: docs/security/README.md. CoinGecko
		     is deliberately unpinned (public price data, no secret). -->
		<key>NSPinnedDomains</key>
		<dict>
			<key>api.monobank.ua</key>
			<dict>
				<key>NSIncludesSubdomains</key>
				<false/>
				<key>NSPinnedCAIdentities</key>
				<array>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=</string>
					</dict>
					<dict>
						<key>SPKI-SHA256-BASE64</key>
						<string>DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=</string>
					</dict>
				</array>
			</dict>
		</dict>
	</dict>
```

Run: `plutil -lint ios/Kiko/Info.plist`
Expected: `ios/Kiko/Info.plist: OK`.

Run: `npm run check:secrets`
Expected: silent success (verified with gitleaks 8.30.1 against a sample plist holding these exact values — no finding, so no `.gitleaks.toml` change is needed).

- [ ] **Step 3: Write the runbook + accepted-risk register**

Create `docs/security/README.md`:

```markdown
# Kiko security posture

Companion to `docs/superpowers/specs/2026-09-04-security-and-app-lock-design.md`.
This file is the operational record: what is pinned, how to rotate it, and
which risks are accepted rather than mitigated.

## Certificate pinning — `api.monobank.ua`

`ios/Kiko/Info.plist` → `NSAppTransportSecurity` → `NSPinnedDomains` pins the
Monobank API host (the only host that carries the personal token) with two
CA SPKI-SHA256 pins under `NSPinnedCAIdentities`. CoinGecko is not pinned:
that call carries no secret.

### Current chain (verified 2026-09-04)

| Role | Subject | Expires | SPKI-SHA256 (base64) | Pinned |
|---|---|---|---|---|
| leaf | `CN=monobank.ua` | 2027-03-10 | `9C7Ylw+j3lXV/wphskz8+ZqUy1hG4/3dsBe3alQjmCA=` | no (renews yearly) |
| intermediate | `Amazon RSA 2048 M01` | 2030-08-23 | `DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=` | yes — backup |
| root | `Amazon Root CA 1` | 2037-12-31 | `++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=` | yes — primary |

Amazon ACM issues renewals from any of `Amazon RSA 2048 M01..M04`; all chain
to `Amazon Root CA 1`, which is why the root is the primary pin.

### What breaks if the pins go stale

Every Monobank request fails closed with a TLS error (`useSync` /
`useAutoSync` surface it as a failed sync; no data leaves the device). This
is the intended failure mode. Nothing else in the app is affected.

### Rotation runbook

Owner: the repository owner (single-user app). Cadence: on every release
build, and immediately if a sync starts failing with a TLS error.

1. Recompute the chain:
   ```bash
   openssl s_client -connect api.monobank.ua:443 -servername api.monobank.ua -showcerts </dev/null 2>/dev/null > chain.pem
   awk 'BEGIN{n=0} /BEGIN CERT/{n++} {print > ("cert" n ".pem")}' chain.pem
   for i in 1 2 3; do openssl x509 -in cert$i.pem -noout -subject; openssl x509 -in cert$i.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64; done
   ```
2. If the root SPKI still equals the primary pin, nothing to do (an
   intermediate change alone is covered by the root pin; refresh the backup
   pin at the next convenient release).
3. If Monobank moved to a different CA: replace BOTH pins with the new
   root (primary) and new intermediate (backup), update the table above,
   `plutil -lint ios/Kiko/Info.plist`, rebuild, run the positive and negative
   device checks below, ship.
4. Positive check: on device, Monobank sync succeeds.
5. Negative check: temporarily corrupt one character in BOTH pins, rebuild,
   confirm sync fails with a TLS error, then revert. This proves ATS is
   actually evaluating the pins.

## Accepted risks (not mitigated by design)

- **Jailbreak / root detection: not implemented.** Single-user personal
  app; a jailbroken device is the owner's own choice. Revisit only if the
  threat model changes (multi-user, data sharing, or a distribution beyond
  the owner).
- **A Monobank token saved before the `accessible` hardening shipped keeps
  its default Keychain policy** until the user disconnects and re-saves it.
  No forced migration: the item is still in the Keychain, and re-saving is a
  one-tap action on the account screen.
- **Plaintext → encrypted database migration residuals.** The key is stored
  only after the export completes, and the plaintext file is deleted only
  after the key is stored (`src/db/encrypted-database.ts`). A crash between
  those last two steps leaves a stale plaintext file for one launch; the next
  launch deletes it. A downgrade to a pre-encryption build followed by an
  upgrade would delete any data written by the downgraded build.
- **SQLite `randomblob()` as the key source** (`src/db/keys/db-key.ts`):
  ChaCha20 seeded from the OS CSPRNG. Hermes has no WebCrypto; swapping to
  `react-native-get-random-values` (`SecRandomCopyBytes`) is a one-function
  change if the platform CSPRNG is ever preferred.
- **Raw IBAN stored in `holdings.metadata`** — encrypted at rest now, but
  the research pass flagged storing it at all as worth revisiting. Out of
  scope for this pass.
```

- [ ] **Step 4: MANUAL VERIFICATION — pins are enforced**

1. Rebuild and run on the simulator with a connected Monobank account (or the token field). Trigger Sync. Expected: sync succeeds.
2. Negative test: change the last character of **both** `SPKI-SHA256-BASE64` strings, rebuild, trigger Sync. Expected: the sync fails (TLS / `NSURLErrorServerCertificateUntrusted`, surfaced as a failed sync). Revert the two characters, rebuild, confirm sync succeeds again.

- [ ] **Step 5: Commit**

Run: `npm run check:secrets && npm run check:lint`
Expected: silent success.

```bash
git add ios/Kiko/Info.plist docs/security/README.md
git commit -m "build(native): pin api.monobank.ua CA identities; add security runbook and accepted-risk register"
```

---

### Task 9: Biometrics dependency + `src/auth/biometrics.ts` wrapper

**Files:**
- Modify: `package.json` (dependencies), `package-lock.json`
- Modify: `ios/Podfile.lock` (via `pod install`)
- Modify: `ios/Kiko/Info.plist` (add `NSFaceIDUsageDescription` after `NSAppTransportSecurity`)
- Modify: `jest/setup.js` (global mock)
- Create: `src/auth/biometrics.ts`
- Create: `src/auth/biometrics.test.ts`

**Interfaces:**
- Consumes: `@sbaiahmed1/react-native-biometrics@0.16.0` named exports `isSensorAvailable(): Promise<{ available: boolean; biometryType?: string; isDeviceSecure: boolean; error?: string; errorCode?: string }>` and `authenticateWithOptions(options: { title?; subtitle?; description?; cancelLabel?; fallbackLabel?; allowDeviceCredentials?: boolean; disableDeviceFallback?; returnAuthType? }): Promise<{ success: boolean; error?: string; errorCode?: string }>`. iOS error codes (from the package's `ReactNativeBiometricsError.swift`): `USER_CANCEL`, `USER_FALLBACK`, `SYSTEM_CANCEL`, `AUTHENTICATION_FAILED`, `BIOMETRY_NOT_AVAILABLE`, `BIOMETRY_NOT_ENROLLED`, `BIOMETRY_LOCKOUT`, `BIOMETRY_LOCKOUT_PERMANENT`, `PASSCODE_NOT_SET`, `TOUCH_ID_*`, `FACE_ID_*`.
- Produces:
  ```ts
  export type SensorStatus =
    | { kind: 'available'; biometryType: string | undefined }
    | { kind: 'passcodeOnly' }      // passcode set, no biometry enrolled — lock still works via passcode
    | { kind: 'passcodeNotSet' }
    | { kind: 'unavailable' };
  export type AuthResult =
    | { kind: 'success' }
    | { kind: 'cancelled' }
    | { kind: 'lockout' }
    | { kind: 'passcodeNotSet' }
    | { kind: 'failed'; code: string | undefined };
  export const isSensorAvailable: () => Promise<SensorStatus>;
  export const authenticate: (prompt: string) => Promise<AuthResult>;   // always allowDeviceCredentials: true
  ```

Note on `BIOMETRY_CURRENT_SET`: that is a *Keychain access-control* invalidation, and this app gates no Keychain item on biometrics (Tasks 2/3 use `accessible` only). `authenticateWithOptions` evaluates `LAPolicy.deviceOwnerAuthentication`, which has no such invalidation; a user adding/removing a face simply authenticates again. Nothing to map.

- [ ] **Step 1: Install the dependency and native pod**

Run: `npm install --save-exact @sbaiahmed1/react-native-biometrics@0.16.0`
Expected: `package.json` gains `"@sbaiahmed1/react-native-biometrics": "0.16.0"`; no `min-release-age` refusal (published 2026-08-07). `npm install` must not add `expo` (the peer is optional) — verify with `ls node_modules/expo` → `No such file or directory`.

Run: `cd ios && pod install && cd ..`
Expected: `ios/Podfile.lock` gains a `ReactNativeBiometrics` pod entry (the package's podspec `s.name`, verified in `ReactNativeBiometrics.podspec` of 0.16.0).

- [ ] **Step 2: Add the Face ID usage string**

In `ios/Kiko/Info.plist`, after the closing `</dict>` of `NSAppTransportSecurity`, add:

```xml
	<key>NSFaceIDUsageDescription</key>
	<string>Unlock Kiko with Face ID</string>
```

Run: `plutil -lint ios/Kiko/Info.plist`
Expected: `OK`.

- [ ] **Step 3: Register a global Jest mock**

Append to `jest/setup.js`:

```js
// @sbaiahmed1/react-native-biometrics is a TurboModule with no Jest binary
// (an unmocked import throws `TurboModuleRegistry.getEnforcing(...)`). The
// Settings screen and LockGate reach it, and both are reachable transitively
// from App.tsx / root.navigator tests, so it is mocked globally. Defaults
// model a Face ID device with a passcode; tests that exercise the wrapper's
// mapping override these with their own `jest.mock` factory.
jest.mock('@sbaiahmed1/react-native-biometrics', () => ({
  isSensorAvailable: jest.fn(async () => ({
    available: true,
    biometryType: 'FaceID',
    isDeviceSecure: true,
  })),
  authenticateWithOptions: jest.fn(async () => ({ success: true })),
}));
```

- [ ] **Step 4: Write the failing tests**

Create `src/auth/biometrics.test.ts`:

```ts
import {
  authenticateWithOptions,
  isSensorAvailable as nativeIsSensorAvailable,
} from '@sbaiahmed1/react-native-biometrics';
import { authenticate, isSensorAvailable } from './biometrics';

jest.mock('@sbaiahmed1/react-native-biometrics', () => ({
  isSensorAvailable: jest.fn(),
  authenticateWithOptions: jest.fn(),
}));

const mockSensor = nativeIsSensorAvailable as jest.Mock;
const mockAuthenticate = authenticateWithOptions as jest.Mock;

describe('isSensorAvailable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps an available sensor with its biometry type', async () => {
    mockSensor.mockResolvedValue({ available: true, biometryType: 'FaceID', isDeviceSecure: true });

    expect(await isSensorAvailable()).toEqual({ kind: 'available', biometryType: 'FaceID' });
  });

  it('maps a device with no passcode to passcodeNotSet', async () => {
    mockSensor.mockResolvedValue({ available: false, isDeviceSecure: false, errorCode: 'PASSCODE_NOT_SET' });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeNotSet' });
  });

  it('treats a missing isDeviceSecure flag with PASSCODE_NOT_SET as passcodeNotSet', async () => {
    mockSensor.mockResolvedValue({ available: false, errorCode: 'PASSCODE_NOT_SET' });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeNotSet' });
  });

  it('maps a secured device with no enrolled biometry to passcodeOnly', async () => {
    mockSensor.mockResolvedValue({ available: false, isDeviceSecure: true, errorCode: 'BIOMETRY_NOT_ENROLLED' });

    expect(await isSensorAvailable()).toEqual({ kind: 'passcodeOnly' });
  });

  it('maps missing biometric hardware to unavailable', async () => {
    mockSensor.mockResolvedValue({ available: false, isDeviceSecure: true, errorCode: 'BIOMETRY_NOT_AVAILABLE' });

    expect(await isSensorAvailable()).toEqual({ kind: 'unavailable' });
  });
});

describe('authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('always allows the device passcode as a fallback and titles the sheet with the prompt', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });

    await authenticate('Unlock Kiko');

    expect(mockAuthenticate).toHaveBeenCalledWith({
      title: 'Unlock Kiko',
      allowDeviceCredentials: true,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
    });
  });

  it('maps success', async () => {
    mockAuthenticate.mockResolvedValue({ success: true });
    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'success' });
  });

  it.each(['USER_CANCEL', 'SYSTEM_CANCEL', 'USER_FALLBACK'])('maps %s to cancelled', async (errorCode) => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode });
    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'cancelled' });
  });

  it.each(['BIOMETRY_LOCKOUT', 'BIOMETRY_LOCKOUT_PERMANENT', 'FACE_ID_LOCKOUT', 'TOUCH_ID_LOCKOUT'])(
    'maps %s to lockout',
    async (errorCode) => {
      mockAuthenticate.mockResolvedValue({ success: false, errorCode });
      expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'lockout' });
    },
  );

  it('maps PASSCODE_NOT_SET', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode: 'PASSCODE_NOT_SET' });
    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'passcodeNotSet' });
  });

  it('maps any other failure to failed with its code', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, errorCode: 'AUTHENTICATION_FAILED' });
    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'failed', code: 'AUTHENTICATION_FAILED' });
  });

  it('maps a failure without a code to failed with undefined', async () => {
    mockAuthenticate.mockResolvedValue({ success: false });
    expect(await authenticate('Unlock Kiko')).toEqual({ kind: 'failed', code: undefined });
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx jest src/auth/biometrics.test.ts`
Expected: FAIL — `Cannot find module './biometrics'`.

- [ ] **Step 6: Implement**

Create `src/auth/biometrics.ts`:

```ts
import {
  authenticateWithOptions,
  isSensorAvailable as readSensorInfo,
} from '@sbaiahmed1/react-native-biometrics';

export type SensorStatus =
  | { kind: 'available'; biometryType: string | undefined }
  // A passcode is set but no biometry is enrolled: the lock still works,
  // through the passcode sheet (`allowDeviceCredentials`).
  | { kind: 'passcodeOnly' }
  | { kind: 'passcodeNotSet' }
  | { kind: 'unavailable' };

export type AuthResult =
  | { kind: 'success' }
  | { kind: 'cancelled' }
  | { kind: 'lockout' }
  | { kind: 'passcodeNotSet' }
  | { kind: 'failed'; code: string | undefined };

// iOS LAError codes as surfaced by @sbaiahmed1/react-native-biometrics
// (ios/ReactNativeBiometricsError.swift), grouped by how the gate reacts.
const CANCEL_CODES = ['USER_CANCEL', 'SYSTEM_CANCEL', 'USER_FALLBACK'] as const;
const LOCKOUT_CODES = [
  'BIOMETRY_LOCKOUT',
  'BIOMETRY_LOCKOUT_PERMANENT',
  'FACE_ID_LOCKOUT',
  'TOUCH_ID_LOCKOUT',
] as const;
const NOT_ENROLLED_CODES = [
  'BIOMETRY_NOT_ENROLLED',
  'FACE_ID_NOT_ENROLLED',
  'TOUCH_ID_NOT_ENROLLED',
] as const;
const PASSCODE_NOT_SET_CODE = 'PASSCODE_NOT_SET';

const hasCode = (codes: readonly string[], code: string | undefined): boolean =>
  code !== undefined && codes.includes(code);

export const isSensorAvailable = async (): Promise<SensorStatus> => {
  const info = await readSensorInfo();

  if (info.available) {
    return { kind: 'available', biometryType: info.biometryType };
  }

  if (info.isDeviceSecure === false || info.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  if (hasCode(NOT_ENROLLED_CODES, info.errorCode)) {
    return { kind: 'passcodeOnly' };
  }

  return { kind: 'unavailable' };
};

/**
 * One system authentication sheet: biometrics first, device passcode as the
 * fallback (`allowDeviceCredentials`), so a biometry lockout or an unenrolled
 * device degrades to the passcode instead of a dead end.
 */
export const authenticate = async (prompt: string): Promise<AuthResult> => {
  const result = await authenticateWithOptions({
    title: prompt,
    allowDeviceCredentials: true,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use Passcode',
  });

  if (result.success) {
    return { kind: 'success' };
  }

  if (hasCode(CANCEL_CODES, result.errorCode)) {
    return { kind: 'cancelled' };
  }

  if (hasCode(LOCKOUT_CODES, result.errorCode)) {
    return { kind: 'lockout' };
  }

  if (result.errorCode === PASSCODE_NOT_SET_CODE) {
    return { kind: 'passcodeNotSet' };
  }

  return { kind: 'failed', code: result.errorCode };
};
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/auth/biometrics.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 8: Verify the harness sees the dependency, then commit**

Run: `npm run check:all`
Expected: silent success — `knip` and `depcheck` both see the import in `src/auth/biometrics.ts`, so no `knip.json` / `.depcheckrc.json` entry is added. If either tool reports the package, stop and diagnose (a resolver issue), do not add an ignore.

```bash
git add package.json package-lock.json ios/Podfile.lock ios/Kiko/Info.plist jest/setup.js src/auth/biometrics.ts src/auth/biometrics.test.ts
git commit -m "feat(auth): add react-native-biometrics and a typed authenticate/sensor wrapper"
```

---

### Task 10: `useLiveQuery` reports `isLoading`

**Files:**
- Modify: `src/db/use-live-query.ts:25-102`
- Modify: `src/db/use-live-query.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useLiveQuery<T>(query, tables): { data: T[]; error?: Error; isLoading: boolean }` — `isLoading` is `true` until the first `runQuery` settles (success or error), then `false` for the hook's lifetime. Existing callers destructure `{ data }` and are unaffected.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('useLiveQuery', …)` block of `src/db/use-live-query.test.ts`:

```ts
  it('reports isLoading until the first query settles', async () => {
    let resolveRows!: (rows: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => {
      resolveRows = resolve;
    });
    const slowQuery = {
      toSQL: fakeQuery.toSQL,
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above — the hook awaits the query builder itself.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return pending.then(onfulfilled, onrejected);
      },
    };

    // RNTL 14's renderHook resolves once the initial render committed; the
    // query itself is still pending, so isLoading must still be true here.
    const { result } = await renderHook(() => useLiveQuery(slowQuery, ['accounts']));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);

    await act(async () => {
      resolveRows([{ id: 'a' }]);
      await pending;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('clears isLoading when the first query fails', async () => {
    const failingQuery = {
      toSQL: fakeQuery.toSQL,
      // biome-ignore lint/suspicious/noThenProperty: OVERRIDE(intentional thenable double) same rationale as `fakeQuery` above.
      then<TResult1 = unknown[], TResult2 = never>(
        onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.reject(new Error('boom')).then(onfulfilled, onrejected);
      },
    };

    const { result } = await renderHook(() => useLiveQuery(failingQuery, ['accounts']));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('boom');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/db/use-live-query.test.ts`
Expected: FAIL — `expect(received).toBe(true)` with `received: undefined` (`isLoading` is not returned).

- [ ] **Step 3: Implement**

In `src/db/use-live-query.ts`:

Change the signature's return type:

```ts
): { data: T[]; error?: Error; isLoading: boolean } {
```

Add the state after `const [error, setError] = …`:

```ts
  const [isLoading, setIsLoading] = useState(true);
```

In `runQuery`, after the `if (!alive || myGeneration !== generation.current) { return; }` guard and before `const settled = …`, add:

```ts
      setIsLoading(false);
```

Change the final return:

```ts
  return { data, error, isLoading };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/db/use-live-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `npm run check:all`
Expected: silent success.

```bash
git add src/db/use-live-query.ts src/db/use-live-query.test.ts
git commit -m "feat(db): useLiveQuery exposes isLoading for the first settle"
```

---

### Task 11: Lock settings — schema columns, Drizzle migration, repository setters, grace options

**Files:**
- Create: `src/auth/lock-grace.ts`
- Create: `src/auth/lock-grace.test.ts`
- Modify: `src/db/schema.ts:104-110`
- Generate: `drizzle/migrations/0007_add_lock_settings.sql`, `drizzle/migrations/meta/0007_snapshot.json`, `drizzle/migrations/meta/_journal.json`, `drizzle/migrations/migrations.js`
- Modify: `src/repositories/settings.repo.ts`
- Modify: `src/repositories/settings.repo.test.ts`

**Interfaces:**
- Consumes: `write`, `database` from `src/db/client.ts`; `captureSetTx` from `src/repositories/capture-set-tx.ts`.
- Produces:
  ```ts
  // src/auth/lock-grace.ts
  export const LOCK_GRACE_OPTIONS = [0, 30, 60, 300] as const;
  export type LockGraceSeconds = (typeof LOCK_GRACE_OPTIONS)[number];
  export const DEFAULT_LOCK_GRACE_SECONDS: LockGraceSeconds; // 30
  export const lockGraceLabel: (seconds: LockGraceSeconds) => string; // 'Immediately' | '30 sec' | '1 min' | '5 min'
  // src/db/schema.ts — settings gains:
  //   lockEnabled: boolean (column lock_enabled integer mode boolean, NOT NULL DEFAULT false)
  //   lockGraceSeconds: number (column lock_grace_seconds integer, NOT NULL DEFAULT 30)
  // src/repositories/settings.repo.ts
  settingsRepo.setLockEnabled: (enabled: boolean) => Promise<unknown>;
  settingsRepo.setLockGraceSeconds: (seconds: LockGraceSeconds) => Promise<unknown>;
  ```

- [ ] **Step 1: Write the failing grace-options test**

Create `src/auth/lock-grace.test.ts`:

```ts
import { DEFAULT_LOCK_GRACE_SECONDS, LOCK_GRACE_OPTIONS, lockGraceLabel } from './lock-grace';

describe('lock grace options', () => {
  it('offers exactly the spec’s four grace periods, in ascending order', () => {
    expect(LOCK_GRACE_OPTIONS).toEqual([0, 30, 60, 300]);
  });

  it('defaults to 30 seconds, matching the schema default', () => {
    expect(DEFAULT_LOCK_GRACE_SECONDS).toBe(30);
  });

  it('labels every option', () => {
    expect(LOCK_GRACE_OPTIONS.map(lockGraceLabel)).toEqual(['Immediately', '30 sec', '1 min', '5 min']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/auth/lock-grace.test.ts`
Expected: FAIL — `Cannot find module './lock-grace'`.

- [ ] **Step 3: Implement the grace module**

Create `src/auth/lock-grace.ts`:

```ts
import { match } from 'ts-pattern';

/** Seconds the app may stay in the background before it re-locks; 0 = always re-lock. */
export const LOCK_GRACE_OPTIONS = [0, 30, 60, 300] as const;

export type LockGraceSeconds = (typeof LOCK_GRACE_OPTIONS)[number];

/** Mirrors the `settings.lock_grace_seconds` column default. */
export const DEFAULT_LOCK_GRACE_SECONDS: LockGraceSeconds = 30;

export const lockGraceLabel = (seconds: LockGraceSeconds): string =>
  match(seconds)
    .with(0, () => 'Immediately')
    .with(30, () => '30 sec')
    .with(60, () => '1 min')
    .with(300, () => '5 min')
    .exhaustive();
```

Run: `npx jest src/auth/lock-grace.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing repository tests**

Replace `src/repositories/settings.repo.test.ts` with:

```ts
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

// Route `write` to a capture handle so the update payload can be asserted
// without a native database (same pattern as accounts.repo.test.ts).
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { captureSetTx } from './capture-set-tx';
import { settingsRepo } from './settings.repo';

describe('settingsRepo', () => {
  it('builds a single-row settings query', () => {
    expect(settingsRepo.getQuery().toSQL().sql).toContain('settings');
  });

  it('setBaseCurrency updates the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setBaseCurrency('USD');

    expect(captured.set).toEqual({ baseCurrency: 'USD' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLockEnabled updates the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setLockEnabled(true);

    expect(captured.set).toEqual({ lockEnabled: true });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLockGraceSeconds updates the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setLockGraceSeconds(300);

    expect(captured.set).toEqual({ lockGraceSeconds: 300 });
    expect(captured.whereCalled).toBe(true);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx jest src/repositories/settings.repo.test.ts`
Expected: FAIL — `settingsRepo.setLockEnabled is not a function`.

- [ ] **Step 6: Add the schema columns**

In `src/db/schema.ts`, replace the `settings` table:

```ts
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),
  baseCurrency: text('base_currency', { enum: ['BTC', 'USD', 'EUR', 'UAH'] })
    .notNull()
    .default('UAH'),
  lastSyncAt: integer('last_sync_at'),
  // App lock (Face ID / passcode gate). Off by default; the grace period is
  // how long the app may sit in the background before it re-locks (0 = always).
  lockEnabled: integer('lock_enabled', { mode: 'boolean' }).notNull().default(false),
  lockGraceSeconds: integer('lock_grace_seconds').notNull().default(30),
});
```

- [ ] **Step 7: Generate the migration**

Run: `npx drizzle-kit generate --name add_lock_settings`
Expected: creates `drizzle/migrations/0007_add_lock_settings.sql` and `drizzle/migrations/meta/0007_snapshot.json`, appends an `idx: 7` entry to `meta/_journal.json`, and regenerates `migrations.js` with an `m0007` import + entry.

Verify the SQL contains exactly two statements (open the file):

```sql
ALTER TABLE `settings` ADD `lock_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `lock_grace_seconds` integer DEFAULT 30 NOT NULL;
```

If drizzle-kit emits anything else (it diffs against `meta/0005_snapshot.json`, since the hand-written `0006` had no schema change), stop and reconcile — do not commit a migration that touches other tables.

Run: `npx jest src/db/run-migrations.test.ts`
Expected: PASS (the runner is bundle-agnostic; this confirms nothing regressed).

- [ ] **Step 8: Add the repository setters**

Replace `src/repositories/settings.repo.ts` with:

```ts
import { eq } from 'drizzle-orm';
import type { LockGraceSeconds } from '../auth/lock-grace';
import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { settings } from '../db/schema';
import type { Repository } from './repository';

/** Settings is a single row, keyed at id = 1. */
const SETTINGS_ID = 1;

export const settingsRepo = {
  getQuery: () => database.select().from(settings).where(eq(settings.id, SETTINGS_ID)),
  ensure: () =>
    write((tx) => tx.insert(settings).values({ id: SETTINGS_ID }).onConflictDoNothing()),
  setBaseCurrency: (currency: Currency) =>
    write((tx) =>
      tx.update(settings).set({ baseCurrency: currency }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setLastSyncAt: (timestamp: number) =>
    write((tx) =>
      tx.update(settings).set({ lastSyncAt: timestamp }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setLockEnabled: (enabled: boolean) =>
    write((tx) =>
      tx.update(settings).set({ lockEnabled: enabled }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setLockGraceSeconds: (seconds: LockGraceSeconds) =>
    write((tx) =>
      tx.update(settings).set({ lockGraceSeconds: seconds }).where(eq(settings.id, SETTINGS_ID)),
    ),
} satisfies Repository;
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx jest src/repositories src/auth/lock-grace.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

Run: `npm run check:all`
Expected: silent success (`check:dup` ignores `*_snapshot.json` per `.jscpd.json`).

```bash
git add src/auth/lock-grace.ts src/auth/lock-grace.test.ts src/db/schema.ts drizzle/migrations src/repositories/settings.repo.ts src/repositories/settings.repo.test.ts
git commit -m "feat(db): lockEnabled/lockGraceSeconds settings + migration + repo setters"
```

---

### Task 12: `useAppLock` hook — cold-launch lock and `AppState` grace logic

**Files:**
- Create: `src/auth/use-app-lock.ts`
- Create: `src/auth/use-app-lock.test.ts`

**Interfaces:**
- Consumes: Task 9 `authenticate(prompt): Promise<AuthResult>`, `AuthResult`; Task 10 `useLiveQuery(query, tables): { data; error?; isLoading }`; Task 11 `settingsRepo.getQuery()`, `DEFAULT_LOCK_GRACE_SECONDS`; `react-native` `AppState.addEventListener('change', listener): { remove(): void }`.
- Produces:
  ```ts
  export const shouldRelock: (input: { backgroundedAt: number | undefined; now: number; graceSeconds: number }) => boolean;
  export const useAppLock: () => { isReady: boolean; isLocked: boolean; unlock: () => Promise<AuthResult> };
  export const UNLOCK_PROMPT = 'Unlock Kiko';
  ```
  (The return shape is a module-private `type AppLock`; it is not exported because no other module names it, and Knip fails on an unused exported type.)

Behavior: `isReady` is false until the settings live query has settled once. On that first settle, the cold-launch decision is `locked = lockEnabled`. `isLocked = lockEnabled && locked` (turning the setting off unlocks immediately; turning it on mid-session does not lock until the next background). `AppState`: the first `inactive`/`background` stamps `Date.now()` (a later `background` after `inactive` keeps the earlier stamp); on `active`, re-lock iff `lockEnabled && shouldRelock(...)`, then clear the stamp. Transitions while an `unlock()` is in flight are ignored — the biometric sheet itself makes the app `inactive` then `active`, which would otherwise re-lock a grace-0 user in a loop. A successful `unlock()` clears the stamp and sets `locked = false`.

- [ ] **Step 1: Write the failing tests**

Create `src/auth/use-app-lock.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { UNLOCK_PROMPT, shouldRelock, useAppLock } from './use-app-lock';

const mockAuthenticate = jest.fn();
jest.mock('./biometrics', () => ({
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
}));

type SettingsRow = { lockEnabled: boolean; lockGraceSeconds: number };
const mockLiveQuery: { current: { data: SettingsRow[]; isLoading: boolean } } = {
  current: { data: [], isLoading: true },
};
jest.mock('../db/use-live-query', () => ({
  useLiveQuery: () => mockLiveQuery.current,
}));
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const appStateListeners: Array<(state: AppStateStatus) => void> = [];
const mockRemove = jest.fn();

const settled = (lockEnabled: boolean, lockGraceSeconds = 30): void => {
  mockLiveQuery.current = { data: [{ lockEnabled, lockGraceSeconds }], isLoading: false };
};

const transition = async (state: AppStateStatus, nowMs: number): Promise<void> => {
  jest.spyOn(Date, 'now').mockReturnValue(nowMs);

  await act(async () => {
    for (const listener of appStateListeners) {
      listener(state);
    }
  });
};

const deferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  appStateListeners.length = 0;
  // The RN Jest preset ships AppState.addEventListener as a jest.fn; capture
  // the 'change' listener so tests can drive foreground/background transitions.
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: mockRemove };
    },
  );
  mockAuthenticate.mockResolvedValue({ kind: 'success' });
  mockLiveQuery.current = { data: [], isLoading: true };
});

describe('shouldRelock', () => {
  it('never re-locks without a background stamp', () => {
    expect(shouldRelock({ backgroundedAt: undefined, now: 10_000, graceSeconds: 0 })).toBe(false);
  });

  it('stays unlocked while the grace period has not elapsed', () => {
    expect(shouldRelock({ backgroundedAt: 1_000, now: 30_999, graceSeconds: 30 })).toBe(false);
  });

  it('re-locks once the grace period has elapsed', () => {
    expect(shouldRelock({ backgroundedAt: 1_000, now: 31_000, graceSeconds: 30 })).toBe(true);
  });

  it('re-locks immediately when the grace period is zero', () => {
    expect(shouldRelock({ backgroundedAt: 1_000, now: 1_000, graceSeconds: 0 })).toBe(true);
  });
});

describe('useAppLock', () => {
  it('is not ready and not locked while the settings row is still loading', async () => {
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isReady).toBe(false);
    expect(result.current.isLocked).toBe(false);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('cold launch with the lock disabled never locks', async () => {
    settled(false);
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isReady).toBe(true);
    expect(result.current.isLocked).toBe(false);
  });

  it('cold launch with the lock enabled starts locked, and a successful unlock clears it', async () => {
    settled(true);
    const { result } = await renderHook(() => useAppLock());

    expect(result.current.isLocked).toBe(true);

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockAuthenticate).toHaveBeenCalledWith(UNLOCK_PROMPT);
    expect(result.current.isLocked).toBe(false);
  });

  it('stays locked when authentication does not succeed', async () => {
    settled(true);
    mockAuthenticate.mockResolvedValue({ kind: 'cancelled' });
    const { result } = await renderHook(() => useAppLock());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.unlock();
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(result.current.isLocked).toBe(true);
  });

  it('foregrounding before the grace period elapsed keeps the app unlocked', async () => {
    settled(true, 30);
    const { result } = await renderHook(() => useAppLock());
    await act(async () => {
      await result.current.unlock();
    });

    await transition('background', 1_000);
    await transition('active', 20_000);

    expect(result.current.isLocked).toBe(false);
  });

  it('foregrounding after the grace period re-locks', async () => {
    settled(true, 30);
    const { result } = await renderHook(() => useAppLock());
    await act(async () => {
      await result.current.unlock();
    });

    await transition('background', 1_000);
    await transition('active', 31_000);

    expect(result.current.isLocked).toBe(true);
  });

  it('a zero grace period always re-locks', async () => {
    settled(true, 0);
    const { result } = await renderHook(() => useAppLock());
    await act(async () => {
      await result.current.unlock();
    });

    await transition('background', 1_000);
    await transition('active', 1_001);

    expect(result.current.isLocked).toBe(true);
  });

  it('never re-locks when the lock is disabled, however long the background was', async () => {
    settled(false, 0);
    const { result } = await renderHook(() => useAppLock());

    await transition('background', 0);
    await transition('active', 1_000_000_000);

    expect(result.current.isLocked).toBe(false);
  });

  it('measures the grace period from the first inactive transition, not the later background one', async () => {
    settled(true, 30);
    const { result } = await renderHook(() => useAppLock());
    await act(async () => {
      await result.current.unlock();
    });

    await transition('inactive', 1_000);
    await transition('background', 25_000);
    await transition('active', 32_000);

    expect(result.current.isLocked).toBe(true);
  });

  it('ignores the inactive/active flicker caused by the biometric sheet itself', async () => {
    settled(true, 0);
    const pending = deferred<{ kind: 'success' }>();
    mockAuthenticate.mockReturnValue(pending.promise);
    const { result } = await renderHook(() => useAppLock());

    let unlockPromise!: Promise<unknown>;
    act(() => {
      unlockPromise = result.current.unlock();
    });
    await transition('inactive', 1_000);
    await transition('active', 1_500);

    await act(async () => {
      pending.resolve({ kind: 'success' });
      await unlockPromise;
    });

    expect(result.current.isLocked).toBe(false);
  });

  it('removes the AppState subscription on unmount', async () => {
    settled(true);
    const { unmount } = await renderHook(() => useAppLock());

    await unmount();

    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/auth/use-app-lock.test.ts`
Expected: FAIL — `Cannot find module './use-app-lock'`.

- [ ] **Step 3: Implement**

Create `src/auth/use-app-lock.ts`:

```ts
import { AppState, type AppStateStatus } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLiveQuery } from '../db/use-live-query';
import { DEFAULT_LOCK_GRACE_SECONDS } from './lock-grace';
import { type AuthResult, authenticate } from './biometrics';
import { settingsRepo } from '../repositories/settings.repo';

export const UNLOCK_PROMPT = 'Unlock Kiko';

const MILLISECONDS_PER_SECOND = 1000;

type AppLock = {
  // False until the settings row has loaded; the gate renders neither the
  // prompt nor the children before then, so no real data can flash.
  isReady: boolean;
  isLocked: boolean;
  unlock: () => Promise<AuthResult>;
};

/**
 * Pure grace-period decision: re-lock when the app was backgrounded and at
 * least `graceSeconds` have passed since. A zero grace period therefore
 * re-locks on every foreground.
 */
export const shouldRelock = ({
  backgroundedAt,
  now,
  graceSeconds,
}: {
  backgroundedAt: number | undefined;
  now: number;
  graceSeconds: number;
}): boolean =>
  backgroundedAt !== undefined && now - backgroundedAt >= graceSeconds * MILLISECONDS_PER_SECOND;

/**
 * App-wide lock state. Cold launch starts locked whenever `settings.lockEnabled`
 * is on; after that, only a background/foreground cycle longer than the grace
 * period re-locks. `unlock()` runs the system biometric/passcode sheet.
 */
export const useAppLock = (): AppLock => {
  const { data, isLoading } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settingsRow = data.at(0);
  const lockEnabled = settingsRow?.lockEnabled ?? false;
  const lockGraceSeconds = settingsRow?.lockGraceSeconds ?? DEFAULT_LOCK_GRACE_SECONDS;
  // `undefined` = cold launch, not yet decided (settings still loading).
  const [locked, setLocked] = useState<boolean | undefined>(undefined);
  const backgroundedAt = useRef<number | undefined>(undefined);
  // The biometric sheet itself sends the app inactive -> active; those
  // transitions must not count as a background cycle.
  const authenticating = useRef(false);

  useEffect(() => {
    if (isLoading || locked !== undefined) {
      return;
    }

    setLocked(lockEnabled);
  }, [isLoading, lockEnabled, locked]);

  useEffect(() => {
    const handleChange = (nextState: AppStateStatus): void => {
      if (authenticating.current) {
        return;
      }

      if (nextState !== 'active') {
        backgroundedAt.current ??= Date.now();

        return;
      }

      const relock = shouldRelock({
        backgroundedAt: backgroundedAt.current,
        now: Date.now(),
        graceSeconds: lockGraceSeconds,
      });
      backgroundedAt.current = undefined;

      if (lockEnabled && relock) {
        setLocked(true);
      }
    };

    const subscription = AppState.addEventListener('change', handleChange);

    return () => {
      subscription.remove();
    };
  }, [lockEnabled, lockGraceSeconds]);

  const unlock = useCallback(async (): Promise<AuthResult> => {
    authenticating.current = true;
    const result = await authenticate(UNLOCK_PROMPT);
    authenticating.current = false;

    if (result.kind === 'success') {
      backgroundedAt.current = undefined;
      setLocked(false);
    }

    return result;
  }, []);

  return {
    isReady: locked !== undefined,
    isLocked: lockEnabled && locked === true,
    unlock,
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/auth/use-app-lock.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

Run: `npm run check:all`
Expected: silent success (the AppState handler's cognitive complexity is well under 15).

```bash
git add src/auth/use-app-lock.ts src/auth/use-app-lock.test.ts
git commit -m "feat(auth): useAppLock hook with cold-launch lock and AppState grace period"
```

---

### Task 13: `LockGate` component and `App.tsx` wiring

**Files:**
- Create: `src/auth/lock-gate/lock-gate.component.tsx`
- Create: `src/auth/lock-gate/lock-gate.styles.ts`
- Create: `src/auth/lock-gate/lock-gate.component.test.tsx`
- Modify: `App.tsx:9-12, 44-46`
- Modify: `__tests__/App.test.tsx:8-13`

**Interfaces:**
- Consumes: Task 12 `useAppLock(): { isReady, isLocked, unlock }`, Task 9 `AuthResult`; design-system `Box`, `Text`, `SymbolIcon` (`src/design-system/components/symbol`), `Button` (`src/design-system/components/button`); `SafeAreaView` from `react-native-safe-area-context`.
- Produces: `LockGate` (default export) `FC<{ children: ReactNode }>`: renders a blank themed surface while `!isReady`; renders `children` when `!isLocked`; otherwise renders the unlock prompt (`testID="lock-gate"`), calls `unlock()` once whenever `isLocked` becomes true, and re-calls it on the button press. Button label is `Use Passcode` after a `lockout` result, else `Unlock`.

- [ ] **Step 1: Write the failing test**

Create `src/auth/lock-gate/lock-gate.component.test.tsx`:

```tsx
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import '../../design-system/unistyles';
import LockGate from './lock-gate.component';

const mockUnlock = jest.fn();
const mockAppLock = { current: { isReady: true, isLocked: false, unlock: mockUnlock } };
jest.mock('../use-app-lock', () => ({
  useAppLock: () => mockAppLock.current,
}));

const renderGate = () =>
  render(
    <LockGate>
      <Text>secret balances</Text>
    </LockGate>,
  );

describe('LockGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnlock.mockResolvedValue({ kind: 'success' });
    mockAppLock.current = { isReady: true, isLocked: false, unlock: mockUnlock };
  });

  it('renders the children when unlocked and never prompts', async () => {
    const { getByText, queryByTestId } = await renderGate();

    expect(getByText('secret balances')).toBeTruthy();
    expect(queryByTestId('lock-gate')).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('renders neither the children nor the prompt while the lock state is unresolved', async () => {
    mockAppLock.current = { isReady: false, isLocked: false, unlock: mockUnlock };
    const { queryByText, queryByTestId } = await renderGate();

    expect(queryByText('secret balances')).toBeNull();
    expect(queryByTestId('lock-gate')).toBeNull();
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it('renders the unlock prompt instead of the children when locked, and prompts once on mount', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    const { getByTestId, getByText, queryByText } = await renderGate();

    expect(getByTestId('lock-gate')).toBeTruthy();
    expect(getByText('Locked')).toBeTruthy();
    expect(getByText('Unlock')).toBeTruthy();
    expect(queryByText('secret balances')).toBeNull();
    expect(mockUnlock).toHaveBeenCalledTimes(1);
  });

  it('re-prompts when the Unlock button is pressed', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    const { getByText } = await renderGate();

    await act(async () => {
      await fireEvent.press(getByText('Unlock'));
    });

    expect(mockUnlock).toHaveBeenCalledTimes(2);
  });

  it('offers the passcode after a biometry lockout', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    mockUnlock.mockResolvedValue({ kind: 'lockout' });
    const { findByText } = await renderGate();

    expect(await findByText('Use Passcode')).toBeTruthy();
    expect(await findByText('Face ID is locked. Use your device passcode instead.')).toBeTruthy();
  });

  it('explains a cancelled attempt and keeps the Unlock affordance', async () => {
    mockAppLock.current = { isReady: true, isLocked: true, unlock: mockUnlock };
    mockUnlock.mockResolvedValue({ kind: 'cancelled' });
    const { findByText, getByText } = await renderGate();

    expect(await findByText('Authentication was cancelled.')).toBeTruthy();
    expect(getByText('Unlock')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/auth/lock-gate/lock-gate.component.test.tsx`
Expected: FAIL — `Cannot find module './lock-gate.component'`.

- [ ] **Step 3: Implement the styles and the component**

Create `src/auth/lock-gate/lock-gate.styles.ts`:

```ts
import { StyleSheet } from 'react-native-unistyles';

export const styles = StyleSheet.create((theme) => ({
  // Fills the window with the theme background so nothing behind it (and no
  // white flash) can show while the gate is deciding or locked.
  fill: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  // Centered stack for the icon, title, hint, and the unlock button.
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    textAlign: 'center',
  },
}));
```

Create `src/auth/lock-gate/lock-gate.component.tsx`:

```tsx
import { match } from 'ts-pattern';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type FC, type ReactNode, useCallback, useEffect, useState } from 'react';

import { styles } from './lock-gate.styles';
import { useAppLock } from '../use-app-lock';
import type { AuthResult } from '../biometrics';
import Box from '../../design-system/components/box';
import Text from '../../design-system/components/text';
import Button from '../../design-system/components/button';
import SymbolIcon from '../../design-system/components/symbol';

const LOCK_ICON_SIZE = 56;

const unlockHint = (result: AuthResult | undefined): string =>
  match(result?.kind)
    .with(undefined, () => 'Unlock with Face ID or your device passcode.')
    .with('success', () => '')
    .with('cancelled', () => 'Authentication was cancelled.')
    .with('lockout', () => 'Face ID is locked. Use your device passcode instead.')
    .with('passcodeNotSet', () => 'Set a device passcode to unlock Kiko.')
    .with('failed', () => 'Authentication failed. Try again.')
    .exhaustive();

// With `allowDeviceCredentials` the same system sheet falls back to the
// passcode once biometry is locked out, so the retry action is the same call;
// only the label changes to tell the user what to expect.
const unlockLabel = (result: AuthResult | undefined): string =>
  result?.kind === 'lockout' ? 'Use Passcode' : 'Unlock';

/**
 * Mounted inside `MigrationsGate` (settings must be readable) and around the
 * navigator: while locked it replaces the whole app with a full-screen prompt
 * and runs the biometric/passcode sheet on mount and on every retry tap.
 * Note: `Screen` is not used here on purpose — it reads the bottom tab bar
 * height, which only exists inside the tab navigator this gate wraps.
 */
const LockGate: FC<{ children: ReactNode }> = ({ children }) => {
  const { isReady, isLocked, unlock } = useAppLock();
  const [lastResult, setLastResult] = useState<AuthResult | undefined>(undefined);

  const attemptUnlock = useCallback((): void => {
    unlock().then(setLastResult);
  }, [unlock]);

  useEffect(() => {
    if (!isLocked) {
      setLastResult(undefined);

      return;
    }

    attemptUnlock();
  }, [isLocked, attemptUnlock]);

  if (!isReady) {
    return <Box style={styles.fill} />;
  }

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <SafeAreaView testID="lock-gate" style={styles.fill}>
      <Box padding={6} gap={4} style={styles.content}>
        <SymbolIcon name="lock.fill" size={LOCK_ICON_SIZE} tone="textSecondary" />

        <Text variant="title">Locked</Text>

        <Text variant="body" tone="textSecondary" style={styles.hint}>
          {unlockHint(lastResult)}
        </Text>

        <Button onPress={attemptUnlock} fullWidth={false}>
          {unlockLabel(lastResult)}
        </Button>
      </Box>
    </SafeAreaView>
  );
};

export default LockGate;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/auth/lock-gate/lock-gate.component.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the gate into `App.tsx` and update the App smoke test**

In `App.tsx`, add the import (relative group, sorted by length with its neighbors):

```tsx
import LockGate from './src/auth/lock-gate/lock-gate.component';
```

Replace the `MigrationsGate` block in `App()`:

```tsx
        <MigrationsGate>
          {/* Inside MigrationsGate: the gate reads settings.lockEnabled, so the
              database must be open and migrated first. Around AppRoot: while
              locked, nothing below (navigator, auto-sync, ensure) mounts. */}
          <LockGate>
            <AppRoot />
          </LockGate>
        </MigrationsGate>
```

In `__tests__/App.test.tsx`, after the `MigrationsGate` mock (line 13), add:

```tsx
// LockGate reads the settings row through useLiveQuery (mocked below to
// return no rows, i.e. never "ready"); stub it as a passthrough so the boot
// smoke test reaches the Home screen exactly as MigrationsGate is stubbed.
jest.mock('../src/auth/lock-gate/lock-gate.component', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
```

Run: `npx jest __tests__/App.test.tsx src/navigation`
Expected: PASS.

- [ ] **Step 6: Commit**

Run: `npm run check:all`
Expected: silent success.

```bash
git add src/auth/lock-gate App.tsx __tests__/App.test.tsx
git commit -m "feat(auth): LockGate wraps the navigator inside MigrationsGate"
```

- [ ] **Step 7: MANUAL VERIFICATION (after Task 14 provides the toggle)**

On a Face ID simulator (Features → Face ID → Enrolled) or a device:
1. Settings → App Lock on. Kill the app, relaunch. Expected: black gate with "Locked", the Face ID sheet appears automatically. Simulator: Features → Face ID → Matching Face. Expected: Home appears.
2. Relaunch, Features → Face ID → Non-matching Face twice, then choose the passcode fallback on the sheet. Expected: the passcode entry sheet appears; entering the simulator passcode unlocks.
3. With grace `Immediately`: background the app (Home button), foreground it. Expected: locked again, sheet appears. With grace `30 sec`: background, foreground within 30 s → not locked; background, wait 35 s, foreground → locked.
4. Settings → App Lock off. Background/foreground and relaunch. Expected: never locked.
5. Confirm the app-switcher card is black in every state (Task 7 overlay) and that the Face ID sheet appearing does not leave a stuck black overlay afterwards.

---

### Task 14: Settings UI — `OptionPills` primitive, `AppLockSetting` card, screen wiring

**Files:**
- Create: `src/design-system/components/option-pills/option-pills.component.tsx`, `option-pills.props.ts`, `index.ts`, `option-pills.component.test.tsx`
- Modify: `src/design-system/components/currency-switch/currency-switch.component.tsx`
- Create: `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx`, `app-lock-setting.props.ts`, `app-lock-setting.component.test.tsx`
- Modify: `src/screens/settings/settings.screen.tsx`
- Modify: `src/screens/settings/settings.screen.test.tsx`

**Interfaces:**
- Consumes: Task 9 `isSensorAvailable(): Promise<SensorStatus>`; Task 11 `LOCK_GRACE_OPTIONS`, `LockGraceSeconds`, `DEFAULT_LOCK_GRACE_SECONDS`, `lockGraceLabel`, `settingsRepo.setLockEnabled`, `settingsRepo.setLockGraceSeconds`; design-system `Box`, `Text`, `PressableButton`, `Switch`, `GlassSurface`, `SettingsRow`.
- Produces:
  ```ts
  // option-pills.props.ts
  export type OptionPillsProps<T extends string | number> = {
    options: readonly T[];
    selected: T | undefined;
    onSelect: (option: T) => void;
    label?: (option: T) => string;   // defaults to String(option)
  };
  // OptionPills: default export, generic function component
  // app-lock-setting.props.ts
  export type AppLockSettingProps = {
    lockEnabled: boolean;
    lockGraceSeconds: number;
    onToggle: (enabled: boolean) => void;
    onSelectGrace: (seconds: LockGraceSeconds) => void;
  };
  // AppLockSetting: default export; testIDs 'settings-card-app-lock', 'settings-row-app-lock'; a11y role 'switch'
  ```

The pill selector is extracted from `CurrencySwitch` because a second consumer now exists (the project rule: shared components, no hand-rolled duplicates). `CurrencySwitch` keeps its name and props and becomes a one-line delegate.

- [ ] **Step 1: Write the failing `OptionPills` test**

Create `src/design-system/components/option-pills/option-pills.component.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import OptionPills from './option-pills.component';

describe('OptionPills', () => {
  it('renders one pressable pill per option, labelled by String() by default', async () => {
    const { getAllByRole, getByText } = await render(
      <OptionPills options={[0, 30, 60]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getAllByRole('button')).toHaveLength(3);
    expect(getByText('0')).toBeTruthy();
    expect(getByText('60')).toBeTruthy();
  });

  it('uses the label function when given', async () => {
    const { getByText } = await render(
      <OptionPills options={['a', 'b'] as const} selected="a" onSelect={jest.fn()} label={(o) => o.toUpperCase()} />,
    );

    expect(getByText('A')).toBeTruthy();
    expect(getByText('B')).toBeTruthy();
  });

  it('reports the pressed option', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(<OptionPills options={[0, 30]} selected={0} onSelect={onSelect} />);

    await fireEvent.press(getByText('30'));

    expect(onSelect).toHaveBeenCalledWith(30);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/design-system/components/option-pills`
Expected: FAIL — `Cannot find module './option-pills.component'`.

- [ ] **Step 3: Implement `OptionPills` and delegate `CurrencySwitch` to it**

Create `src/design-system/components/option-pills/option-pills.props.ts`:

```ts
export type OptionPillsProps<T extends string | number> = {
  options: readonly T[];
  selected: T | undefined;
  onSelect: (option: T) => void;
  // Display text for an option. Defaults to `String(option)`.
  label?: (option: T) => string;
};
```

Create `src/design-system/components/option-pills/option-pills.component.tsx`:

```tsx
import type { ReactElement } from 'react';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../box';
import Text from '../text';
import PressableButton from '../pressable-button';
import type { OptionPillsProps } from './option-pills.props';

// A row of pill buttons for a small closed set of options (base currency,
// lock grace period). Only the selected pill paints a raised surface; the
// others stay transparent so the glass card behind them shows through.
// Generic over the option type, so it is a plain function component rather
// than an `FC` (which cannot carry a type parameter).
const OptionPills = <T extends string | number>({
  options,
  selected,
  onSelect,
  label = String,
}: OptionPillsProps<T>): ReactElement => {
  const { theme } = useUnistyles();

  return (
    <Box gap={2} direction="row">
      {options.map((option) => (
        <PressableButton
          key={option}
          onPress={() => onSelect(option)}
          backgroundColor={selected === option ? theme.colors.surfaceHigh : 'transparent'}
        >
          <Text variant="body" tone={selected === option ? 'textPrimary' : 'textSecondary'}>
            {label(option)}
          </Text>
        </PressableButton>
      ))}
    </Box>
  );
};

export default OptionPills;
```

Create `src/design-system/components/option-pills/index.ts`:

```ts
export { default } from './option-pills.component';
```

Replace `src/design-system/components/currency-switch/currency-switch.component.tsx` with:

```tsx
import type { FC } from 'react';

import OptionPills from '../option-pills';
import type { Currency } from '../../../currency/currency';
import type { CurrencySwitchProps } from './currency-switch.props';

const currencyOptions: readonly Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

const CurrencySwitch: FC<CurrencySwitchProps> = ({ selected, onSelect }) => {
  return <OptionPills options={currencyOptions} selected={selected} onSelect={onSelect} />;
};

export default CurrencySwitch;
```

Run: `npx jest src/design-system/components/option-pills src/screens/settings/settings.screen.test.tsx`
Expected: PASS — the existing settings-screen tests (four currency pressables, `setBaseCurrency('USD')`) still pass through the delegate.

- [ ] **Step 4: Write the failing `AppLockSetting` test**

Create `src/screens/settings/app-lock-setting/app-lock-setting.component.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import '../../../design-system/unistyles';
import AppLockSetting from './app-lock-setting.component';

const mockIsSensorAvailable = jest.fn();
jest.mock('../../../auth/biometrics', () => ({
  isSensorAvailable: () => mockIsSensorAvailable(),
}));

const renderSetting = (overrides: Partial<Parameters<typeof AppLockSetting>[0]> = {}) =>
  render(
    <AppLockSetting
      lockEnabled={false}
      lockGraceSeconds={30}
      onToggle={jest.fn()}
      onSelectGrace={jest.fn()}
      {...overrides}
    />,
  );

describe('AppLockSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSensorAvailable.mockResolvedValue({ kind: 'available', biometryType: 'FaceID' });
  });

  it('renders the App Lock row in its own card with an enabled switch on a Face ID device', async () => {
    const { getByTestId, findByRole, queryByText } = await renderSetting();

    expect(getByTestId('settings-card-app-lock')).toBeTruthy();
    expect(getByTestId('settings-row-app-lock')).toBeTruthy();
    expect(await findByRole('switch')).toBeEnabled();
    // No sensor hint on a fully capable device (the switch's own label,
    // "Require Face ID or Passcode", is not a hint).
    expect(queryByText(/Set a device passcode/)).toBeNull();
    expect(queryByText(/unavailable/)).toBeNull();
    expect(queryByText(/No Face ID enrolled/)).toBeNull();
  });

  it('reports a toggle', async () => {
    const onToggle = jest.fn();
    const { findByRole } = await renderSetting({ onToggle });

    await fireEvent(await findByRole('switch'), 'valueChange', true);

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('disables the switch with a hint when the device has no passcode', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'passcodeNotSet' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeDisabled();
    expect(await findByText('Set a device passcode in iOS Settings to use App Lock.')).toBeTruthy();
  });

  it('disables the switch with a hint when biometric hardware is unavailable', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'unavailable' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeDisabled();
    expect(await findByText('Biometric hardware is unavailable on this device.')).toBeTruthy();
  });

  it('keeps the switch enabled with a passcode-only hint when no biometry is enrolled', async () => {
    mockIsSensorAvailable.mockResolvedValue({ kind: 'passcodeOnly' });
    const { findByRole, findByText } = await renderSetting();

    expect(await findByRole('switch')).toBeEnabled();
    expect(await findByText('No Face ID enrolled — your device passcode will be used.')).toBeTruthy();
  });

  it('hides the grace picker while the lock is off', async () => {
    const { findByRole, queryByText } = await renderSetting({ lockEnabled: false });

    await findByRole('switch');

    expect(queryByText('Lock again after')).toBeNull();
    expect(queryByText('30 sec')).toBeNull();
  });

  it('shows the four grace options while the lock is on, marks the current one, and reports a pick', async () => {
    const onSelectGrace = jest.fn();
    const { findByText, getByText, getAllByRole } = await renderSetting({
      lockEnabled: true,
      lockGraceSeconds: 30,
      onSelectGrace,
    });

    expect(await findByText('Lock again after')).toBeTruthy();
    expect(getAllByRole('button')).toHaveLength(4);
    expect(getByText('Immediately')).toBeTruthy();
    expect(getByText('30 sec')).toBeTruthy();
    expect(getByText('1 min')).toBeTruthy();
    expect(getByText('5 min')).toBeTruthy();

    await fireEvent.press(getByText('1 min'));

    expect(onSelectGrace).toHaveBeenCalledWith(60);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx jest src/screens/settings/app-lock-setting`
Expected: FAIL — `Cannot find module './app-lock-setting.component'`.

- [ ] **Step 6: Implement `AppLockSetting`**

Create `src/screens/settings/app-lock-setting/app-lock-setting.props.ts`:

```ts
import type { LockGraceSeconds } from '../../../auth/lock-grace';

export type AppLockSettingProps = {
  lockEnabled: boolean;
  // The stored value; any integer from the DB. Highlighted only when it is
  // one of LOCK_GRACE_OPTIONS.
  lockGraceSeconds: number;
  onToggle: (enabled: boolean) => void;
  onSelectGrace: (seconds: LockGraceSeconds) => void;
};
```

Create `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx`:

```tsx
import { match } from 'ts-pattern';
import { type FC, useEffect, useState } from 'react';

import SettingsRow from '../settings-row.component';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Switch from '../../../design-system/components/switch';
import type { AppLockSettingProps } from './app-lock-setting.props';
import OptionPills from '../../../design-system/components/option-pills';
import GlassSurface from '../../../design-system/components/glass-surface';
import { LOCK_GRACE_OPTIONS, lockGraceLabel } from '../../../auth/lock-grace';
import { isSensorAvailable, type SensorStatus } from '../../../auth/biometrics';

const sensorHint = (status: SensorStatus | undefined): string | undefined =>
  match(status?.kind)
    .with(undefined, () => undefined)
    .with('available', () => undefined)
    .with('passcodeOnly', () => 'No Face ID enrolled — your device passcode will be used.')
    .with('passcodeNotSet', () => 'Set a device passcode in iOS Settings to use App Lock.')
    .with('unavailable', () => 'Biometric hardware is unavailable on this device.')
    .exhaustive();

// The lock can be offered whenever the system sheet has *something* to ask
// for: biometrics, or (passcodeOnly) the device passcode. A device with no
// passcode gets a disabled switch and a hint instead of a lock that would
// fail at runtime.
const canOfferLock = (status: SensorStatus | undefined): boolean =>
  status?.kind === 'available' || status?.kind === 'passcodeOnly';

const AppLockSetting: FC<AppLockSettingProps> = ({
  lockEnabled,
  lockGraceSeconds,
  onToggle,
  onSelectGrace,
}) => {
  const [sensorStatus, setSensorStatus] = useState<SensorStatus | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    isSensorAvailable().then((status) => {
      if (alive) {
        setSensorStatus(status);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const hint = sensorHint(sensorStatus);
  const lockAvailable = canOfferLock(sensorStatus);
  const selectedGrace = LOCK_GRACE_OPTIONS.find((option) => option === lockGraceSeconds);

  return (
    <GlassSurface testID="settings-card-app-lock" padding={3}>
      <SettingsRow testID="settings-row-app-lock" icon="lock.fill" label="App Lock">
        <Switch
          value={lockEnabled}
          onValueChange={onToggle}
          disabled={!lockAvailable}
          label="Require Face ID or Passcode"
        />

        {hint !== undefined && (
          <Text variant="caption" tone="textSecondary">
            {hint}
          </Text>
        )}

        {lockEnabled && lockAvailable && (
          <Box gap={2}>
            <Text variant="caption" tone="textSecondary">
              Lock again after
            </Text>

            <OptionPills
              options={LOCK_GRACE_OPTIONS}
              selected={selectedGrace}
              onSelect={onSelectGrace}
              label={lockGraceLabel}
            />
          </Box>
        )}
      </SettingsRow>
    </GlassSurface>
  );
};

export default AppLockSetting;
```

- [ ] **Step 7: Run the component tests to verify they pass**

Run: `npx jest src/screens/settings/app-lock-setting`
Expected: PASS (7 tests).

- [ ] **Step 8: Write the failing screen tests**

In `src/screens/settings/settings.screen.test.tsx`:

Replace the mock header (lines 5-16) with:

```tsx
const mockSetBaseCurrency = jest.fn();
const mockSetLockEnabled = jest.fn();
const mockSetLockGraceSeconds = jest.fn();
type SettingsData = { baseCurrency: string; lockEnabled: boolean; lockGraceSeconds: number };
const defaultSettings: SettingsData = { baseCurrency: 'UAH', lockEnabled: false, lockGraceSeconds: 30 };
let mockLiveQueryData: SettingsData[] = [defaultSettings];

jest.mock('../../repositories/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setBaseCurrency: (...args: unknown[]) => mockSetBaseCurrency(...args),
    setLockEnabled: (...args: unknown[]) => mockSetLockEnabled(...args),
    setLockGraceSeconds: (...args: unknown[]) => mockSetLockGraceSeconds(...args),
  },
}));
jest.mock('../../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockLiveQueryData, isLoading: false }),
}));
```

Update the `beforeEach` reset to `mockLiveQueryData = [defaultSettings];`.

Update the button-count test's comment and expectation to state the lock card adds no *buttons* while off (a `Switch` has the `switch` role):

```tsx
  it('renders each currency option as its own independently pressable control within the row (no shared multi-action box)', async () => {
    const navigation = { navigate: jest.fn() } as never;
    const { getAllByRole } = await render(<SettingsScreen navigation={navigation} />);
    // BTC, USD, EUR, UAH — four separate currency pressables, not one combined
    // control — plus the navigating Categories row's own pressable (5 total).
    // The App Lock card contributes a `switch`, not a button, while off.
    expect(getAllByRole('button')).toHaveLength(5);
  });
```

Append these tests inside the `describe`:

```tsx
  it('renders the App Lock setting in its own card between currency and categories', async () => {
    const { getByTestId } = await render(<SettingsScreen />);
    expect(getByTestId('settings-card-app-lock')).toBeTruthy();
  });

  it('calls setLockEnabled when the App Lock switch is toggled', async () => {
    const { findByRole } = await render(<SettingsScreen />);

    await fireEvent(await findByRole('switch'), 'valueChange', true);

    expect(mockSetLockEnabled).toHaveBeenCalledWith(true);
  });

  it('calls setLockGraceSeconds when a grace option is picked while the lock is on', async () => {
    mockLiveQueryData = [{ ...defaultSettings, lockEnabled: true }];
    const { findByText } = await render(<SettingsScreen />);

    await fireEvent.press(await findByText('5 min'));

    expect(mockSetLockGraceSeconds).toHaveBeenCalledWith(300);
  });
```

- [ ] **Step 9: Run the screen tests to verify they fail**

Run: `npx jest src/screens/settings/settings.screen.test.tsx`
Expected: FAIL — `Unable to find an element with testID: settings-card-app-lock`.

- [ ] **Step 10: Wire the card into the screen**

In `src/screens/settings/settings.screen.tsx`:

Add imports (keep the two-group, shortest-first ordering):

```tsx
import type { LockGraceSeconds } from '../../auth/lock-grace';
import { DEFAULT_LOCK_GRACE_SECONDS } from '../../auth/lock-grace';
import AppLockSetting from './app-lock-setting/app-lock-setting.component';
```

Add handlers after `handleSelectCurrency`:

```tsx
  const handleToggleLock = (enabled: boolean): void => {
    settingsRepo.setLockEnabled(enabled);
  };

  const handleSelectGrace = (seconds: LockGraceSeconds): void => {
    settingsRepo.setLockGraceSeconds(seconds);
  };
```

Insert the card between the base-currency and categories cards:

```tsx
        <AppLockSetting
          lockEnabled={settings?.lockEnabled ?? false}
          lockGraceSeconds={settings?.lockGraceSeconds ?? DEFAULT_LOCK_GRACE_SECONDS}
          onToggle={handleToggleLock}
          onSelectGrace={handleSelectGrace}
        />
```

Leave the existing JSX comment above the cards unchanged (it still describes the one-card-per-setting pattern). Separate the three sibling cards with blank lines, per the design-system JSX layout rule.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx jest src/screens/settings src/design-system/components/option-pills src/navigation __tests__/App.test.tsx`
Expected: PASS.

- [ ] **Step 12: Commit**

Run: `npm run check:all`
Expected: silent success (`check:dup` — the `CurrencySwitch` body is gone, so the pill markup exists once).

```bash
git add src/design-system/components/option-pills src/design-system/components/currency-switch/currency-switch.component.tsx src/screens/settings
git commit -m "feat(settings): App Lock toggle and grace picker; extract OptionPills from CurrencySwitch"
```

Now perform Task 13 Step 7 (manual lock verification) — the toggle exists.

---

### Task 15: Final verification — full harness, deep checks, device checklist

**Files:**
- No new files. Possibly `CLAUDE.md` if `check:deep` needs a newly documented exception (not expected).

**Interfaces:**
- Consumes: everything above.
- Produces: a feature ready for review.

- [ ] **Step 1: Token-field prefill reconciliation (spec item, verification only)**

Run: `npx jest src/screens/account-detail/monobank-token-field.component.test.tsx`
Expected: PASS. Rationale for no code change: `readToken()` has no `accessControl`, so the eager prefill is a silent second Keychain *read* on the account screen (which only mounts after `LockGate` unlocks), never a second *prompt*. Nothing to commit for this step.

- [ ] **Step 2: Full unit suite and fast/medium harness**

Run: `npx jest`
Expected: PASS, all suites.

Run: `npm run check:all`
Expected: silent success.

- [ ] **Step 3: Deep harness**

Run: `npm run check:deep`
Expected: Stryker mutation score ≥ 60 (the `break` threshold); osv-scanner reports only the two accepted `image-size` advisories (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) documented in `CLAUDE.md`. If the mutation score dips below 60, strengthen tests in the new `src/auth/*` / `src/db/*` files (typical survivors: the `>=` boundary in `shouldRelock`, the error-code lists in `biometrics.ts`, the `lockEnabled &&` guard in `useAppLock`) — never lower the threshold.

- [ ] **Step 4: Device checklist (all manual steps in one pass)**

Build once (`npm run ios`, or via the ops agent) and walk:
1. Task 4 Step 7 — upgrade with data (data intact, `pff.db` gone, `kiko-encrypted.db` unreadable by stock `sqlite3`), fresh install, relaunch ×2.
2. Task 7 Steps 3-4 — app-switcher card is black; `xattr -l` shows the backup-exclusion attribute.
3. Task 8 Step 4 — Monobank sync succeeds; with both pins corrupted it fails; reverted it succeeds.
4. Task 13 Step 7 — cold-launch lock, Face ID match/non-match + passcode fallback, grace `Immediately` vs `30 sec`, lock off never locks, no stuck overlay after the Face ID sheet.
5. Settings: on the simulator with Face ID **not** enrolled (Features → Face ID → Enrolled unchecked) the App Lock switch stays enabled with the "No Face ID enrolled" hint; there is no simulator mode for "no passcode", so the `passcodeNotSet` branch is covered by the unit test only.

- [ ] **Step 5: Hand off**

No commit is expected from this task unless Step 3 required test strengthening (`test(auth): …` / `test(db): …`). Report to the coordinator: the task list above, the manual checklist results, and the two documented decisions that may want a user call — `randomblob()` vs. a `react-native-get-random-values` dependency for the DB key, and `kiko-encrypted.db` as the permanent file name.
