# Localization (English / Ukrainian) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add English/Ukrainian language support to Kiko — selectable from Settings, defaulting to the device language — routing every user-facing string through a typed i18next catalog, making money/compact-money grouping locale-aware, and translating the seeded default categories, with no data-model rework beyond one nullable settings column.

**Architecture:** A side-effect `src/i18n/index.ts` module (mirroring `src/design-system/unistyles.ts`) creates and initializes an i18next instance synchronously at app start with the device-detected language, before the first paint. `react-i18next`'s `useTranslation` hook renders catalog text in every component; a settings-driven hook calls `i18n.changeLanguage` when the user picks a language. `en.ts` is the single source of truth for both the key set and the catalog's TypeScript type (module augmentation), so a wrong or missing key is a `tsc` error. Money formatting threads an `activeLocale()` helper through the existing `locale` parameters already present on the format functions.

**Tech Stack:** TypeScript, React Native (iOS-only), react-native-unistyles, op-sqlite + drizzle-orm, i18next + react-i18next, Jest + React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-localization-design.md`

## Global Constraints

- Add `i18next` and `react-i18next` as REAL dependencies (both imported from working code — Knip/depcheck see genuine usage, no ignore-list entry). `.npmrc`'s `min-release-age=7` (root `CLAUDE.md` → "Dependency hygiene") applies at install time; neither package name goes in `min-release-age-exclude`. If a fresh publish of either is <7 days old at install time, the install is BLOCKED — pin to a version published ≥7 days ago rather than excluding the package (see Task 1).
- NO `react-native-localize`, no new pod/native module. Device language is read dependency-free from `NativeModules.SettingsManager.settings.AppleLanguages[0]` (a BCP-47 tag). Only its primary subtag is used: `uk` or `ru` → `'uk'`; anything else → `'en'`.
- English and Ukrainian ONLY. No third language, no RTL, no runtime/remote catalog download — the catalog ships in the bundle.
- `en.ts` is the source of truth for the catalog's keys AND its TypeScript type (i18next `CustomTypeOptions.resources` module augmentation). `uk.ts` mirrors the exact same key set. A key present in one and missing from the other must fail a test (Task 2) and/or `tsc`.
- Ukrainian plural forms use i18next's CLDR suffixes (`_one`, `_few`, `_many`, `_other`); English uses `_one`/`_other`. i18next picks the suffix from the `count` passed to `t()`.
- The new settings column is `text('language', { enum: ['en', 'uk'] })` — NO `.notNull()`, NO default. `null` = "follow the device"; `'en'`/`'uk'` = explicit user choice. The migrations folder ends at `0011_add_lock_settings.sql`, so the new file is `drizzle/migrations/0012_add_language.sql`.
- Numeric dates stay UNCHANGED. `src/dates/format.ts` is deliberately locale-independent (`DD.MM.YYYY`); no `locale` parameter is added there. Only SPELLED-OUT date names change: `calendar-header.component.tsx` (month/weekday arrays) and `net-worth-line.component.tsx`'s `formatAxisTime`.
- The hand-coded currency-symbol placement in `formatMoney`/`formatCompactMoney` (`UAH` suffixed, others prefixed) is UNTOUCHED. Only numeric grouping/decimal punctuation changes with locale (`uk-UA` → `1 234,56`).
- Default categories translate by STABLE `key` slug ONLY when the row's `title` still matches its English seed title; if the user renamed the category, the stored `title` is shown unchanged in either language. No schema change, no row mutation.
- User-typed text (custom category names, transaction descriptions, comments, account/holding names) is NEVER translated.
- Code style (`kiko-code-style`): single quotes, 2-space indent, trailing commas, `arrowParentheses: always`, blank line before every `return`/`if`/`for`/`while`/`switch`/`throw`/`try`, blank line between adjacent JSX sibling nodes, `import type` for type-only imports, full unabbreviated names, one component per file in its own folder with an `index.ts` barrel, components default-export with a named function and `.component.tsx` suffix, everything else named export, type-only files use `.d.ts`, `ts-pattern`'s `match(...).exhaustive()` for any mapping over a closed literal set.
- Harness (root `CLAUDE.md`): run `npm run check:all` at each task checkpoint; run `npm run check:deep` before declaring the feature done. Never weaken a check to get green.
- Device-only verification: device-language detection (Task 2) and flag-emoji rendering in the pills (Task 5) cannot be proven by Jest — they require an on-device/simulator build (ops), flagged in each task and gathered in Final verification.

---

## File Structure

Added:
- `src/i18n/device-language.ts` — pure device-primary-subtag → `'en' | 'uk'` detection (dependency-free, guarded so Jest returns `'en'`).
- `src/i18n/device-language.test.ts` — unit tests for the mapping.
- `src/i18n/active-locale.ts` — `activeLocale()`: active i18next language → BCP-47 locale (`'en-US'` / `'uk-UA'`).
- `src/i18n/active-locale.test.ts` — unit tests.
- `src/i18n/locales/en.ts` — canonical English resource object (source of truth for keys + type).
- `src/i18n/locales/uk.ts` — Ukrainian mirror, same key set.
- `src/i18n/locales/en.uk.parity.test.ts` — key-parity test between `en.ts` and `uk.ts`.
- `src/i18n/index.ts` — creates/initializes the i18next instance (side-effect module) and re-exports it plus `deviceLanguage`.
- `src/i18n/i18next.d.ts` — `CustomTypeOptions` module augmentation typing the catalog off `en.ts`.
- `src/i18n/use-sync-language-with-settings.ts` — hook: `i18n.changeLanguage(settings.language)` when non-null and differing.
- `src/i18n/use-sync-language-with-settings.test.ts` — unit tests.
- `src/design-system/components/language-switch/language-switch.component.tsx`, `.props.d.ts`, `index.ts`, `.component.test.tsx` — the flag+label segmented switch over `OptionPills`.
- `drizzle/migrations/0012_add_language.sql` (+ drizzle-kit-regenerated `drizzle/migrations/meta/_journal.json` and the new `00XX_snapshot.json`).
- `src/i18n/default-category-title.ts` — the `key → English seed title` map + `resolveDefaultCategoryTitle` translator.
- `src/i18n/default-category-title.test.ts` — unit tests.

Modified:
- `package.json` (`i18next`, `react-i18next`), `jest.config.js` (`transformIgnorePatterns` allow-list).
- `App.tsx` (side-effect import of `./src/i18n` at the top; `useSyncLanguageWithSettings()` in `AppRoot`).
- `src/db/schema.ts` (`settings.language` column).
- `src/repositories/settings.repo.ts` (`setLanguage`).
- `src/screens/settings/settings.screen.tsx` (`settings-card-language` card).
- `src/design-system/components/money-text/money-text.component.tsx` (thread `activeLocale()`, subscribe to language).
- `src/design-system/components/net-worth-line/net-worth-line.component.tsx` (`formatCompactMoney` locale, `formatAxisTime` locale).
- `src/screens/calendar/calendar-header/calendar-header.component.tsx` (month/weekday → catalog).
- `src/categories/category-display.ts` (default-category translation via `resolveDefaultCategoryTitle`).
- ~37 `.tsx` files under `src/` holding hardcoded user-facing strings, each switched to `t('...')` (Task 10, grouped).

---

## Task 1: Add dependencies (ops)

**Files:**
- Modify: `package.json`
- Modify: `jest.config.js:27-29` (`transformIgnorePatterns`)

**Interfaces:**
- Produces: `i18next` and `react-i18next` resolvable from `node_modules`; both transformable under Jest.

- [ ] **Step 1 (ops): Install both packages**

Run:
```bash
npm install i18next react-i18next
```
If either newest version is <7 days old, `.npmrc`'s `min-release-age=7` blocks the install with an ERESOLVE/age error. Do NOT add the package to `min-release-age-exclude`. Instead pin to the newest version published ≥7 days ago, e.g.:
```bash
npm view i18next versions --json   # inspect publish dates with: npm view i18next time --json
npm install i18next@<version-published-7+-days-ago> react-i18next@<version-published-7+-days-ago>
```

- [ ] **Step 2 (ops): Confirm both are runtime `dependencies`**

Both must land under `"dependencies"` (not `devDependencies`) in `package.json` — they ship in the app bundle.

- [ ] **Step 3 (developer): Allow-list the packages for Jest transform (only if needed)**

`react-i18next` ships CommonJS and normally needs no allow-list entry. Run the parity test scaffolding in Task 2 first; ONLY if a Jest run fails to parse `i18next`/`react-i18next` ESM, extend `jest.config.js:28`'s `transformIgnorePatterns` alternation to include them (append `|i18next|react-i18next` inside the `(?!(...)/)` group), per `kiko-code-style` → "Testing a native/ESM dependency". Leave unchanged if tests parse without it.

- [ ] **Step 4 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green. `check:deps` surfaces the changed dependency block for confirmation (expected — the two new deps). `check:knip` will flag `i18next`/`react-i18next` as unused ONLY until Task 2 imports them; sequence Task 2 immediately after and confirm the flag clears. Do not add an ignore entry.

**Dependencies:** none. Foundation for every later task.

---

## Task 2: i18n foundation — device detection, active locale, catalog scaffold, init

Creates the whole `src/i18n/` core: pure device detection, the `activeLocale()` helper, the initial `en.ts`/`uk.ts` catalog (only the keys the early tasks need — Settings card, LanguageSwitch, calendar, common actions, categories; Task 10 grows it), the module augmentation, the key-parity test, and the side-effect init module.

**Files:**
- Create: `src/i18n/device-language.ts`, `src/i18n/device-language.test.ts`
- Create: `src/i18n/active-locale.ts`, `src/i18n/active-locale.test.ts`
- Create: `src/i18n/locales/en.ts`, `src/i18n/locales/uk.ts`, `src/i18n/locales/en.uk.parity.test.ts`
- Create: `src/i18n/i18next.d.ts`
- Create: `src/i18n/index.ts`

**Interfaces:**
- Produces:
  - `type AppLanguage = 'en' | 'uk'`
  - `deviceLanguage(): AppLanguage`
  - `activeLocale(): 'en-US' | 'uk-UA'`
  - `const en: { ... }` (default-ish shape; the canonical resource object)
  - `const uk: typeof en`
  - `i18n` (the initialized `i18next` instance), default export of `src/i18n/index.ts` re-export `export { deviceLanguage }`.

- [ ] **Step 1 (qa): Write the failing device-detection test**

```ts
// src/i18n/device-language.test.ts
import { deviceLanguage } from './device-language';

// deviceLanguage reads NativeModules.SettingsManager.settings.AppleLanguages[0].
// The RN preset leaves SettingsManager undefined under Jest, so the guarded
// fallback returns 'en'. To exercise the mapping, stub the native tag.
jest.mock('react-native', () => ({
  NativeModules: { SettingsManager: { settings: { AppleLanguages: ['uk-UA'] } } },
}));

describe('deviceLanguage', () => {
  it('maps a Ukrainian primary subtag to uk', () => {
    expect(deviceLanguage()).toBe('uk');
  });
});
```

Add a second file `src/i18n/device-language.fallback.test.ts` (separate module so its `jest.mock` differs):
```ts
// src/i18n/device-language.fallback.test.ts
import { deviceLanguage } from './device-language';

jest.mock('react-native', () => ({ NativeModules: {} }));

describe('deviceLanguage (no native settings)', () => {
  it('falls back to en when SettingsManager is absent', () => {
    expect(deviceLanguage()).toBe('en');
  });
});
```

- [ ] **Step 2 (qa): Run to verify it fails**

Run: `npx jest src/i18n/device-language`
Expected: FAIL — cannot find module `./device-language`.

- [ ] **Step 3 (developer): Implement `device-language.ts`**

```ts
// src/i18n/device-language.ts
import { NativeModules } from 'react-native';

export const appLanguages = ['en', 'uk'] as const;
export type AppLanguage = (typeof appLanguages)[number];

// The iOS-only, dependency-free device language read. SettingsManager is a
// React Native built-in; AppleLanguages is an ordered BCP-47 tag list, most
// preferred first. Only the primary subtag matters. Ukrainian and Russian
// speakers both get the Ukrainian catalog; everything else gets English.
export const deviceLanguage = (): AppLanguage => {
  const tag: string | undefined =
    NativeModules?.SettingsManager?.settings?.AppleLanguages?.[0];
  const primarySubtag = tag?.split('-')[0]?.toLowerCase();

  if (primarySubtag === 'uk' || primarySubtag === 'ru') {
    return 'uk';
  }

  return 'en';
};
```

- [ ] **Step 4 (qa): Run to verify device-detection tests pass**

Run: `npx jest src/i18n/device-language`
Expected: PASS.

- [ ] **Step 5 (qa): Write the failing active-locale test**

```ts
// src/i18n/active-locale.test.ts
import { activeLocale } from './active-locale';
import { i18n } from './index';

describe('activeLocale', () => {
  it('returns en-US for the English language', async () => {
    await i18n.changeLanguage('en');
    expect(activeLocale()).toBe('en-US');
  });

  it('returns uk-UA for the Ukrainian language', async () => {
    await i18n.changeLanguage('uk');
    expect(activeLocale()).toBe('uk-UA');
  });
});
```

- [ ] **Step 6 (developer): Implement the catalog scaffold, augmentation, init, and `active-locale.ts`**

`src/i18n/locales/en.ts` — start with exactly these namespaces (Task 10 extends them; keep alphabetical within a namespace):
```ts
// The canonical English catalog. This object is BOTH the runtime English
// resource AND the source of the catalog's TypeScript type (see i18next.d.ts).
// Every user-facing string lives here, namespaced by app area. uk.ts mirrors
// this exact key set.
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    done: 'Done',
  },
  settings: {
    title: 'Settings',
    baseCurrency: 'Base Currency',
    language: 'Language',
    categories: 'Categories',
  },
  language: {
    en: '🇬🇧 English',
    uk: '🇺🇦 Українська',
  },
  calendar: {
    month: {
      january: 'January',
      february: 'February',
      march: 'March',
      april: 'April',
      may: 'May',
      june: 'June',
      july: 'July',
      august: 'August',
      september: 'September',
      october: 'October',
      november: 'November',
      december: 'December',
    },
    weekday: {
      sun: 'Sun',
      mon: 'Mon',
      tue: 'Tue',
      wed: 'Wed',
      thu: 'Thu',
      fri: 'Fri',
      sat: 'Sat',
    },
  },
  categories: {
    groceries: 'Groceries',
    dining: 'Dining',
    transport: 'Transport',
    shopping: 'Shopping',
    utilities: 'Utilities',
    entertainment: 'Entertainment',
    health: 'Health',
    cash: 'Cash',
    transfers: 'Transfers',
    other: 'Other',
  },
} as const;
```

`src/i18n/locales/uk.ts` — the same key set, Ukrainian values, typed against `en`:
```ts
import type { en } from './en';

// The Ukrainian mirror. Its type is `typeof en`, so a missing or extra key is
// a tsc error here, and en.uk.parity.test.ts asserts the same at runtime.
export const uk: typeof en = {
  common: {
    save: 'Зберегти',
    cancel: 'Скасувати',
    delete: 'Видалити',
    done: 'Готово',
  },
  settings: {
    title: 'Налаштування',
    baseCurrency: 'Основна валюта',
    language: 'Мова',
    categories: 'Категорії',
  },
  language: {
    en: '🇬🇧 English',
    uk: '🇺🇦 Українська',
  },
  calendar: {
    month: {
      january: 'Січень',
      february: 'Лютий',
      march: 'Березень',
      april: 'Квітень',
      may: 'Травень',
      june: 'Червень',
      july: 'Липень',
      august: 'Серпень',
      september: 'Вересень',
      october: 'Жовтень',
      november: 'Листопад',
      december: 'Грудень',
    },
    weekday: {
      sun: 'Нд',
      mon: 'Пн',
      tue: 'Вт',
      wed: 'Ср',
      thu: 'Чт',
      fri: 'Пт',
      sat: 'Сб',
    },
  },
  categories: {
    groceries: 'Продукти',
    dining: 'Ресторани',
    transport: 'Транспорт',
    shopping: 'Покупки',
    utilities: 'Комунальні послуги',
    entertainment: 'Розваги',
    health: 'Здоровʼя',
    cash: 'Готівка',
    transfers: 'Перекази',
    other: 'Інше',
  },
};
```
Note for the implementer: the Ukrainian values above are the initial translations; treat them as final unless a native-speaker review corrects them — do not leave any value in English. The flag+label strings in `language.*` are intentionally identical in both catalogs (each language's endonym is shown in its own script).

`src/i18n/i18next.d.ts` — module augmentation:
```ts
import type { en } from './locales/en';

// Types t()/useTranslation off en.ts. Key 'settings.language' resolves; a typo
// like 'settings.langauge' fails tsc, so a wrong key is a compile error, not a
// runtime blank. defaultNS is the whole flattened en object under one namespace.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
```

`src/i18n/index.ts` — the side-effect init module:
```ts
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { deviceLanguage } from './device-language';
import { en } from './locales/en';
import { uk } from './locales/uk';

// Mirrors src/design-system/unistyles.ts: a side-effect module imported first
// in App.tsx, before any component that calls useTranslation renders, so the
// very first paint (including MigrationsGate's own UI) is in the device
// language. Initialized synchronously — resources are bundled, not fetched.
i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uk: { translation: uk },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const i18n = i18next;
export { deviceLanguage };
```

`src/i18n/active-locale.ts`:
```ts
import { match } from 'ts-pattern';

import { i18n } from './index';
import type { AppLanguage } from './device-language';

// The BCP-47 locale for Number.prototype.toLocaleString, off the active
// i18next language. uk-UA groups as `1 234,56` (space thousands, comma
// decimal); en-US as `1,234.56`. Only the numeric punctuation follows this —
// currency-symbol placement is decided by the format functions themselves.
export const activeLocale = (): 'en-US' | 'uk-UA' =>
  match((i18n.language ?? 'en') as AppLanguage | string)
    .with('uk', () => 'uk-UA' as const)
    .otherwise(() => 'en-US' as const);
```

- [ ] **Step 7 (qa): Write the key-parity test**

```ts
// src/i18n/locales/en.uk.parity.test.ts
import { en } from './en';
import { uk } from './uk';

// Every leaf key path present in en must be present in uk and vice versa. A
// nested object is walked depth-first into dotted paths ('calendar.month.january').
const leafPaths = (object: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object') {
      return leafPaths(value as Record<string, unknown>, path);
    }

    return [path];
  });

describe('en/uk catalog parity', () => {
  it('exposes the exact same key set in both languages', () => {
    expect(leafPaths(uk).sort()).toEqual(leafPaths(en).sort());
  });
});
```

- [ ] **Step 8 (qa): Run the i18n foundation tests to verify they pass**

Run: `npx jest src/i18n`
Expected: PASS (device-language, active-locale, parity). If `i18next`/`react-i18next` fail to parse, apply Task 1 Step 3's allow-list edit and re-run.

- [ ] **Step 9 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green. `check:knip` no longer flags `i18next`/`react-i18next` (now imported). Watch `check:knip` for `uk`/`activeLocale`/`deviceLanguage` reported unused — they become consumed in Tasks 3-8; accept only within this task's own worktree and confirm they clear by Task 8.

- [ ] **Step 10 (ops): Device-language verification is deferred to Final verification**

The `deviceLanguage()` native read (`NativeModules.SettingsManager`) cannot be exercised by Jest (mocked). Note it for the on-device build in Final verification: set the simulator to Ukrainian and confirm the app opens in Ukrainian with no explicit selection.

**Dependencies:** Task 1.

---

## Task 3: Settings column + migration + repo method

**Files:**
- Modify: `src/db/schema.ts:112-130` (the `settings` table)
- Create: `drizzle/migrations/0012_add_language.sql` (+ regenerated meta)
- Modify: `src/repositories/settings.repo.ts`
- Test: `src/repositories/settings.repo.test.ts` (add `setLanguage` coverage if the file exists; otherwise assert via schema + migration steps)

**Interfaces:**
- Produces:
  - `settings.language` column: `text('language', { enum: ['en', 'uk'] })`, nullable, no default. `SettingsRow['language']` is `'en' | 'uk' | null`.
  - `settingsRepo.setLanguage(lang: 'en' | 'uk'): Promise<void>`

- [ ] **Step 1 (developer): Add the column to `schema.ts`**

Inside the `settings` table object (after `lockGraceSeconds`, `src/db/schema.ts:129`):
```ts
  // The chosen UI language. NULL means "follow the device language" (the real,
  // distinct unset state — unlike baseCurrency, which always has a value); 'en'
  // / 'uk' is an explicit user choice made from Settings. Read by
  // useSyncLanguageWithSettings; written by settingsRepo.setLanguage.
  language: text('language', { enum: ['en', 'uk'] }),
```
Confirm `text` is already imported at the top of `schema.ts` (it is — `baseCurrency` uses it).

- [ ] **Step 2 (developer): Generate the migration**

Run:
```bash
npx drizzle-kit generate --name add_language
```
Expected output: a new `drizzle/migrations/0012_add_language.sql` containing `ALTER TABLE \`settings\` ADD \`language\` text;`, plus an updated `drizzle/migrations/meta/_journal.json` (new `idx: 12`, `tag: "0012_add_language"`) and a new `drizzle/migrations/meta/0012_snapshot.json`. Confirm the new migration is wired into the bundle exactly as the prior 11 were (the `.sql` is inline-imported via `babel-plugin-inline-import`; drizzle-kit updates the journal that `run-migrations.ts` reads). Do NOT hand-edit the generated SQL.

- [ ] **Step 3 (qa): Write the failing `setLanguage` test**

Model it on the existing `setBaseCurrency` test in `src/repositories/settings.repo.test.ts` (same `mockTx`/`write` override pattern). Add:
```ts
describe('settingsRepo.setLanguage', () => {
  it('updates the single settings row with the chosen language', async () => {
    // Reuse this file's existing write/tx fake; capture the update payload.
    await settingsRepo.setLanguage('uk');

    expect(lastUpdate).toEqual(
      expect.objectContaining({ set: expect.objectContaining({ language: 'uk' }) }),
    );
  });
});
```
Note for the implementer: match the exact capture shape the existing `setBaseCurrency` test uses in this file (it already asserts `.set({ baseCurrency })`); mirror that assertion for `language`.

- [ ] **Step 4 (qa): Run to verify it fails**

Run: `npx jest src/repositories/settings.repo.test.ts -t setLanguage`
Expected: FAIL — `setLanguage` is not a function.

- [ ] **Step 5 (developer): Add `setLanguage` to the repo**

In `src/repositories/settings.repo.ts`, after `setBaseCurrency` (`:16-19`):
```ts
  setLanguage: (language: 'en' | 'uk') =>
    write((tx) =>
      tx.update(settings).set({ language }).where(eq(settings.id, SETTINGS_ID)),
    ),
```
Keep it inside the `satisfies Repository` object.

- [ ] **Step 6 (qa): Run to verify it passes**

Run: `npx jest src/repositories/settings.repo.test.ts`
Expected: PASS.

- [ ] **Step 7 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green. `.jscpd.json` already excludes `*_snapshot.json`, so the near-identical new snapshot does not trip `check:dup` (root `CLAUDE.md` → "Documented exceptions"). `check:deps`/`check:knip` unaffected.

**Dependencies:** Task 2 (enum values agree with `AppLanguage`).

---

## Task 4: Settings-driven language sync + App wiring

**Files:**
- Create: `src/i18n/use-sync-language-with-settings.ts`
- Test: `src/i18n/use-sync-language-with-settings.test.ts`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `settingsRepo.getQuery` (`src/repositories/settings.repo.ts`), `useLiveQuery` (`src/db/use-live-query.ts`), `i18n` (`src/i18n/index.ts`).
- Produces: `useSyncLanguageWithSettings(): void`

- [ ] **Step 1 (qa): Write the failing hook test**

```ts
// src/i18n/use-sync-language-with-settings.test.ts
import { renderHook } from '@testing-library/react-native';

import { useSyncLanguageWithSettings } from './use-sync-language-with-settings';
import { i18n } from './index';

const mockData: { language: 'en' | 'uk' | null }[] = [];
jest.mock('../db/use-live-query', () => ({
  useLiveQuery: () => ({ data: mockData }),
}));
jest.mock('../repositories/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({}) },
}));

describe('useSyncLanguageWithSettings', () => {
  afterEach(async () => {
    mockData.length = 0;
    await i18n.changeLanguage('en');
  });

  it('changes the language when settings.language is set and differs', async () => {
    mockData.push({ language: 'uk' });
    renderHook(() => useSyncLanguageWithSettings());

    expect(i18n.language).toBe('uk');
  });

  it('leaves the device default in place when settings.language is null', async () => {
    await i18n.changeLanguage('en');
    mockData.push({ language: null });
    renderHook(() => useSyncLanguageWithSettings());

    expect(i18n.language).toBe('en');
  });
});
```

- [ ] **Step 2 (qa): Run to verify it fails**

Run: `npx jest src/i18n/use-sync-language-with-settings`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the hook**

```ts
// src/i18n/use-sync-language-with-settings.ts
import { useEffect } from 'react';

import { useLiveQuery } from '../db/use-live-query';
import { settingsRepo } from '../repositories/settings.repo';

import { i18n } from './index';

/**
 * Keeps the active i18next language in sync with the persisted choice. Reads the
 * settings row the same way settings.screen.tsx does. A non-null language that
 * differs from the current one triggers i18n.changeLanguage; a null value leaves
 * the device-detected default (set at init in src/i18n/index.ts) untouched.
 * Mounted once from AppRoot, after MigrationsGate (the settings table exists).
 */
export const useSyncLanguageWithSettings = (): void => {
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const language = data.at(0)?.language;

  useEffect(() => {
    if (language != null && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);
};
```

- [ ] **Step 4 (qa): Run to verify it passes**

Run: `npx jest src/i18n/use-sync-language-with-settings`
Expected: PASS.

- [ ] **Step 5 (developer): Wire `App.tsx`**

Add the side-effect import at the very top, right after the Unistyles import (`App.tsx:1-3`):
```ts
// Must run first alongside Unistyles: initializes the i18next instance with the
// device language as a side effect, before any component that calls
// useTranslation renders.
import './src/i18n';
```
Add the hook import to the import block:
```ts
import { useSyncLanguageWithSettings } from './src/i18n/use-sync-language-with-settings';
```
Call it inside `AppRoot`, alongside the existing effects (`App.tsx:24-30`):
```ts
const AppRoot: FC = () => {
  useEffect(() => {
    settingsRepo.ensure();
  }, []);

  useSyncLanguageWithSettings();

  useAutoSync();
```

- [ ] **Step 6 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Tasks 2, 3.

---

## Task 5: `LanguageSwitch` component

A segmented flag+label switch mirroring `CurrencySwitch`'s layout, delegating to the shared `OptionPills`. `OptionPills`' `icon` slot is SF-Symbol-only (renders through `SymbolIcon`) and cannot show a flag emoji, so the flag is composed INTO the `label` string — the same text-only-pill shape the lock-grace picker uses.

**Files:**
- Create: `src/design-system/components/language-switch/language-switch.component.tsx`
- Create: `src/design-system/components/language-switch/language-switch.props.d.ts`
- Create: `src/design-system/components/language-switch/index.ts`
- Test: `src/design-system/components/language-switch/language-switch.component.test.tsx`

**Interfaces:**
- Consumes: `OptionPills` (`../option-pills`), `useTranslation` (`react-i18next`).
- Produces:
```ts
// language-switch.props.d.ts
export type LanguageSwitchProps = {
  selected: 'en' | 'uk' | undefined;
  onSelect: (language: 'en' | 'uk') => void;
};
```

- [ ] **Step 1 (qa): Write the failing test**

Model on `currency-switch.component.test.tsx`:
```tsx
// language-switch.component.test.tsx
import { fireEvent, render } from '@testing-library/react-native';
import '../../unistyles';
import '../../../i18n';

import LanguageSwitch from '.';

describe('LanguageSwitch', () => {
  it('reports the pressed language through onSelect', () => {
    const onSelect = jest.fn();
    const { getByText } = render(<LanguageSwitch selected="en" onSelect={onSelect} />);

    fireEvent.press(getByText('🇺🇦 Українська'));

    expect(onSelect).toHaveBeenCalledWith('uk');
  });

  it('renders both flag+label pills', () => {
    const { getByText } = render(<LanguageSwitch selected="en" onSelect={jest.fn()} />);

    expect(getByText('🇬🇧 English')).toBeTruthy();
    expect(getByText('🇺🇦 Українська')).toBeTruthy();
  });

  it('marks the selected language via accessibilityState', () => {
    const { getByText } = render(<LanguageSwitch selected="uk" onSelect={jest.fn()} />);

    expect(getByText('🇺🇦 Українська').parent?.props.accessibilityState.selected).toBe(true);
    expect(getByText('🇬🇧 English').parent?.props.accessibilityState.selected).toBe(false);
  });
});
```

- [ ] **Step 2 (qa): Run to verify it fails**

Run: `npx jest src/design-system/components/language-switch`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the component, props, and index**

`language-switch.props.d.ts` — as in Interfaces above.

`language-switch.component.tsx`:
```tsx
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import OptionPills from '../option-pills';

import type { LanguageSwitchProps } from './language-switch.props';

const languageOptions = ['en', 'uk'] as const;

// A segmented language toggle. It delegates the pill markup to the shared
// OptionPills (like CurrencySwitch), but OptionPills' `icon` slot renders an SF
// Symbol through SymbolIcon and cannot draw a flag emoji, so the flag is
// composed into the `label` string instead — the text-only pill shape. The
// label copy lives in the catalog under `language.en` / `language.uk` (each an
// endonym in its own script), so it reads identically regardless of the active
// UI language.
const LanguageSwitch: FC<LanguageSwitchProps> = ({ selected, onSelect }) => {
  const { t } = useTranslation();

  return (
    <OptionPills
      options={languageOptions}
      selected={selected}
      onSelect={onSelect}
      label={(language) => t(`language.${language}`)}
    />
  );
};

export default LanguageSwitch;
```

`index.ts`:
```ts
export { default } from './language-switch.component';
```

- [ ] **Step 4 (qa): Run to verify it passes**

Run: `npx jest src/design-system/components/language-switch`
Expected: PASS.

- [ ] **Step 5 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

- [ ] **Step 6 (ops): Flag-emoji rendering is deferred to Final verification**

Jest's `toJSON` tree contains the emoji code points but cannot prove the device renders the 🇬🇧/🇺🇦 regional-indicator glyphs. Note for the on-device build: confirm both flags render as flags (not as letter pairs or tofu) in the Settings language pills.

**Dependencies:** Task 2 (the `language.*` catalog keys).

---

## Task 6: Settings language card

**Files:**
- Modify: `src/screens/settings/settings.screen.tsx`
- Test: `src/screens/settings/settings.screen.test.tsx` (if present; otherwise covered by Task 11 render tests)

**Interfaces:**
- Consumes: `LanguageSwitch` (Task 5), `settingsRepo.setLanguage` (Task 3), `deviceLanguage` (`../../i18n`), `useTranslation`.

- [ ] **Step 1 (qa): Write/extend the failing test**

If `settings.screen.test.tsx` exists, add:
```tsx
it('renders the language card and persists a language choice', () => {
  const { getByTestId, getByText } = render(<SettingsScreen navigation={nav} route={route} />);

  expect(getByTestId('settings-card-language')).toBeTruthy();

  fireEvent.press(getByText('🇺🇦 Українська'));

  expect(mockSetLanguage).toHaveBeenCalledWith('uk');
});
```
Note for the implementer: mock `settingsRepo` (add `setLanguage: jest.fn()` alongside the existing `setBaseCurrency` mock) and reuse the file's existing `useLiveQuery`/settings-row fixtures. If no `settings.screen.test.tsx` exists yet, skip this and rely on Task 11's per-language render test to cover the card.

- [ ] **Step 2 (developer): Add the card**

Add imports:
```ts
import { useTranslation } from 'react-i18next';
import LanguageSwitch from '../../design-system/components/language-switch';
import { deviceLanguage } from '../../i18n';
```
Inside the component, alongside `handleSelectCurrency`:
```ts
const { t } = useTranslation();

const handleSelectLanguage = (language: 'en' | 'uk'): void => {
  settingsRepo.setLanguage(language);
};

// The effective language shown as selected: the explicit choice if set,
// otherwise the device-detected default. null in the DB means "follow device".
const effectiveLanguage = settings?.language ?? deviceLanguage();
```
Add the card after the base-currency card (`settings.screen.tsx:48-56`), following its exact `GlassSurface` → `SettingsRow` shape:
```tsx
<GlassSurface testID="settings-card-language" padding={3}>
  <SettingsRow testID="settings-row-language" icon="globe" label={t('settings.language')}>
    <LanguageSwitch selected={effectiveLanguage} onSelect={handleSelectLanguage} />
  </SettingsRow>
</GlassSurface>
```
Also swap the two existing hardcoded `SettingsRow` labels on this screen to catalog keys as part of this card's work: `label="Base Currency"` → `label={t('settings.baseCurrency')}`, `label="Categories"` → `label={t('settings.categories')}`. Verify `globe` is available on the device's iOS version before relying on it (memory: SF Symbols availability — `globe` is long-standing and safe; if any symbol renders blank, pick an available alternative).

- [ ] **Step 3 (qa): Run to verify it passes (if a test exists)**

Run: `npx jest src/screens/settings/settings.screen.test.tsx`
Expected: PASS.

- [ ] **Step 4 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Tasks 3, 5.

---

## Task 7: Locale-aware money & compact-money formatting

Thread `activeLocale()` through the three formatting functions' `locale` parameter at their call sites. `formatMoney` is wrapped almost everywhere by `MoneyText`, so making `MoneyText` locale-aware (and reactive to a language change) covers the bulk; `formatCompactMoney` is called only in `net-worth-line`.

**Files:**
- Modify: `src/design-system/components/money-text/money-text.component.tsx:73`
- Modify: `src/design-system/components/net-worth-line/net-worth-line.component.tsx:135-136` (and its `formatCompactMoney` call)
- Test: `src/currency/format.test.ts`, `src/currency/compact.test.ts` (add uk-UA grouping cases)

**Interfaces:**
- Consumes: `activeLocale()` (Task 2).

- [ ] **Step 1 (qa): Add the failing Ukrainian grouping tests**

In `src/currency/format.test.ts`:
```ts
it('groups with a space and comma decimal for uk-UA', () => {
  // 1 234,56 ₴ — space thousands separator, comma decimal, UAH symbol suffixed.
  const money = { currency: 'UAH', minorUnits: 123_456 } as const;
  const formatted = formatMoney(money, 'uk-UA');

  expect(formatted).toBe('1 234,56 ₴');
});
```
In `src/currency/compact.test.ts`:
```ts
it('groups compact thousands with a space for uk-UA', () => {
  // 1 234K ₴ style grouping under uk-UA.
  const unit = chooseCompactUnit([1_234_000]);
  const formatted = formatCompactMoney(1_234_000, 'UAH', unit, 'uk-UA');

  expect(formatted).toContain(' ');
});
```
Note for the implementer: `uk-UA` grouping uses a NARROW NO-BREAK SPACE (` ` or ` ` depending on the ICU build); assert on the presence of a non-ASCII space rather than a literal `' '`. Run the test once to see which code point this RN/Hermes build emits, then pin the assertion to it.

- [ ] **Step 2 (qa): Run to verify the new cases fail or confirm current behavior**

Run: `npx jest src/currency/format.test.ts src/currency/compact.test.ts`
Expected: the new uk-UA cases pass immediately IF the functions already honor a passed locale (they do — the `locale` param exists). These tests lock in the behavior the call-site changes depend on; if they pass, they are a regression guard. If the space code point differs, adjust per the note above.

- [ ] **Step 3 (developer): Make `MoneyText` locale-aware and reactive**

`MoneyText` reads no locale today (`formatMoney(money)` at `:73`). Subscribe to the active language so a switch re-renders it, and pass the locale:
```ts
import { useTranslation } from 'react-i18next';
import { activeLocale } from '../../../i18n/active-locale';
```
Inside `MoneyText`, before the `return`:
```ts
  // Subscribe to the active language so the amount re-formats when the user
  // switches languages; activeLocale() then supplies the grouping locale.
  useTranslation();
```
Change the render line:
```tsx
{formatMoney(money, activeLocale())}
```

- [ ] **Step 4 (developer): Thread locale through `net-worth-line`**

In `net-worth-line.component.tsx`:
- `formatAxisTime` (`:135-136`) — replace the hardcoded `'en-US'` with `activeLocale()`:
```ts
const formatAxisTime = (t: number): string =>
  new Date(t).toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric' });
```
- Its `formatCompactMoney(...)` call — add `activeLocale()` as the trailing `locale` argument.
- Add the import `import { activeLocale } from '../../../i18n/active-locale';`.
Note: `formatAxisTime` is a module-scope helper, so it reads `activeLocale()` at call time (fine — the chart re-renders on language change because the component subscribing via `useTranslation` is not guaranteed here; if the axis labels do not refresh on switch during the device check, hoist a `useTranslation()` subscription into the `net-worth-line` component body, same as `MoneyText`).

- [ ] **Step 5 (developer): Audit remaining direct `formatMoney`/`formatCompactMoney` call sites**

Grep to confirm no OTHER runtime call site passes the default locale:
```bash
rg "formatMoney\(|formatCompactMoney\(|compactNumber\(" src --type ts --type tsx -n
```
Every non-test runtime call must pass `activeLocale()`. As of writing, `MoneyText` (Step 3) and `net-worth-line` (Step 4) are the only two runtime consumers; `compactNumber` is module-private to `compact.ts`. If the grep surfaces a new one, thread `activeLocale()` there too.

- [ ] **Step 6 (qa): Run to verify**

Run: `npx jest src/currency src/design-system/components/money-text src/design-system/components/net-worth-line`
Expected: PASS.

- [ ] **Step 7 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Task 2.

---

## Task 8: Calendar header spelled-out names → catalog

**Files:**
- Modify: `src/screens/calendar/calendar-header/calendar-header.component.tsx:11-28,37,89`
- Test: `src/screens/calendar/calendar-header/calendar-header.component.test.tsx` (if present; else Task 11)

**Interfaces:**
- Consumes: `useTranslation`; catalog keys `calendar.month.*`, `calendar.weekday.*` (seeded in Task 2).

- [ ] **Step 1 (qa): Write/extend the failing test**

```tsx
it('renders the visible month name from the catalog', () => {
  // A March date -> the catalog's month label. Under English, 'March'.
  const { getByText } = render(<CalendarHeader month={new Date(2026, 2, 1)} addMonth={jest.fn()} />);

  expect(getByText(/March/)).toBeTruthy();
});
```
Wrap the render with the i18n side-effect import (`import '../../../i18n';`) as the LanguageSwitch test does.

- [ ] **Step 2 (developer): Replace the literal arrays with catalog lookups**

Replace `MONTH_NAMES` (`:11-24`) and `WEEKDAY_NAMES` (`:28`) with stable key arrays, and look up via `t()`:
```ts
const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

// Sunday-first, matching react-native-calendars' default firstDay (0).
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
```
Inside the component add `const { t } = useTranslation();`, then:
```ts
const title = `${t(`calendar.month.${MONTH_KEYS[visible.getMonth()]}`)} ${visible.getFullYear()}`;
```
and in the weekday row, map `WEEKDAY_KEYS` and render `t(\`calendar.weekday.${day}\`)`, keying the `Box` on the stable `day` key.

- [ ] **Step 3 (qa): Run to verify it passes**

Run: `npx jest src/screens/calendar/calendar-header`
Expected: PASS.

- [ ] **Step 4 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Task 2.

---

## Task 9: Bulk string extraction (the largest task — split into reviewable groups)

Every remaining hardcoded user-facing English string in `~37` `.tsx` files under `src/` moves into `en.ts` (with a `uk.ts` mirror) and is read via `t('...')`. This is the bulk of the effort. **Split it by screen area into independently reviewable sub-tasks (9A–9F), each a full TDD cycle ending in `npm run check:all` green and a self-contained catalog delta.** Doing all 37 files in one commit is unreviewable; a reviewer must be able to accept one area while questioning another.

**The mechanical pattern, applied in every sub-task:**
1. In the target file, find each hardcoded string in a `label=`, `placeholder=`, `title=`, `accessibilityLabel=`, or JSX text-child position that a user reads.
2. Add a namespaced key for it to `en.ts` (grouped by the file's area) and its Ukrainian value to `uk.ts` — both in the SAME edit so the parity test never goes red mid-task.
3. Add `const { t } = useTranslation();` to the component and replace the literal with `t('area.key')`.
4. For any pluralized count string, use i18next plural suffixes (`area.thing_one`/`_other` in `en.ts`; `_one`/`_few`/`_many`/`_other` in `uk.ts`) and call `t('area.thing', { count })`.
5. Do NOT touch user-typed values, SF Symbol names, `testID`s, or numeric-date formatting.

**Do NOT extract strings in `*.test.tsx` files** — test-owned literals are not user-facing. The count `~37` refers to app source files.

**Per-sub-task steps (identical shape — run for each of 9A–9F):**
- [ ] Step 1 (qa): For one representative string per file in the group, write/extend a render assertion that the catalog value appears (English). Keep it light — one or two `getByText`/`getByLabelText` per file, not exhaustive.
- [ ] Step 2 (qa): Run the group's tests to confirm they fail (string not yet keyed / test asserts the new path).
- [ ] Step 3 (developer): Apply the mechanical pattern to every file in the group; extend `en.ts` + `uk.ts` together.
- [ ] Step 4 (qa): Run `npx jest <group paths>` and `npx jest src/i18n/locales/en.uk.parity.test.ts` — both green.
- [ ] Step 5 (ops): `npm run check:all` — green. Watch `check:lint`'s `noExcessiveCognitiveComplexity` (adding `t()` calls rarely trips it, but a large JSX file might); decompose if needed.

**Group 9A — Settings & Categories area**
Files: `src/screens/settings/settings.screen.tsx` (any labels not already done in Task 6), `src/screens/settings/add-category-row/add-category-row.component.tsx`, `src/screens/settings/app-lock-setting/app-lock-setting.component.tsx`, `src/screens/settings/categories.screen.tsx`, `src/screens/settings/settings-row/` (labels passed in, no literals of its own — verify). Namespace: `settings.*`, `categories.*`.

**Group 9B — Forms area**
Files under `src/screens/forms/`: `transaction-form.screen.tsx`, `account-form.screen.tsx`, `holding-form.screen.tsx`, `contribution-form.screen.tsx`, `category-field/`, `color-picker/`, `date-field/`, and any other field components with literal `label`/`placeholder`. Namespace: `forms.*` (sub-group by form, e.g. `forms.transaction.*`). This is the largest group — if it exceeds a comfortable single-review size, split into 9B-i (the four `*.screen.tsx` forms) and 9B-ii (the shared field components).

**Group 9C — Account & Holding detail area**
Files: `src/screens/account-detail/account-detail.screen.tsx`, `src/screens/account-detail/binance-credentials-field/`, `crypto-sync-section/`, `monobank-token-field/`, `wallet-address-field/`, `src/screens/holding-detail/holding-detail.screen.tsx`. Namespace: `accountDetail.*`, `holdingDetail.*`.

**Group 9D — Home, Statistics & Calendar chrome**
Files: `src/screens/home/home.screen.tsx`, `src/screens/home/filter-menu/`, `src/screens/home/transaction-filter-bar/transaction-filter-bar.component.tsx`, `src/screens/statistics/statistics.screen.tsx`, and any remaining calendar-screen chrome not covered by Task 8. Namespace: `home.*`, `statistics.*`. Pluralized transaction/holding counts here use the `_one`/`_few`/`_many`/`_other` suffix pattern.

**Group 9E — Accounts list & entity headers**
Files: `src/screens/accounts/*`, `src/screens/entity-amount-header/`, `src/screens/entity-header-icon/`, `src/screens/edit-header-button/`, `src/screens/card-context-menu/`, `src/screens/icon-editor/`. Namespace: `accounts.*`, `common.*` (reuse `common.save`/`common.cancel`/`common.delete`/`common.done` for shared action labels rather than duplicating).

**Group 9F — Shared design-system components**
Files under `src/design-system/components/` that hold literal user-facing copy (e.g. any placeholder/empty-state text in `text-field`, `bottom-sheet`, `swipeable-row`, `currency-breakdown`, empty-state labels). Namespace: `common.*` / `components.*`. Most design-system primitives take their copy as props (already externalized) — extract only genuine hardcoded literals; do NOT invent keys for prop-driven text.

- [ ] **Final step of Task 9 (ops): Full extraction checkpoint**

Run: `npm run check:all` and `rg ">[A-Z][a-z]+ " src --type tsx -g '!*.test.tsx'` to spot any missed literal JSX text. Confirm no user-facing English literal remains in app source (a hit inside a comment, a `testID`, an SF Symbol name, or a user-typed default is fine). Confirm the parity test is green.

**Dependencies:** Task 2 (catalog + augmentation exist). Independent of Tasks 3-8; parallelizable across the six groups only if each group edits `en.ts`/`uk.ts` in a coordinated way (the catalog files are shared — sequence the groups, or use a single-editor-per-worktree discipline per memory "Single editor per shared worktree").

---

## Task 10: Default-category translation

Translate the ten seeded default categories by their stable `key` slug — but ONLY when the row's `title` still equals its English seed title (i.e. the user has not renamed it). A renamed category shows the user's stored `title` verbatim in either language.

**Files:**
- Create: `src/i18n/default-category-title.ts`
- Test: `src/i18n/default-category-title.test.ts`
- Modify: `src/categories/category-display.ts` (`buildCategoryDisplayMap` / `resolveCategoryDisplay` path)

**Interfaces:**
- Consumes: `t` from the active i18next instance (`i18n.t`), catalog keys `categories.*` (Task 2).
- Produces:
  - `const DEFAULT_CATEGORY_SEED_TITLES: Record<string, string>` — the `key → English seed title` map, sourced verbatim from `drizzle/migrations/0002_seed_categories.sql`.
  - `resolveDefaultCategoryTitle(key: string, storedTitle: string): string` — returns the translated `categories.<key>` label when `storedTitle === DEFAULT_CATEGORY_SEED_TITLES[key]`; otherwise returns `storedTitle` unchanged.

- [ ] **Step 1 (qa): Write the failing test**

```ts
// src/i18n/default-category-title.test.ts
import { resolveDefaultCategoryTitle } from './default-category-title';
import { i18n } from './index';

describe('resolveDefaultCategoryTitle', () => {
  it('translates a seeded category still at its English seed title', async () => {
    await i18n.changeLanguage('uk');
    expect(resolveDefaultCategoryTitle('groceries', 'Groceries')).toBe('Продукти');
  });

  it('leaves a user-renamed category untouched in either language', async () => {
    await i18n.changeLanguage('uk');
    expect(resolveDefaultCategoryTitle('groceries', 'Магазин біля дому')).toBe('Магазин біля дому');
  });

  it('returns the English label under the English language', async () => {
    await i18n.changeLanguage('en');
    expect(resolveDefaultCategoryTitle('groceries', 'Groceries')).toBe('Groceries');
  });

  it('leaves an unknown key untouched', async () => {
    expect(resolveDefaultCategoryTitle('custom-key', 'My Category')).toBe('My Category');
  });
});
```

- [ ] **Step 2 (qa): Run to verify it fails**

Run: `npx jest src/i18n/default-category-title`
Expected: FAIL — module not found.

- [ ] **Step 3 (developer): Implement the translator**

```ts
// src/i18n/default-category-title.ts
import { i18n } from './index';

// The exact English seed titles from drizzle/migrations/0002_seed_categories.sql,
// keyed by stable slug. A row whose title still equals its seed title is an
// un-renamed default and is safe to translate; any other title is user-typed and
// must be shown verbatim. This map is the ONLY link between the seed and the
// display layer — no schema "is default" flag exists.
const DEFAULT_CATEGORY_SEED_TITLES: Record<string, string> = {
  groceries: 'Groceries',
  dining: 'Dining',
  transport: 'Transport',
  shopping: 'Shopping',
  utilities: 'Utilities',
  entertainment: 'Entertainment',
  health: 'Health',
  cash: 'Cash',
  transfers: 'Transfers',
  other: 'Other',
};

/**
 * The display title for a category, translated only when it is an un-renamed
 * seeded default. If the stored title still matches the English seed title for
 * its key, return the catalog's translated label (categories.<key>); otherwise
 * the user has renamed it (or it is a custom category), so return the stored
 * title unchanged. Never mutates a row.
 */
export const resolveDefaultCategoryTitle = (key: string, storedTitle: string): string => {
  const seedTitle = DEFAULT_CATEGORY_SEED_TITLES[key];

  if (seedTitle !== undefined && storedTitle === seedTitle) {
    return i18n.t(`categories.${key}`);
  }

  return storedTitle;
};
```

- [ ] **Step 4 (developer): Wire it into the category display layer**

In `src/categories/category-display.ts`, apply `resolveDefaultCategoryTitle` where a category's `title` becomes display text. `buildCategoryDisplayMap` (`:33-41`) builds `{ title, icon, color }` per key — translate the title there:
```ts
import { resolveDefaultCategoryTitle } from '../i18n/default-category-title';
```
```ts
      { title: resolveDefaultCategoryTitle(category.key, category.title), icon: category.icon, color: category.color ?? null },
```
Note for the implementer: confirm `buildCategoryDisplayMap` is the single choke point every screen resolves a category display through (it is documented as such at `:28-32`). If a screen reads `category.title` directly bypassing the map, route it through `resolveDefaultCategoryTitle` too. Because `buildCategoryDisplayMap` is called inside a `useLiveQuery`-driven render, the translation re-computes on a language change only if the consuming screen re-renders — the settings live-query update that follows `changeLanguage` and the `useTranslation` subscriptions added in Task 9 cover the visible screens; verify on-device that categories re-label on switch.

- [ ] **Step 5 (qa): Run to verify it passes**

Run: `npx jest src/i18n/default-category-title src/categories`
Expected: PASS (new translator tests + existing `category-display.test.ts` still green — the un-renamed English case returns the same English string, so existing assertions hold under the default `en` language).

- [ ] **Step 6 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Task 2 (`categories.*` keys).

---

## Task 11: Per-language render tests

Prove that a screen renders its catalog strings for the active language.

**Files:**
- Test: `src/screens/settings/settings.screen.test.tsx` (extend or create)
- Test: one additional screen test (e.g. `src/screens/calendar/calendar.screen.test.tsx` or a forms screen)

- [ ] **Step 1 (qa): Write the Settings language render tests**

```tsx
import { i18n } from '../../i18n';

describe('SettingsScreen — localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders English catalog strings under en', async () => {
    await i18n.changeLanguage('en');
    const { getByText } = render(<SettingsScreen navigation={nav} route={route} />);

    expect(getByText('Base Currency')).toBeTruthy();
    expect(getByText('Language')).toBeTruthy();
  });

  it('renders Ukrainian catalog strings under uk', async () => {
    await i18n.changeLanguage('uk');
    const { getByText } = render(<SettingsScreen navigation={nav} route={route} />);

    expect(getByText('Основна валюта')).toBeTruthy();
    expect(getByText('Мова')).toBeTruthy();
  });
});
```

- [ ] **Step 2 (qa): Write a second screen's per-language render test**

Pick a screen with several catalog strings (calendar header via the calendar screen, or a forms screen). Assert one English and one Ukrainian catalog string render after `i18n.changeLanguage`. Mirror the `afterEach` reset to `'en'` so test order is deterministic.

- [ ] **Step 3 (qa): Run to verify they pass**

Run: `npx jest src/screens/settings src/screens/calendar`
Expected: PASS.

- [ ] **Step 4 (ops): Checkpoint**

Run: `npm run check:all`
Expected: green.

**Dependencies:** Tasks 6, 8, 9.

---

## Final verification

- [ ] **(ops): Full check**

Run: `npm run check:all`
Expected: green across lint, dup, knip, deps, security, secrets, overrides. `check:deps` shows the two added dependency lines for confirmation (`i18next`, `react-i18next`) — this is the expected changed-dependency surface, not a failure.

- [ ] **(ops): Deep check before declaring done**

Run: `npm run check:deep`
Expected: mutation score at/above threshold; osv-scanner reports ONLY the known-accepted CVEs documented in the root `CLAUDE.md`. Confirm `i18next`/`react-i18next` introduce no new advisory; if one appears, pin via `overrides` (or accept-and-document per the harness rules) — do not suppress.

- [ ] **(qa): Full Jest run**

Run: `npx jest`
Expected: all suites pass, including the key-parity test.

- [ ] **(ops): On-device / simulator verification (cannot be proven by Jest)**

Rebuild and run on a device/simulator (do NOT screenshot for design review — rebuild and let the user review live, per memory "No screenshots for design review"):
1. **Device-language default** — set the simulator system language to Ukrainian, cold-launch the app with NO prior language choice: the first paint (including `MigrationsGate`) is Ukrainian. Set it to English (or any non-uk/ru): the app opens in English.
2. **Explicit choice + persistence** — pick 🇺🇦 Українська in Settings: the whole app relabels live (money grouping switches to `1 234,56`, categories re-label, calendar months in Ukrainian). Kill and relaunch: the choice persists (the `settings.language` column). Pick 🇬🇧 English: it switches back.
3. **Flag-emoji rendering** — both 🇬🇧 and 🇺🇦 render as flags (not letter pairs / tofu) in the Settings language pills.
4. **Un-renamed vs renamed categories** — a default category shows its Ukrainian label; a category the user renamed shows the user's exact text in both languages.

---

## Self-Review

**1. Spec coverage**
- A. Library + device detection → Task 1 (deps, min-age handling) + Task 2 (`deviceLanguage`, dependency-free `SettingsManager` read, `uk`/`ru`→`uk` mapping). ✓
- B. Message catalog (`src/i18n/` folder, `index.ts`, `locales/en.ts`, `locales/uk.ts`, namespacing, module augmentation, CLDR plural suffixes) → Task 2 (scaffold + augmentation + parity) and Task 9 (plural suffixes applied). ✓
- C. Persistence + state flow (nullable `language` column, `0012_add_language.sql`, synchronous init at top of `App.tsx`, `useSyncLanguageWithSettings`, `settingsRepo.setLanguage`) → Tasks 3, 4. ✓
- D. Settings UI (`LanguageSwitch` over `OptionPills` with flag composed into `label`, `settings-card-language`) → Tasks 5, 6. ✓
- E. Dates + numbers (`activeLocale()`, thread through `formatMoney`/`compactNumber`/`formatCompactMoney` call sites, numeric dates unchanged, `calendar-header` + `formatAxisTime` spelled names) → Tasks 2 (`activeLocale`), 7 (money + `formatAxisTime`), 8 (calendar). ✓
- F. Default category translation by stable key when not user-renamed → Task 10. ✓
- G. Testing (key parity, `LanguageSwitch` unit, uk grouping, per-language render) → Tasks 2, 5, 7, 11. ✓
- H. Out of scope (no third language, no RTL, no remote catalog, no user-text translation) honored throughout — Global Constraints. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"implement later". Bulk extraction (Task 9) is the one area that cannot enumerate all 37 files' every string inline; it is instead given a concrete mechanical pattern, an exact file grouping (9A–9F sourced from a real `rg` inventory), a namespacing scheme, and a per-sub-task TDD cycle — the actionable substitute for pasting 37 files, and explicitly the plan's largest, split-for-review task per the requirement.

**3. Type consistency:** `AppLanguage = 'en' | 'uk'` (Task 2) matches the schema enum (Task 3), `LanguageSwitchProps.selected` (Task 5), `setLanguage` param (Task 3), and `handleSelectLanguage` (Task 6). `activeLocale(): 'en-US' | 'uk-UA'` is consumed identically in Tasks 7. `resolveDefaultCategoryTitle(key, storedTitle)` signature matches its Task 10 call site in `buildCategoryDisplayMap`. `deviceLanguage()` is re-exported from `src/i18n/index.ts` and imported as such in Tasks 4, 6.

**4. Device-only gaps flagged:** device-language detection (Task 2 Step 10), flag-emoji rendering (Task 5 Step 6), and live relabel/persistence (Task 10 Step 4) are all gathered in Final verification's on-device step — Jest cannot prove them.
