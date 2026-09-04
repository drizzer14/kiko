# App Store publishing — design spec

Date: 2026-09-04
Status: draft (fixed decisions below; not implemented, not committed)
Scope owner: PFF coordinator
Source: `docs/research/2026-09-04-app-store-publishing.md`

## Problem

The app (bare RN iOS, New Arch + Hermes, local-only data, Monobank
connect via the user's own personal token; bundle `com.dmytro.pff`)
has never been submitted to the App Store. A handful of `ios/` config
values are wrong or missing, and there is a full first-submission
process — enrollment, App Store Connect setup, assets, and a
Guideline 3.2.1(viii) review-risk mitigation — that has not been done.

## Branch note (read before touching `ios/`)

Two of the blockers below are **already fixed, but only on
`drizzer14/pff-ux-round`, not on `main`**:

- **App icon.** On `main`, `ios/PFF/Images.xcassets/AppIcon.appiconset/`
  has a `Contents.json` but zero PNGs (HARD BLOCKER — Xcode will not
  archive). On `pff-ux-round` it has three wired PNGs
  (`AppIcon-Default-1024.png`, `AppIcon-Dark-1024.png`,
  `AppIcon-Tinted-1024.png`, light/dark/tinted per the Xcode 16 single-
  size format) and a `Contents.json` that references all three.
- **`CFBundleDisplayName`.** On `main`, `ios/PFF/Info.plist` still says
  `PFF`. On `pff-ux-round`, it is already `Кіко`. Note `app.json`
  (`{"name": "PFF", "displayName": "PFF"}`) is **unchanged on both
  branches** — it still needs the display-name edit regardless of
  which branch lands first.

Whoever implements this must land on top of (or merge in) the icon +
display-name state from `pff-ux-round`, not redo it from `main`.

## Config changes (code)

Verified directly against `main` (2026-09-04):

| Item | Current (`main`) | Target |
|---|---|---|
| `CFBundleDisplayName` (`ios/PFF/Info.plist`) | `PFF` | `Кіко` (already done on `pff-ux-round`) |
| `app.json` `displayName` | `PFF` | `Кіко` (not done on either branch yet) |
| `uk.lproj/InfoPlist.strings` | absent | add, with `CFBundleDisplayName = "Кіко";` |
| `ITSAppUsesNonExemptEncryption` (`Info.plist`) | absent | add, `= false` |
| `NSLocationWhenInUseUsageDescription` (`Info.plist`) | present, value `""` (stray/unused) | remove the key entirely |
| `IPHONEOS_DEPLOYMENT_TARGET` (`project.pbxproj`, all 4 build configs) | `15.1` | align to one value (see below) |
| `platform :ios` (`Podfile`) | `16.0` | align to the same value |
| `TARGETED_DEVICE_FAMILY` (`project.pbxproj`, Debug + Release configs) | `"1,2"` (iPhone + iPad) | `"1"` (iPhone-only) |
| App icon PNGs | zero on `main`; three (Default/Dark/Tinted) on `pff-ux-round` | carry `pff-ux-round`'s three PNGs + `Contents.json` forward |

Decisions for the alignment items:

- **Deployment target: raise `IPHONEOS_DEPLOYMENT_TARGET` to `16.0`**
  to match the Podfile, rather than lowering the Podfile to `15.1`.
  Rationale: the Podfile's `16.0` is the floor CocoaPods already
  resolved dependencies against; lowering it risks a pod that assumes
  16.0 APIs. Raising the app target to match is the safe direction.
  Apply to all four build configs in `project.pbxproj` that currently
  read `15.1` (lines ~268, 300, 369, 444 as of this reading).
- **Device family: iPhone-only.** Set `TARGETED_DEVICE_FAMILY = "1"`
  wherever it currently reads `"1,2"`. This also removes the need for
  a working iPad layout and 13" iPad screenshots (see Assumptions).
  `UISupportedInterfaceOrientations~ipad` in `Info.plist` becomes dead
  once iPad support is dropped; leave it (harmless) unless the
  implementer wants to delete it for cleanliness — not required by
  this spec.
- **`ITSAppUsesNonExemptEncryption = false`**: correct because the
  app's only network use is HTTPS via `NSAppTransportSecurity` /
  standard `fetch`/Monobank API calls — no proprietary or non-exempt
  encryption algorithm is implemented. This maps directly to the
  export-compliance checklist item below (exempt).
- **Remove the empty `NSLocationWhenInUseUsageDescription`**: the app
  requests no location permission; an empty usage-description string
  is a stray leftover (likely from a template) and Apple can reject an
  empty purpose string outright. Delete the key, do not just fill in a
  placeholder string, since the capability is genuinely unused.

Verified but already correct — do not touch:

- Bundle id `com.dmytro.pff`, team `M52858LNYL` with automatic
  signing, marketing version `1.0`, Hermes, bitcode `NO`, New Arch on
  (`RCTNewArchEnabled = true`), ATS on (`NSAllowsArbitraryLoads =
  false`).
- `ios/PFF/PrivacyInfo.xcprivacy` — present, three required-reason API
  categories declared (`FileTimestamp`, `UserDefaults`,
  `SystemBootTime`), `NSPrivacyTracking = false`,
  `NSPrivacyCollectedDataTypes` empty. Matches the "Data Not Collected"
  App Privacy answer below; no code change needed here, only the App
  Store Connect questionnaire (process section).

## Publishing process (checklist)

In order. Each item is independent to check off; do not skip ahead of
a hard blocker.

1. **Apple Developer Program enrollment — Individual.** $99/yr,
   2FA-gated, historically ~24–48h to clear. Blocks every step below
   that needs a team/signing identity. See "Assumptions to confirm".
2. **Land the config changes above** (this spec's "Config changes"
   section) on top of `pff-ux-round`'s icon + display-name work.
3. **Distribution signing** — automatic, on the first archive (Xcode
   handles provisioning once enrollment clears and the team is
   selected in the project).
4. **App Store Connect app record.**
   - Primary language: **Ukrainian**.
   - App name / Store listing name: **Кіко** (must be unique on the
     Store; check availability when creating the record).
   - Bundle id: `com.dmytro.pff`.
   - Category: **Finance**.
5. **Archive and upload.** Any iOS Device (arm64), Release
   configuration, via Xcode Organizer or `xcodebuild -archive` +
   `altool`/`xcrun notarytool`-equivalent upload flow.
6. **App Privacy questionnaire → "Data Not Collected."** Mandatory
   even for a fully local-only app; matches `PrivacyInfo.xcprivacy`'s
   empty `NSPrivacyCollectedDataTypes`. Do not accidentally declare
   Monobank data as "collected" — the token and fetched balances stay
   on-device (Keychain + local DB), never sent to the developer or a
   third party.
7. **Export compliance → exempt.** Confirms the
   `ITSAppUsesNonExemptEncryption = false` config change; standard
   HTTPS + Keychain use only, no proprietary encryption.
8. **Store assets.**
   - Screenshots: **6.9" display, 1320×2868**, iPhone-only set (no
     13" iPad screenshots needed per the iPhone-only decision).
   - Description, keyword list.
   - **Privacy-policy URL — required.** Short page: data stays
     on-device, the Monobank token lives in Keychain and is never sent
     to the developer, no tracking, no analytics.
   - Support URL.
   - Category: Finance (also set at record-creation time in step 4).
   - Age rating questionnaire.
9. **Localization.** Primary language Ukrainian (set in step 4); add
   `uk.lproj/InfoPlist.strings` (this spec's config section) so the
   on-device display name renders as "Кіко" under a Ukrainian locale.
10. **TestFlight beta.** Validate the real Monobank connect flow
    end-to-end on a TestFlight build before submitting for review.
11. **Submit for review.**
    - Attach **review notes** (draft wording below).
    - Provide a **demo Monobank token** so the reviewer can exercise
      the connect flow without using the developer's own bank
      account.
12. **Pre-submit gate.** Run `npm run check:deep` (mutation +
    osv-scanner) and a device smoke test before the final submit —
    this is the harness's own deep-tier checkpoint, not an
    App-Store-specific step, but it belongs at the end of this
    checklist, not skipped because "it's just a submission."

### Top review risk: Guideline 3.2.1(viii)

Money-management apps that connect to a financial institution are
expected to be "submitted by the financial institution" itself. This
is the single highest-risk rejection reason for this app, because it
connects to Monobank.

**Mitigation:** frame the app, in both the App Store Connect metadata
and the submission review notes, as a **read-only, on-device personal
net-worth tracker** — not a banking or trading app. Concretely:

- No money movement (no transfers, no payments, no trading) — the app
  only *reads* balances and transaction history.
- The Monobank token is the **user's own personal token**, entered by
  the user for their own account, stored only in Keychain — the app
  is not a "Monobank client" acting as an intermediary.
- All data (balances, holdings, computed net worth) stays on-device;
  nothing is transmitted to the developer or any third party besides
  the read-only calls to Monobank's own API using the user's own
  credential.

**Draft review-note wording** (attach verbatim or lightly edited at
submission, step 11 above):

> Кіко is a personal, read-only net-worth tracker. It does not move
> money, execute trades, or act as a financial institution or
> intermediary. Users who choose to connect Monobank do so with their
> own personal read-only API token, entered directly by the user; the
> app only fetches account balances and transaction history to display
> them locally. No banking credentials, balances, or transaction data
> are ever transmitted to the developer or any third party — all data
> is stored on-device (Keychain for the token, a local database for
> everything else). A demo Monobank token is provided below so the
> review team can exercise the connect flow without needing a real
> bank account.

Be ready to appeal if rejected under this guideline regardless of the
framing — this is a known, accepted risk, not something the framing
can guarantee away.

### Other risks carried from the research (lower priority, already mitigated or N/A)

- Missing app icon — cleared on `pff-ux-round`; must be carried
  forward when this lands (see "Branch note").
- Account-deletion (Guideline 5.1.1(v)) — **N/A**, the app has no
  account creation. Disconnecting Monobank already clears the token
  from Keychain (existing behavior, not part of this spec).
- Missing privacy-policy URL — covered by checklist step 8.
- Reviewer cannot test Monobank without a real account — covered by
  the demo token in step 11.
- Pod-level privacy manifests — resolve any Xcode upload warning about
  a third-party pod's own privacy manifest before submitting; the
  app-level `PrivacyInfo.xcprivacy` is already present and correct,
  this is only a "watch for it" item during upload, not a known
  current failure.

## Assumptions to confirm

1. **iPhone-only (drop iPad support).** `TARGETED_DEVICE_FAMILY`
   changes from `"1,2"` to `"1"`. This removes the need for a working
   iPad layout and a 13" iPad screenshot set, at the cost of the app
   never being installable on iPad. Confirm this trade-off is
   intended before implementing.
2. **Apple Developer Program: Individual, not Organization,
   enrollment.** Individual is cheaper to set up (no D-U-N-S number,
   no legal-entity paperwork) but publishes under the developer's own
   personal name rather than a company name on the Store listing.
   Confirm this is acceptable for how "Кіко" should appear to users
   (the seller name shown on the App Store product page will be the
   individual's legal name, not "Кіко" or a company name — only the
   app name itself is "Кіко").
3. **Display name target is "Кіко."** Confirm the exact string
   (including capitalization and the Cyrillic characters) is final —
   this is both the `CFBundleDisplayName` / `app.json` value and the
   App Store Connect listing name, and a Store display name is not
   trivially changeable post-submission without another review cycle.

## Out of scope (YAGNI)

- iPad-specific layout work (moot once iPhone-only is confirmed).
- Organization-account paperwork (D-U-N-S lookup, legal-entity
  verification) — only relevant if assumption 2 is overturned.
- Analytics, crash reporting, or any other new data collection —
  would invalidate the "Data Not Collected" App Privacy answer and is
  not planned.
- CI/CD submission automation (e.g., Fastlane, `xcodebuild` scripting
  beyond what's needed for one manual archive/upload) — first
  submission is manual per this checklist; automation is a possible
  future item, not part of this spec.

## Affected files (initial map)

- `ios/PFF/Info.plist` — display name, `ITSAppUsesNonExemptEncryption`,
  remove the location-usage key.
- `ios/PFF/uk.lproj/InfoPlist.strings` — new file.
- `app.json` — `displayName`.
- `ios/PFF.xcodeproj/project.pbxproj` — `IPHONEOS_DEPLOYMENT_TARGET`
  (all 4 configs), `TARGETED_DEVICE_FAMILY` (Debug + Release configs).
- `ios/Podfile` — confirm/keep `platform :ios, "16.0"` (no change if
  the app target is raised to match, per the decision above).
- `ios/PFF/Images.xcassets/AppIcon.appiconset/` — carry forward the
  three PNGs + `Contents.json` from `drizzer14/pff-ux-round`.
- A new privacy-policy static page/URL (outside this repo's `ios/`
  tree — hosting location not yet decided, needed for App Store
  Connect step 8).
