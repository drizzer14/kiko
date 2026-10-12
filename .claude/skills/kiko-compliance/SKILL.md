---
name: kiko-compliance
description: Invoke when reviewing any diff, and whenever a change touches a feature's visibility or completeness, a native permission, a network domain or third-party API, a privacy/data-collection path, app metadata (screenshots/description), a third-party trademark or logo, an analytics/tracking dependency, encryption, a code-update or remote-code path, in-app purchase, or a login/account-deletion flow. Read before approving any diff for merge.
---

# Kiko App Store compliance

Source of truth: Apple's App Store Review Guidelines
(https://developer.apple.com/app-store/review/guidelines/). This skill
does not restate them — it is a reviewer checklist that turns the
guidelines most relevant to a personal-finance app into questions to
ask of a diff, and points at the mechanized check or doc that already
covers part of the answer. Kiko was rejected TWICE under Guideline 5.6
(hidden features, build 7); this skill exists to make that class of
rejection a code-review question on every diff, not a resubmission
surprise.

Ask every question below of the diff you are reviewing. Report each
compliance finding explicitly, separate from correctness and
over-engineering findings — name the guideline number.

## 5.6 — Developer Code of Conduct (hidden features)

The rejection guideline. Full rule, rationale, and known limits of the
mechanized check live in `.claude/skills/kiko-architecture/SKILL.md`
("Guideline 5.6 — no hidden features") — read that section, do not
re-derive it here. In short, ask:

- Does this diff add or keep an `@env` flag (a `SHOW_*`/`HIDE_*`-style
  control, or any other build/runtime flag) that gates whether a
  feature or UI is visible in a release build?
- Does this diff import a demo/seed/screenshot/fake-data module from
  app `src/`?
- Does this diff leave a not-ready feature reachable-but-hidden
  instead of physically removing its code paths?

Mechanized: the Semgrep rule `kiko-no-hidden-feature-flag-or-demo-import`
(`rules/semgrep-mobile.yml`, Class A ERROR, runs under
`npm run check:security`) catches a `SHOW_*`/`HIDE_*`/`SCREENSHOT_*`
`@env` import, a static import whose specifier contains `e2e/`, and a
dynamic `require(...)` whose specifier contains `e2e/`. It does NOT
catch a differently-named visibility flag (e.g. `ENABLE_*`) or a demo
import reached through a path alias that omits `e2e/` — that gap is
why this is still a reviewer question, not only a CI gate.

**Reviewability — the demo dataset must reach every feature.** The
reviewer's `.kiko` must be readable by the submitted build
(`READABLE_EXPORT_VERSIONS` in `src/data-transfer/crypto/envelope.ts`): a
build older than an export-version bump attaches the frozen older copy
(`e2e/screenshot/fixtures/kiko-demo-en-1.1.kiko`). The App
Store reviewer imports `e2e/screenshot/fixtures/kiko-demo-en.kiko`
(built from `e2e/screenshot/seed/screenshot-seed.ts`, see that folder's
README) through the real Import UI; a feature the dataset never shows is
one the reviewer cannot reach. Mechanized: `generate-demo-kiko.test.ts`
fails unless every `accounts.kind`, every `holdings.type`, and every
`reminders.kind` enum member appears (each reminder on an account eligible
for its kind, with a valid schedule — read the test for the exact checks), and `build-demo-snapshot.test.ts` fails unless every holding
with no ledger of its own (the set `isLedgerlessHoldingType` in
`src/holdings/holding-descriptor/holding-descriptors.ts` defines — read it
there) values to non-zero through the app's own valuation, the demo dataset also holds a transaction
template of every mode (`TEMPLATE_MODES` in `src/transaction-templates/draft/template-draft.ts`;
`e2e/screenshot/seed/screenshot-seed.test.ts` pins one per stored mode; 
`src/screens/forms/transaction-form/transaction-form.demo-templates.test.ts` reads the committed
`kiko-demo-en`/`kiko-demo-uk` `.kiko` files as data and pins that every demo template fills in its
own mode with every reference seated, while `generate-demo-kiko.test.ts` proves those files equal
the seed builder), each referencing holdings and a
category in the snapshot (`build-demo-snapshot.test.ts`), reachable from the Templates list
(Settings > Transaction templates), the demo holds at
least one bank account per connectable catalog bank (derived from `bankCatalog`,
not a count) plus one Other bank, and every demo account keeps `institution`
null (no auto-sync starts on a demo account). A diff that adds an account
kind or a holding type must add it to the dataset and regenerate both
`.kiko` files (`KIKO_REGEN_DEMO=1 npx jest
e2e/screenshot/fixtures/generate-demo-kiko.test.ts`), or any change to
the snapshot shape: a new table, a new `settings` column, or a changed
column default. Regenerate in the same commit as the migration
(`KIKO_REGEN_DEMO=1 npx jest
e2e/screenshot/fixtures/generate-demo-kiko.test.ts`). A new visible
feature that is not a new kind or type (a new metadata option, a new
linked-row flow) is still a judgment question: does the dataset show it?
Dates also derive from a regen-time anchor, so the files go sparse, then
empty, within weeks: regenerate both and refresh the reviewer kit for every
submission and resubmission (see "The anchor" in the fixtures README).

## 2.1 completeness / 4.2 minimum functionality

Ask: does this diff ship a placeholder screen, a button or action that
does nothing, a user-facing TODO, or a flow that is reachable but
incomplete/broken? No mechanized check covers this — judgment only.

## 2.3 accurate metadata

Ask: does this diff change or remove a feature that a shipped App
Store screenshot or description promises? App Store Connect metadata
itself is not tracked in this repo; the drafted reviewer notes and App
Privacy labels live in the coordinator's `memory/refs/resubmission-kit.md`
(sections A/B) — flag when a diff would make that draft stale. The
manual marketing screenshot procedure (there is no automated capture
any more) is documented in `docs/harness/screenshots-check.md`; flag
when a diff changes a screen one of the 10 shipped shots depicts.

Always write a demo invariant over the domain predicate
(`isLedgerlessHoldingType`), never a pinned count. When a feature needs a
user credential the demo cannot carry, the reviewer notes must supply it
or say how to get it.

## 5.1.1 / 5.1.2 — data collection and privacy

Ask: does this diff add a new network call, a new field sent off-device,
or a new SDK that collects data? Any of those needs an App Privacy
label review — point to the coordinator's
`memory/refs/resubmission-kit.md` section D (the App Privacy label
answers: what's declared, what's not, and why) and to
`ios/Kiko/PrivacyInfo.xcprivacy`, the privacy manifest a native module
may need to declare a required-reason API for.

A new third-party data recipient also needs the privacy policy updated
(`docs/privacy-policy*.md` §3), not only the App Privacy answers. There
is no EODHD entry (removed with the shares cut, Guideline 5.6). The live
gh-pages policy may still name EODHD until the edited policy is
published: check the live policy before an upload.

## 5.1.5 / data storage — secrets never in `.env`, logs, or the DB

Ask: does this diff put a secret (a token, an API key, a signing key)
into `.env`, a log line, or a database column? The rule and its
rationale (`.env` is inlined into the JS bundle at build time, so
anything there ships in plaintext) are in
`docs/harness/dependency-hygiene.md` ("`.env` is public-only") — read
that section. A secret belongs in the iOS Keychain
(`react-native-keychain`); see `.claude/skills/kiko-architecture/SKILL.md`
for the existing Keychain-backed examples (the Monobank token, the
SQLCipher database key in `src/db/keys/db-key.ts`, the Binance credentials in
`src/crypto-sync/binance/binance.credentials.ts` — read that file for its
service name and `accessible` policy, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` at
the time of writing).

A credential that travels in a request URL (an `api_token` query parameter;
no client sends one today) or a request header (`X-Token`, `X-MBX-APIKEY`)
is a disk leak path through NSURLCache (`Cache.db` stores the response under
its URL, together with the request object and its headers). Always send the
request header `Cache-Control: no-store` on every such request (every
Monobank and Binance request does); `npm run check:plist` fails a
credential client without it. `AppDelegate.purgeStoredURLCacheOnce` cleared
the rows builds before that stored. Verified on macOS CFNetwork: a per-request
`cachePolicy` does NOT prevent the store, and React Native fetch's
`cache: 'no-store'` only appends a `_=` cache-buster (a new cached URL per
call). Never log the request URL, and give every error a fixed message (a
rejected fetch can carry the URL).

A log line is a leak path even without a secret in the code: React Native
forwards every `console` level to os_log in a Release build, and an error
object's message can carry user data (a DrizzleQueryError's message holds
the SQL params: bank descriptions, amounts). So a swallowed failure logs
through `logFailure(tag, error)` from `@kiko/diagnostics`, which logs only
the error's `name` and a string or number `code`, in every build. Never its
message, cause, or params. Pass `console.*` only literals: a string or
template tag, and an object literal of counts or ids.

```ts
// wrong
console.warn('[binance sync] transaction history import failed', error);

// correct
import { logFailure } from '@kiko/diagnostics';

logFailure('[binance sync] transaction history import failed', error);
```

A step whose failure is only logged and swallowed goes through
`logOnFailure(tag, task)` (same package) instead of a hand-rolled
`either` + `logFailure`: it never rejects, and it resolves `false` when
the task failed, so a caller that must report the failure can.

Mechanized: `kiko-no-raw-error-in-console` (`rules/semgrep-prewrite.yml`,
ERROR). It flags a `console.*` argument that is not a string, template, or
object literal, and a string or template literal joined with `+` anywhere
inside an argument (`console.warn('[x] failed: ' + error)`, because
`String(error)` includes the message). The `+` arm also fires on a literal
joined to a number or count (`'[x] count: ' + count`). Write a template
instead (`` `[x] count: ${count}` ``). Known limit: an object literal that
nests the error (`{ error }`) or a template that interpolates it passes
the rule; review catches those.

The pasteboard is a leak path too: a value copied there has no expiry, and
Universal Clipboard can sync it to the user's other devices. So a secret
(the export key) reaches the pasteboard only through
`copySensitiveText(value)` from `@kiko/clipboard`, the one pasteboard write
in the app. Never call `Clipboard.setString`/`setStrings` directly. Reads
(`Clipboard.getString()`, `ClipboardTextField`'s paste) stay allowed.

```ts
// wrong
Clipboard.setString(keyBase64);

// correct
import { copySensitiveText } from '@kiko/clipboard';

copySensitiveText(keyBase64);
```

Mechanized: `kiko-no-clipboard-set-string` (`rules/semgrep-prewrite.yml`,
ERROR), on any receiver. Known limit: the export key goes to the general
pasteboard; Universal Clipboard can sync it; a local-only expiring copy
needs a native module. A write through a destructured method or
`useClipboard()`'s setter passes the rule; review catches those.

## Encryption export compliance

`ios/Kiko/Info.plist`'s `ITSAppUsesNonExemptEncryption` is `false` —
Kiko declares only standard/exempt encryption (HTTPS/TLS, and the
export feature's own AES-256-GCM envelope encryption in
`src/data-transfer/crypto/`, which qualifies for the standard
encryption exemption). Ask: does this diff add a NEW cryptographic
primitive or protocol that is not HTTPS/TLS or an extension of the
existing standard AES-256-GCM export path? If so, flag it — a genuinely
new encryption use case can change whether the `false` declaration
still holds, and that is a human/legal judgment call, not one this
skill or the harness makes for you.

## Permissions — a new native capability needs a usage-description string

Ask: does this diff call a native API that prompts for a permission
(camera, biometrics, file access)? `ios/Kiko/Info.plist`
needs a matching `NS*UsageDescription` key with a real, non-empty
string (see the existing `NSFaceIDUsageDescription` entry for the
shape). `npm run check:plist` (`scripts/checks/plist.sh`) fails on an
EMPTY `NS*UsageDescription` value, but it does NOT fail on a key that
is MISSING entirely — a missing key crashes the app at the permission
request instead (SIGABRT for Face ID, verified) rather than failing
this check, so confirm the key exists at all, not only that
`check:plist` is green.

Local notifications (`UNUserNotificationCenter` authorization) need NO
Info.plist key. Ask for them only after a HIG pre-alert
(`NotificationPreAlertSheet`) at a moment the user chose. Never request
Time Sensitive or critical alerts: `KikoRemindersCenter.swift` rejects
unknown interruption levels.

## ATS — no new arbitrary-loads domain, pinning stays intact

Ask: does this diff add a new network host, and if it sends a
credential header (`X-Token`, `X-MBX-APIKEY`, `Authorization`, an
api-key-ish header, or the `api_token` query parameter, quoted or not), is that host under `NSPinnedDomains` with at
least two SPKI pins? Mechanized: `npm run check:plist` resolves every
credential-bearing client's `@env`-configured host and fails if it is
unpinned, under-pinned, or if `NSAllowsArbitraryLoads` is not `false`
— read `scripts/checks/plist.sh` for the exact resolution logic rather
than trusting a restated one here. A Let's Encrypt host pins two roots,
never the rotating intermediate (see `docs/security/README.md`).

## 2.5.2 — no remotely-loaded executable code

Ask: does this diff add a mechanism that downloads and runs code at
runtime — a code-push / OTA JS-update dependency (`react-native-code-push`,
`expo-updates`, and the like), or a dynamic `require`/`eval` of
remotely-fetched JS? The signed, App-Store-reviewed JS bundle is fine;
a live code-UPDATE path outside review is not. Satisfied today: no
such dependency exists in the tree. `npm run check:deps` surfaces a
newly-added dependency for confirmation, which is where such a
dependency first becomes visible — but it does not judge whether a dep
loads remote code, so this stays a reviewer question backed by
`check:deps` visibility, not a mechanized gate.

## Third-party trademarks

Ask: does this diff add a bank/exchange logo asset, name, or wording
that could read as an official partnership or endorsement Kiko does
not have? Judgment only — no mechanized check. Satisfied today for the
account form's bank and broker pickers: each shows a "not affiliated with
or endorsed by any bank/broker" caption under its trigger
(`forms.account.bankDisclaimer`, which also says Kiko is not a bank, and
`brokerDisclaimer`), and neither picker draws a logo.

## No tracking/analytics SDKs

Ask: does this diff add a new dependency that performs analytics,
tracking, or crash reporting? `npm run check:deps` surfaces any
changed dependency block for confirmation (see the checks table in
`CLAUDE.md`), which is where a new dependency is visible — but it does
not judge INTENT; deciding whether a new dependency is a tracking SDK
is a reviewer judgment call.

## Conditional triggers — N/A today, review the moment the feature lands

These guidelines have no live surface in Kiko today, so there is
nothing to check on an ordinary diff — but each names a specific
feature that would make it live, so check for that feature instead:

- 3.1.1 In-App Purchase — a paid tier or subscription of digital
  content must transact through Apple's IAP. N/A today: no IAP
  dependency, the app is free. Triggers the moment a paywall,
  subscription, or IAP dependency is added.
- 4.8 Sign in with Apple — offering a third-party or social login
  (Google, Facebook, etc.) requires offering Sign in with Apple
  alongside it. N/A today: Kiko has no login of any kind. Triggers
  the moment a social/third-party login is added.
- 5.1.1(v) in-app account deletion — an app that supports account
  CREATION must let the user delete that account in-app. N/A today:
  Kiko has no user-account system — its "Account" entity is a
  financial account (bank/wallet), not a login/registration account.
  Triggers the moment user-account creation is added.

## Mechanized vs judgment

Already auto-enforced, so do not re-litigate these by hand — just
confirm the relevant check ran and stayed green:

- `kiko-no-hidden-feature-flag-or-demo-import` (Semgrep, `check:security`) —
  the `SHOW_*`/`HIDE_*` flag and `e2e/` import pattern only.
- `scripts/checks/plist.sh` (`check:plist`) — ATS pinning, arbitrary
  loads, empty usage-description strings, (section 1b) a credential
  client (a credential header or the `api_token` parameter) without a
  `Cache-Control: no-store` request header, the localized
  app-name tables (`ios/Kiko/<language>.lproj/InfoPlist.strings`) wired
  into the Kiko target's Resources build phase, and the DiskSpace
  required-reason API declared in `ios/Kiko/PrivacyInfo.xcprivacy` while
  any dependency on check 5's linked list in `scripts/checks/plist.sh`
  ships (fail-closed). Read that list there for the exact set.
- `gitleaks` (`check:secrets`) — a committed secret.
- `kiko-no-raw-error-in-console` (Semgrep, pre-write guard and
  `check:security`) — a non-literal `console.*` argument (see "5.1.5 /
  data storage" for its known limit).
- `kiko-no-clipboard-set-string` (Semgrep, pre-write guard and
  `check:security`) — a pasteboard write outside `copySensitiveText` (see
  "5.1.5 / data storage" for its known limit).

Everything else on this page is reviewer judgment: completeness,
metadata accuracy, privacy-label freshness, an encryption-declaration
change, a genuinely missing (not merely empty) usage-description key,
trademark misuse, and tracking-SDK intent. When a judgment item above
recurs enough to be worth mechanizing, turn it into a Semgrep rule
plus a fixture pair rather than leaving it as a standing manual
question — see `.claude/skills/kiko-linter/SKILL.md` for how a check
gets added to the harness.
