# App Store publishing — research

Date: 2026-09-04 · Status: research (not implemented)
App: bare RN iOS, New Arch + Hermes, local-only data, connects to
Monobank with the user's own personal token. Bundle `com.dmytro.pff`.

## Config: correct vs blocking (from `ios/`)
Correct: bundle id, team `M52858LNYL` (automatic signing), version 1.0,
Hermes, bitcode NO, New Arch, ATS on, `PrivacyInfo.xcprivacy` present
with 3 required-reason APIs.

Blocking / to fix:
- **App icon** — on `main` the appiconset had zero PNGs (HARD BLOCKER).
  Now set on the branch (single `kiko.png`). ✓
- **Display name "Кіко" never set** — `CFBundleDisplayName` says "Kiko";
  set it (and localize).
- `ITSAppUsesNonExemptEncryption` absent — add `= false`.
- Stray empty `NSLocationWhenInUseUsageDescription` — remove it.
- `TARGETED_DEVICE_FAMILY = "1,2"` — decide iPhone-only (`"1"`) vs iPad
  (iPad forces a working layout + 13″ screenshots).
- Deployment target mismatch (15.1 pbxproj vs 16.0 Podfile) — align.

## Checklist (in order)
0. Apple Developer Program — **Individual** ($99/yr, 2FA, ~24–48h). **M**
1. Fix the build blockers above. **M**
2. Distribution signing (automatic on first archive). **S**
3. App Store Connect app record (Ukrainian primary language, unique
   Store name "Кіко"). **S**
4. Archive (Any iOS Device arm64, Release) → upload. **M**
5. App Privacy questionnaire → **"Data Not Collected"** (mandatory even
   for local-only). **S**
6. Export compliance → exempt (HTTPS + Keychain). **S**
7. Store assets: 6.9″ screenshots (1320×2868), description, keywords,
   **privacy-policy URL (required)**, support URL, Finance category,
   age rating. **M/L**
8. Localization: primary language Ukrainian; `uk.lproj` for the display
   name. **S**
9. TestFlight beta (validate the real Monobank connect). **S/M**
10. Submit with review notes + a **demo Monobank token**. **S**
11. Pre-submit: `check:deep` + device smoke test. **S**

## Top rejection risks
1. **Guideline 3.2.1(viii)** — money-management apps "should be
   submitted by the financial institution." HIGHEST RISK. Mitigate:
   frame as a **read-only, on-device personal net-worth tracker** (no
   trading, no money movement, user's own personal token), state this
   in review notes, be ready to appeal.
2. Missing app icon — now cleared.
3. Account-deletion (5.1.1(v)) — **N/A** (no account creation). The
   token-off-device clause is already satisfied (Keychain only,
   disconnect clears it).
4. Missing privacy-policy URL — publish a short one (data stays
   on-device; token in Keychain, never sent to the developer; no
   tracking).
5. Reviewer cannot test Monobank — supply a demo token / sample mode.
6. Pod-level privacy manifests — resolve any upload warning before
   release.
7. Empty location string + iPad support — fix/decide in step 1.

## RN gotchas
Hermes fine; bitcode NO; privacy manifest required (app-level present,
watch pods); keep required-reason APIs synced with native deps; New Arch
fine.

## Bottom line
Two hard blockers were the icon (now fixed) and the "Кіко" display name
(still unset). The single biggest review risk is 3.2.1(viii) — mitigate
with the read-only on-device framing and a demo token. Everything else
is small config or already satisfied.

## References
- Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Enrollment: https://developer.apple.com/programs/enroll/
- Screenshot specs: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Export compliance: https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations
- Privacy manifest: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- App Privacy: https://developer.apple.com/app-store/app-privacy-details/
