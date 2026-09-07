# App Store Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This plan has two task groups. **Group A (Tasks A1–A7) is code/config work** for the `developer` agent (with `ops` running the build checkpoint). **Group B (Tasks B1–B12) is a manual, human-in-the-loop process** — the user drives Apple Developer / App Store Connect / Xcode Organizer; an agent can prepare text and run local commands but cannot click through Apple's web UI, pay, or accept agreements. Every Group B task is marked `MANUAL`.

**Goal:** Ship the first App Store submission of Кіко (bundle `com.dmytro-vasylkivskyi.kiko`): fix the six wrong-or-missing `ios/` config values, then walk the enrollment → App Store Connect → archive → TestFlight → submit checklist with the Guideline 3.2.1(viii) read-only framing attached.

**Architecture:** No app code changes. Group A edits three existing config files (`ios/Kiko/Info.plist`, `ios/Kiko.xcodeproj/project.pbxproj`, `app.json`), adds one localized strings file wired into the Xcode project (`ios/Kiko/uk.lproj/InfoPlist.strings`), and adds the privacy-policy text the store listing must link to. Group B is an ordered checklist of Apple-side steps with the exact values to type in. The work lands on top of `drizzer14/pff-ux-round` (commit `e7cc1fa`), which already carries the app icon PNGs and `CFBundleDisplayName = Кіко`; those two items are **verified as preconditions, never redone**.

**Tech Stack:** React Native 0.87 (bare, New Arch, Hermes), Xcode 26.6 (`/usr/bin/xcodebuild`, `/usr/bin/plutil`, `/usr/bin/agvtool`), CocoaPods, App Store Connect, TestFlight. Harness checks: `npm run check:all`, `npm run check:deep`.

**Spec:** `docs/superpowers/specs/2026-09-04-app-store-publishing-design.md` (research: `docs/research/2026-09-04-app-store-publishing.md`).

## Global Constraints

- Base branch is `drizzer14/pff-ux-round` at `e7cc1fa` (worktree today: `/Users/drizzer14/orca/workspaces/pff-ios/pff-ux-round`). Do **not** branch from `main` — `main` has zero icon PNGs and `CFBundleDisplayName = Kiko`.
- Display name string is exactly `Кіко` (Cyrillic: U+041A U+0456 U+043A U+043E). It is used verbatim as `CFBundleDisplayName`, `app.json` `displayName`, the `uk.lproj` display name, and the App Store Connect app name.
- `app.json` `name` stays `Kiko` — `index.js` registers the root component under it and `ios/Kiko/AppDelegate.swift:27` loads `withModuleName: "Kiko"`. Only `displayName` changes.
- Deployment target is aligned **upward** to `16.0` (the Podfile's `platform :ios, "16.0"` wins over the pbxproj's `15.1`). `ios/Podfile` is not edited.
- Device family is iPhone-only: `TARGETED_DEVICE_FAMILY = "1"`. No iPad layout, no iPad screenshots.
- `ITSAppUsesNonExemptEncryption = false` (standard HTTPS + Keychain only). Export compliance answer is "exempt".
- App Privacy answer is **"Data Not Collected"**; it must stay consistent with `ios/Kiko/PrivacyInfo.xcprivacy` (`NSPrivacyCollectedDataTypes` empty, `NSPrivacyTracking = false`). No analytics or crash reporting may be added.
- Do not touch (verified correct): bundle id `com.dmytro-vasylkivskyi.kiko`, `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`, `CODE_SIGN_STYLE = Automatic`, `ENABLE_BITCODE = NO`, `RCTNewArchEnabled = true`, `NSAllowsArbitraryLoads = false`, `PrivacyInfo.xcprivacy`.
- Never commit the demo Monobank token, any real token, or a screenshot of a real connected account. `npm run check:secrets` (gitleaks) runs on every write.
- Project commit rule: **do not commit** at the end of a task. The user reviews the diff in the worktree (Orca inline comments) and commits when they choose. Each task therefore ends with "hand off for review", not `git commit`.
- Harness checkpoints: `npm run check:all` at the end of Group A (Task A7); `npm run check:deep` before the final submit (Task B11).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `ios/Kiko/Info.plist` | Modify | Add `ITSAppUsesNonExemptEncryption=false`; delete `NSLocationWhenInUseUsageDescription`; delete `UISupportedInterfaceOrientations~ipad` (dead once iPhone-only). `CFBundleDisplayName = Кіко` is already there from `kiko-ux-round`. |
| `ios/Kiko/uk.lproj/InfoPlist.strings` | Create | Ukrainian-locale override for `CFBundleDisplayName`. |
| `ios/Kiko.xcodeproj/project.pbxproj` | Modify | `IPHONEOS_DEPLOYMENT_TARGET` 15.1→16.0 in all four `XCBuildConfiguration` blocks (lines 268, 300, 369, 444); `TARGETED_DEVICE_FAMILY` `"1,2"`→`"1"` in the two target blocks (lines 284, 315); register `uk` in `knownRegions` (line 142–145); add a `PBXVariantGroup` + `PBXFileReference` + `PBXBuildFile` + group child + Resources-phase entry for `InfoPlist.strings`. |
| `app.json` | Modify | `displayName` `Kiko`→`Кіко`. |
| `ios/Podfile` | Read-only check | Confirm `platform :ios, "16.0"` (line 8) is unchanged. |
| `ios/Kiko/Images.xcassets/AppIcon.appiconset/` | Precondition check only | Three PNGs + `Contents.json` must already be present from `kiko-ux-round`. |
| `docs/store/privacy-policy.md` | Create | The privacy-policy page text (Ukrainian + English) that gets hosted for the App Store Connect "Privacy Policy URL" field. |

Nothing under `src/` changes. `ios/**` is excluded from Biome, jscpd, and knip (`biome.json` `!ios`, `.jscpd.json` `ios/**`), so `check:all` exercises the `app.json` and `docs/` edits only; the Xcode-side verification is `plutil` + `xcodebuild` in each task.

---

# Group A — Config changes (code; `developer` agent)

### Task A1: Branch from `kiko-ux-round` and verify the carried-forward state

**Files:**
- Read: `ios/Kiko/Info.plist`, `ios/Kiko/Images.xcassets/AppIcon.appiconset/Contents.json`

**Interfaces:**
- Produces: a worktree on branch `drizzer14/pff-app-store` whose parent is `drizzer14/pff-ux-round@e7cc1fa`, with `node_modules` and `ios/Pods` installed so later tasks can build.

- [ ] **Step 1: Create the worktree from the ux-round branch (coordinator, via Orca)**

```bash
cd /Users/drizzer14/Developer/Projects/pff-ios
git fetch origin
git worktree add -b drizzer14/pff-app-store /Users/drizzer14/orca/workspaces/pff-ios/pff-app-store drizzer14/pff-ux-round
```

Expected: the new worktree's `git log -1 --oneline` prints `e7cc1fa fix(forms): persist cleared icon on edit; protect synced holding balance`.

- [ ] **Step 2: Verify the icon PNGs are present (precondition, not a redo)**

```bash
cd /Users/drizzer14/orca/workspaces/pff-ios/pff-app-store
ls -1 ios/Kiko/Images.xcassets/AppIcon.appiconset/
```

Expected, exactly these four names:

```
AppIcon-Dark-1024.png
AppIcon-Default-1024.png
AppIcon-Tinted-1024.png
Contents.json
```

If any PNG is missing, STOP — the worktree was cut from the wrong branch. Do not copy icons in from elsewhere.

- [ ] **Step 3: Verify the display name is already `Кіко`**

```bash
plutil -extract CFBundleDisplayName raw ios/Kiko/Info.plist
```

Expected: `Кіко`. If it prints `Kiko`, STOP for the same reason.

- [ ] **Step 4: Install JS and native dependencies (needed for the hooks and for Task A7's build)**

```bash
npm install
cd ios && pod install && cd ..
```

Expected: `npm install` exits 0; `pod install` ends with `Pod installation complete!` and does not modify `ios/Podfile.lock` (`git status --short ios/Podfile.lock` prints nothing).

- [ ] **Step 5: Hand off** — report the worktree path and the three verified preconditions. No commit.

---

### Task A2: Info.plist — encryption flag on, stray location key off

**Files:**
- Modify: `ios/Kiko/Info.plist:25-37`

**Interfaces:**
- Produces: `ITSAppUsesNonExemptEncryption` = `false` (read by App Store Connect at upload; it suppresses the per-build export-compliance prompt in Task B7); no `NSLocationWhenInUseUsageDescription` key.

- [ ] **Step 1: Add the encryption key**

Info.plist keys are kept in alphabetical order. Insert the new key directly after `CFBundleVersion` and before `LSRequiresIPhoneOS`. Change this:

```xml
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>LSRequiresIPhoneOS</key>
	<true/>
```

to this:

```xml
	<key>CFBundleVersion</key>
	<string>$(CURRENT_PROJECT_VERSION)</string>
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
	<key>LSRequiresIPhoneOS</key>
	<true/>
```

- [ ] **Step 2: Delete the empty location usage description**

Remove these two lines entirely (currently lines 36–37, between the `NSAppTransportSecurity` dict's `</dict>` and `RCTNewArchEnabled`):

```xml
	<key>NSLocationWhenInUseUsageDescription</key>
	<string></string>
```

Do not replace the value with a string — the app requests no location permission; an empty purpose string is a rejection risk and a filled one would be a lie.

- [ ] **Step 3: Verify**

```bash
plutil -lint ios/Kiko/Info.plist
plutil -extract ITSAppUsesNonExemptEncryption raw ios/Kiko/Info.plist
plutil -extract NSLocationWhenInUseUsageDescription raw ios/Kiko/Info.plist; echo "exit=$?"
```

Expected, in order:

```
ios/Kiko/Info.plist: OK
false
ios/Kiko/Info.plist: Could not extract value, error: No value at that key path or invalid key path: NSLocationWhenInUseUsageDescription
exit=1
```

- [ ] **Step 4: Hand off** — `git diff ios/Kiko/Info.plist` should show exactly +2 / −2 lines. No commit.

---

### Task A3: Deployment target 15.1 → 16.0 in all four build configurations

**Files:**
- Modify: `ios/Kiko.xcodeproj/project.pbxproj:268,300,369,444`
- Read-only: `ios/Podfile:8`

**Interfaces:**
- Produces: `IPHONEOS_DEPLOYMENT_TARGET = 16.0` at project and target level, Debug and Release, matching the Podfile floor. The built app's `MinimumOSVersion` becomes `16.0` (checked in Task A7).

- [ ] **Step 1: Confirm the Podfile floor is the value to match**

```bash
sed -n '8p' ios/Podfile
```

Expected: `platform :ios, "16.0"`. Do not edit the Podfile.

- [ ] **Step 2: Replace all four occurrences**

Each of the four `XCBuildConfiguration` blocks (`13B07F941A680F5B00A75B9A /* Debug */`, `13B07F951A680F5B00A75B9A /* Release */`, `83CBBA201A601CBA00E9B192 /* Debug */`, `83CBBA211A601CBA00E9B192 /* Release */`) contains this line:

```
				IPHONEOS_DEPLOYMENT_TARGET = 15.1;
```

Change every one to:

```
				IPHONEOS_DEPLOYMENT_TARGET = 16.0;
```

Use four targeted edits (or one `replace_all`); there are no other `15.1` values in the file.

- [ ] **Step 3: Verify the text and the effective build settings**

```bash
grep -c 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;' ios/Kiko.xcodeproj/project.pbxproj
grep -c 'IPHONEOS_DEPLOYMENT_TARGET = 15.1;' ios/Kiko.xcodeproj/project.pbxproj
plutil -lint ios/Kiko.xcodeproj/project.pbxproj
xcodebuild -project ios/Kiko.xcodeproj -target Kiko -configuration Release -showBuildSettings 2>/dev/null | grep -E '^\s+IPHONEOS_DEPLOYMENT_TARGET ='
xcodebuild -project ios/Kiko.xcodeproj -target Kiko -configuration Debug -showBuildSettings 2>/dev/null | grep -E '^\s+IPHONEOS_DEPLOYMENT_TARGET ='
```

Expected:

```
4
0
ios/Kiko.xcodeproj/project.pbxproj: OK
    IPHONEOS_DEPLOYMENT_TARGET = 16.0
    IPHONEOS_DEPLOYMENT_TARGET = 16.0
```

(`grep -c` on the `15.1` line prints `0` and exits 1 — that exit code is the expected outcome, not a failure.)

- [ ] **Step 4: Hand off** — `git diff --stat ios/Kiko.xcodeproj/project.pbxproj` shows 4 insertions, 4 deletions. No commit.

---

### Task A4: iPhone-only — device family `"1"` and drop the dead iPad orientation key

**Files:**
- Modify: `ios/Kiko.xcodeproj/project.pbxproj:284,315`
- Modify: `ios/Kiko/Info.plist` (the `UISupportedInterfaceOrientations~ipad` array, currently lines 50–56 before Task A2's edits shift them)

**Interfaces:**
- Produces: `TARGETED_DEVICE_FAMILY = "1"` in both target configurations; the built app's `UIDeviceFamily` becomes `[1]` (checked in Task A7). App Store Connect will then require only the iPhone screenshot set (Task B8).

- [ ] **Step 1: Set the device family in both target build configurations**

In `13B07F941A680F5B00A75B9A /* Debug */` and `13B07F951A680F5B00A75B9A /* Release */`, change:

```
				TARGETED_DEVICE_FAMILY = "1,2";
```

to:

```
				TARGETED_DEVICE_FAMILY = "1";
```

There are exactly two occurrences; the two project-level configs do not set this key.

- [ ] **Step 2: Remove the iPad-only orientation array from Info.plist**

The spec marks this optional ("harmless"); this plan removes it because, with iPad support dropped, it is the same class of stray key as the location string removed in Task A2. Delete this block:

```xml
	<key>UISupportedInterfaceOrientations~ipad</key>
	<array>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationPortraitUpsideDown</string>
	</array>
```

Leave the iPhone `UISupportedInterfaceOrientations` array (portrait only) untouched.

- [ ] **Step 3: Verify**

```bash
grep -c 'TARGETED_DEVICE_FAMILY = "1";' ios/Kiko.xcodeproj/project.pbxproj
grep -c 'TARGETED_DEVICE_FAMILY = "1,2";' ios/Kiko.xcodeproj/project.pbxproj
plutil -lint ios/Kiko.xcodeproj/project.pbxproj
xcodebuild -project ios/Kiko.xcodeproj -target Kiko -configuration Release -showBuildSettings 2>/dev/null | grep -E '^\s+TARGETED_DEVICE_FAMILY ='
plutil -lint ios/Kiko/Info.plist
plutil -extract 'UISupportedInterfaceOrientations~ipad' raw ios/Kiko/Info.plist; echo "exit=$?"
plutil -extract UISupportedInterfaceOrientations json -o - ios/Kiko/Info.plist
```

Expected:

```
2
0
ios/Kiko.xcodeproj/project.pbxproj: OK
    TARGETED_DEVICE_FAMILY = 1
ios/Kiko/Info.plist: OK
ios/Kiko/Info.plist: Could not extract value, error: No value at that key path or invalid key path: UISupportedInterfaceOrientations~ipad
exit=1
["UIInterfaceOrientationPortrait"]
```

- [ ] **Step 4: Hand off.** No commit.

---

### Task A5: `app.json` display name

**Files:**
- Modify: `app.json:3`
- Read-only: `index.js`, `ios/Kiko/AppDelegate.swift:27`

**Interfaces:**
- Produces: `app.json` = `{ "name": "Kiko", "displayName": "Кіко" }`. `name` is consumed by `index.js` (`AppRegistry.registerComponent(appName, ...)`) and must match `AppDelegate.swift`'s `withModuleName: "Kiko"`; `displayName` is metadata the RN CLI reads and must match `CFBundleDisplayName`.

- [ ] **Step 1: Edit the display name only**

Replace the file contents with:

```json
{
  "name": "Kiko",
  "displayName": "Кіко"
}
```

- [ ] **Step 2: Verify the value and that the module name is untouched**

```bash
node -p "JSON.stringify(require('./app.json'))"
grep -n 'withModuleName' ios/Kiko/AppDelegate.swift
npm run check:lint
```

Expected:

```
{"name":"Kiko","displayName":"Кіко"}
27:      withModuleName: "Kiko",
```

and `check:lint` prints nothing (silent on success; `app.json` is inside Biome's `includes`).

- [ ] **Step 3: Run the Jest suite to prove nothing keyed off the old display name**

```bash
npx jest --silent 2>&1 | tail -5
```

Expected: all suites pass (no test references `displayName`; this is a regression guard, not a new test).

- [ ] **Step 4: Hand off.** No commit.

---

### Task A6: Ukrainian `InfoPlist.strings` wired into the Xcode project

**Files:**
- Create: `ios/Kiko/uk.lproj/InfoPlist.strings`
- Modify: `ios/Kiko.xcodeproj/project.pbxproj` — `PBXBuildFile` section (line 9–15), `PBXFileReference` section (17–28), `PBXGroup` `Kiko` children (44–50), `knownRegions` (142–145), `PBXResourcesBuildPhase` files (160–164), and a new `PBXVariantGroup` section between `/* End PBXSourcesBuildPhase section */` (line 253) and `/* Begin XCBuildConfiguration section */` (line 255).

**Interfaces:**
- Consumes: the display-name string `Кіко` (Global Constraints).
- Produces: `Kiko.app/uk.lproj/InfoPlist.strings` in the built bundle, so iOS shows `Кіко` under a Ukrainian locale from the localized table rather than only from the base `CFBundleDisplayName`. Three new pbxproj object IDs, fixed here so every later reference matches:
  - `053E6C3DC9C9417BACEDBE28` — the `PBXVariantGroup` `InfoPlist.strings`
  - `A590DCB08CD54D13B7197879` — the `PBXFileReference` for the `uk` variant
  - `124900AE1E7A4C17A724F221` — the `PBXBuildFile` "InfoPlist.strings in Resources"

- [ ] **Step 1: Create the strings file (UTF-8, no BOM)**

Create `ios/Kiko/uk.lproj/InfoPlist.strings` with exactly:

```
/* Ukrainian on-device display name (Home Screen, Settings, Spotlight). Must equal CFBundleDisplayName in Info.plist. */
"CFBundleDisplayName" = "Кіко";
```

- [ ] **Step 2: Lint the strings file before touching the project**

```bash
plutil -lint ios/Kiko/uk.lproj/InfoPlist.strings
plutil -convert json -o - ios/Kiko/uk.lproj/InfoPlist.strings; echo
```

Expected:

```
ios/Kiko/uk.lproj/InfoPlist.strings: OK
{"CFBundleDisplayName":"Кіко"}
```

- [ ] **Step 3: Register the build file**

In `/* Begin PBXBuildFile section */`, add this line directly after the `0C80B921A6F3F58F76C31292 /* libPods-Kiko.a in Frameworks */` line (IDs in this section are kept in ascending order):

```
		124900AE1E7A4C17A724F221 /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; fileRef = 053E6C3DC9C9417BACEDBE28 /* InfoPlist.strings */; };
```

- [ ] **Step 4: Register the file reference**

In `/* Begin PBXFileReference section */`, add this line directly after the `81AB9BB72411601600AC10FF /* LaunchScreen.storyboard */` line. The `Kiko` group has no `path` of its own, so — like `path = Kiko/Info.plist` — the path is relative to the project directory:

```
		A590DCB08CD54D13B7197879 /* uk */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = text.plist.strings; name = uk; path = Kiko/uk.lproj/InfoPlist.strings; sourceTree = "<group>"; };
```

- [ ] **Step 5: Add the variant group to the `Kiko` group**

In the `13B07FAE1A68108700A75B9A /* Kiko */` group, change:

```
				13B07FB61A68108700A75B9A /* Info.plist */,
				81AB9BB72411601600AC10FF /* LaunchScreen.storyboard */,
```

to:

```
				13B07FB61A68108700A75B9A /* Info.plist */,
				053E6C3DC9C9417BACEDBE28 /* InfoPlist.strings */,
				81AB9BB72411601600AC10FF /* LaunchScreen.storyboard */,
```

- [ ] **Step 6: Declare the `uk` region**

In the `PBXProject` object, change:

```
			knownRegions = (
				en,
				Base,
			);
```

to:

```
			knownRegions = (
				en,
				Base,
				uk,
			);
```

`developmentRegion = en` and Info.plist's `CFBundleDevelopmentRegion = en` stay as they are — the spec sets the *App Store* primary language to Ukrainian (Task B4); it does not change the bundle's development region.

- [ ] **Step 7: Add the file to the Resources build phase**

In `13B07F8E1A680F5B00A75B9A /* Resources */`, change:

```
				C4919CFE9414F1AE8AF0D959 /* PrivacyInfo.xcprivacy in Resources */,
			);
```

to:

```
				C4919CFE9414F1AE8AF0D959 /* PrivacyInfo.xcprivacy in Resources */,
				124900AE1E7A4C17A724F221 /* InfoPlist.strings in Resources */,
			);
```

- [ ] **Step 8: Add the `PBXVariantGroup` section**

Insert between `/* End PBXSourcesBuildPhase section */` and `/* Begin XCBuildConfiguration section */` (sections are alphabetical; `PBXVariantGroup` sorts before `XCBuildConfiguration`), keeping one blank line on each side:

```
/* Begin PBXVariantGroup section */
		053E6C3DC9C9417BACEDBE28 /* InfoPlist.strings */ = {
			isa = PBXVariantGroup;
			children = (
				A590DCB08CD54D13B7197879 /* uk */,
			);
			name = InfoPlist.strings;
			sourceTree = "<group>";
		};
/* End PBXVariantGroup section */
```

- [ ] **Step 9: Verify the project still parses and every ID is referenced exactly as intended**

```bash
plutil -lint ios/Kiko.xcodeproj/project.pbxproj
xcodebuild -list -project ios/Kiko.xcodeproj 2>/dev/null | grep -A1 'Targets:'
grep -c '053E6C3DC9C9417BACEDBE28' ios/Kiko.xcodeproj/project.pbxproj
grep -c 'A590DCB08CD54D13B7197879' ios/Kiko.xcodeproj/project.pbxproj
grep -c '124900AE1E7A4C17A724F221' ios/Kiko.xcodeproj/project.pbxproj
grep -n 'knownRegions' -A4 ios/Kiko.xcodeproj/project.pbxproj | grep -c 'uk,'
```

Expected:

```
ios/Kiko.xcodeproj/project.pbxproj: OK
    Targets:
        Kiko
3
2
2
1
```

(Variant group: its own definition + group child + build-file `fileRef` = 3. File ref: definition + variant-group child = 2. Build file: definition + Resources entry = 2.)

- [ ] **Step 10: Hand off.** Whether the file actually lands in the bundle is proven by the build in Task A7. No commit.

---

### Task A7: Group A checkpoint — harness checks, Release simulator build, bundle inspection, privacy-policy text

**Files:**
- Create: `docs/store/privacy-policy.md`
- Read-only: everything edited in A2–A6

**Interfaces:**
- Consumes: all Group A edits.
- Produces: a green `npm run check:all`; a Release `.app` at `ios/build/Build/Products/Release-iphonesimulator/Kiko.app` whose `Info.plist` and `uk.lproj` prove A2–A6 landed; the privacy-policy text that Task B8 hosts.

- [ ] **Step 1: Run the fast + medium tier**

```bash
npm run check:all
```

Expected: silent / exit 0. (`ios/**` is outside every check's scope; this verifies `app.json`, `docs/`, and that nothing else regressed.)

- [ ] **Step 2: Build Release for the 6.9" simulator (`ops` agent; slow — run in the background)**

```bash
xcodebuild -workspace ios/Kiko.xcworkspace -scheme Kiko -configuration Release \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  -derivedDataPath ios/build build 2>&1 | tail -3
```

Expected: `** BUILD SUCCEEDED **`. `ios/build/` is gitignored (`build/` in `.gitignore`). Release is the archive configuration in `Kiko.xcscheme` (`ArchiveAction buildConfiguration = "Release"`), so this is the closest local rehearsal of Task B5.

- [ ] **Step 3: Inspect the built bundle**

```bash
APP=ios/build/Build/Products/Release-iphonesimulator/Kiko.app
plutil -extract MinimumOSVersion raw "$APP/Info.plist"
plutil -extract UIDeviceFamily json -o - "$APP/Info.plist"; echo
plutil -extract ITSAppUsesNonExemptEncryption raw "$APP/Info.plist"
plutil -extract CFBundleDisplayName raw "$APP/Info.plist"
plutil -extract NSLocationWhenInUseUsageDescription raw "$APP/Info.plist"; echo "exit=$?"
plutil -extract CFBundleDisplayName raw "$APP/uk.lproj/InfoPlist.strings"
ls "$APP"/AppIcon60x60@2x.png "$APP"/Assets.car
```

Expected:

```
16.0
[1]
false
Кіко
Kiko.app/Info.plist: Could not extract value, error: No value at that key path or invalid key path: NSLocationWhenInUseUsageDescription
exit=1
Кіко
ios/build/Build/Products/Release-iphonesimulator/Kiko.app/AppIcon60x60@2x.png
ios/build/Build/Products/Release-iphonesimulator/Kiko.app/Assets.car
```

(Xcode compiles `.strings` to binary plist inside the bundle; `plutil` reads it the same way.)

- [ ] **Step 4: Optional on-simulator look (no screenshots — the user reviews live)**

```bash
xcrun simctl boot 'iPhone 17 Pro Max' 2>/dev/null; open -a Simulator
xcrun simctl install booted ios/build/Build/Products/Release-iphonesimulator/Kiko.app
xcrun simctl launch booted com.dmytro-vasylkivskyi.kiko
```

Expected: the Home Screen label under the icon reads `Кіко`; the icon renders (light), and switching the simulator to Dark appearance swaps to the dark icon.

- [ ] **Step 5: Write the privacy-policy text**

Create `docs/store/privacy-policy.md` with exactly this content (Ukrainian first because the store's primary language is Ukrainian, English second for App Review):

````markdown
# Кіко — Політика конфіденційності

Останнє оновлення: 4 вересня 2026 р.

Кіко — особистий трекер капіталу для iPhone. Застосунок працює повністю на вашому пристрої.

## Які дані ми збираємо

Жодних. Розробник не збирає, не отримує, не зберігає і не передає третім особам ніяких даних із застосунку. У Кіко немає реєстрації, облікових записів, аналітики, реклами чи відстеження.

## Де зберігаються ваші дані

- Рахунки, вкладення, операції та налаштування зберігаються в локальній базі даних на вашому iPhone.
- Якщо ви підключаєте Monobank, ваш особистий токен API зберігається виключно в системному Keychain iOS. Він ніколи не передається розробникові чи будь-кому іншому.
- Дані, отримані від Monobank (баланси та виписки), зберігаються тільки на пристрої.

## Мережеві запити

Кіко звертається до інтернету лише для:

- отримання курсів валют з публічного API Monobank (`api.monobank.ua/bank/currency`) та ціни біткоїна з публічного API CoinGecko;
- читання балансів та виписок ваших рахунків через API Monobank, якщо ви самі ввели свій токен. Ці запити виконуються напряму з вашого пристрою до Monobank з вашим власним токеном; застосунок не переказує кошти та не виконує жодних операцій.

## Видалення даних

Видалення застосунку з пристрою видаляє всі його дані. Кнопка «Disconnect Monobank» у застосунку видаляє токен із Keychain.

## Зв'язок

Питання щодо конфіденційності: див. сторінку підтримки застосунку в App Store.

---

# Кіко — Privacy Policy

Last updated: 4 September 2026

Кіко is a personal net-worth tracker for iPhone. The app runs entirely on your device.

## Data we collect

None. The developer does not collect, receive, store, or share any data from the app with anyone. Кіко has no sign-up, no accounts, no analytics, no advertising, and no tracking.

## Where your data lives

- Accounts, holdings, transactions, and settings are stored in a local database on your iPhone.
- If you connect Monobank, your personal API token is stored only in the iOS system Keychain. It is never transmitted to the developer or to anyone else.
- Data fetched from Monobank (balances and statements) is stored on the device only.

## Network requests

Кіко uses the network only to:

- fetch currency rates from Monobank's public API (`api.monobank.ua/bank/currency`) and the Bitcoin price from CoinGecko's public API;
- read your account balances and statements through the Monobank API, if you enter your own token. These calls go directly from your device to Monobank using your own credential; the app does not move money or perform any operation.

## Deleting your data

Deleting the app from your device deletes all of its data. The in-app "Disconnect Monobank" button removes the token from the Keychain.

## Contact

Privacy questions: see the app's support page on the App Store.
````

- [ ] **Step 6: Re-run the medium tier so the new doc is covered, then hand off for review**

```bash
npm run check:all
git status --short
```

Expected: `check:all` silent; `git status` lists exactly:

```
 M app.json
 M ios/Kiko.xcodeproj/project.pbxproj
 M ios/Kiko/Info.plist
?? docs/store/
?? ios/Kiko/uk.lproj/
```

No commit — the user reviews the whole Group A diff in the worktree. Group B starts once the user has approved it (Task B2 is the point where this diff must be in place).

---

# Group B — Publishing process (`MANUAL`, human-in-the-loop)

Each task below is an ordered checklist. Values in backticks are typed exactly as written. Where the spec leaves a value undecided, the plan names a recommended default and marks it **CONFIRM** — the user decides before that step is executed; do not invent a different value.

### Task B1 (MANUAL): Apple Developer Program enrollment — Individual

- [ ] **Step 1:** Sign in at `https://developer.apple.com/programs/enroll/` with the Apple ID that will own the app. Two-factor authentication must already be on for that Apple ID (Settings → [name] → Sign-In & Security on an iPhone).
- [ ] **Step 2:** Entity type: **Individual / Sole Proprietor**. Legal name as on the payment card — this exact string becomes the **seller name** on the App Store product page (not "Кіко"; the app name is the only place "Кіко" appears). Assumption 2 of the spec — confirm before paying.
- [ ] **Step 3:** Pay `$99 USD/year` (or local equivalent). Expect the confirmation email ("Welcome to the Apple Developer Program") within ~24–48h; nothing in B3–B12 works before it arrives.
- [ ] **Step 4 (verify):** `https://developer.apple.com/account` → Membership details shows **Apple Developer Program**, an expiry date one year out, and a **Team ID**. Write that Team ID down — Task B3 Step 2 compares it to the pbxproj's `M52858LNYL`.

### Task B2 (MANUAL gate): Group A landed on the working branch

- [ ] **Step 1:** Confirm Task A7 Step 6's `git status` diff has been reviewed and the user has committed (or asked for the commit of) Group A on `drizzer14/pff-app-store`. Every later step archives from this branch.
- [ ] **Step 2 (verify):** In the worktree, `plutil -extract ITSAppUsesNonExemptEncryption raw ios/Kiko/Info.plist` prints `false` and `git status --short` is clean.

### Task B3 (MANUAL): Distribution signing (automatic)

- [ ] **Step 1:** Xcode → Settings → Accounts → `+` → add the enrolled Apple ID. The team list must show the paid team (role Agent), not only "Personal Team".
- [ ] **Step 2 (conditional edit):** Compare the paid team's Team ID (Task B1 Step 4) with `DEVELOPMENT_TEAM = M52858LNYL` in `ios/Kiko.xcodeproj/project.pbxproj` (lines 265 and 298, target Debug and Release). **If they are identical, do nothing.** If they differ (this happens when a formerly free Personal Team is superseded by a new paid team), change both lines to the new ID, e.g. `DEVELOPMENT_TEAM = <new Team ID>;`, then `plutil -lint ios/Kiko.xcodeproj/project.pbxproj` → `OK`. This is the one Group B step that may touch a repo file; it goes through the same review-before-commit rule.
- [ ] **Step 3:** Open `ios/Kiko.xcworkspace` in Xcode → target `Kiko` → Signing & Capabilities: **Automatically manage signing** checked; Team = the paid team; Bundle Identifier shows `com.dmytro-vasylkivskyi.kiko`. Xcode registers the App ID `com.dmytro-vasylkivskyi.kiko` in Certificates, Identifiers & Profiles and creates an Apple Development certificate + profile here; the **Apple Distribution** certificate and App Store profile are created automatically at the first Archive → Distribute (Task B5).
- [ ] **Step 4 (verify):** the Signing pane shows no red error; "Provisioning Profile: Xcode Managed Profile"; "Signing Certificate: Apple Development: <name> (<id>)". `https://developer.apple.com/account/resources/identifiers/list` lists `com.dmytro-vasylkivskyi.kiko` (explicit App ID, no capabilities).

### Task B4 (MANUAL): App Store Connect app record

- [ ] **Step 1:** `https://appstoreconnect.apple.com` → Apps → `+` → **New App**.
- [ ] **Step 2:** Fill exactly:
  - Platforms: **iOS**
  - Name: `Кіко`
  - Primary Language: **Ukrainian**
  - Bundle ID: `com.dmytro-vasylkivskyi.kiko` (select from the dropdown — it appears after Task B3 Step 3; if absent, register it manually at Identifiers → `+` → App IDs → App → Description `Kiko` → Bundle ID explicit `com.dmytro-vasylkivskyi.kiko`, no capabilities)
  - SKU: `com.dmytro-vasylkivskyi.kiko`
  - User Access: **Full Access**
- [ ] **Step 3:** If ASC rejects the name as already in use: **STOP** and report — an alternate store name is a user decision (spec Assumption 3), not something to pick here.
- [ ] **Step 4:** In the new app → App Information: Primary Category **Finance**, Secondary Category none. Content Rights: **does not contain, show, or access third-party content**. Age Rating: done in Task B8.
- [ ] **Step 5 (verify):** App Information shows Bundle ID `com.dmytro-vasylkivskyi.kiko`, SKU `com.dmytro-vasylkivskyi.kiko`, Primary Language Ukrainian, Category Finance. The iOS App 1.0 "Prepare for Submission" page exists.

### Task B5 (MANUAL): Archive and upload build 1.0 (1)

- [ ] **Step 1 (first upload only — skip):** `CURRENT_PROJECT_VERSION = 1` is fine for the first upload. For **every later** upload the build number must be higher: in the worktree run `cd ios && agvtool new-version -all 2 && cd ..` (then 3, 4, …), which rewrites `CURRENT_PROJECT_VERSION` in both target configs; review and commit that diff like any other.
- [ ] **Step 2 (Xcode route — primary):** open `ios/Kiko.xcworkspace` → scheme `Kiko` → destination **Any iOS Device (arm64)** → Product → **Archive**. The scheme's Archive action already uses the Release configuration. `ios/.xcode.env.local` supplies `NODE_BINARY` to the "Bundle React Native code and images" phase.
- [ ] **Step 3:** Organizer opens → select the archive → **Distribute App** → **App Store Connect** → **Upload** → keep defaults (Upload symbols: on; Manage version and build number: **off** — the repo owns those) → automatic signing → **Upload**.
- [ ] **Step 2–3 (CLI alternative, same result):**

  ```bash
  xcodebuild -workspace ios/Kiko.xcworkspace -scheme Kiko -configuration Release \
    -destination 'generic/platform=iOS' -archivePath ios/build/Kiko.xcarchive archive
  ```

  then create `ios/build/ExportOptions.plist` (under the gitignored `ios/build/`):

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
  	<key>method</key>
  	<string>app-store-connect</string>
  	<key>destination</key>
  	<string>upload</string>
  	<key>signingStyle</key>
  	<string>automatic</string>
  	<key>teamID</key>
  	<string>M52858LNYL</string>
  	<key>uploadSymbols</key>
  	<true/>
  	<key>manageAppVersionAndBuildNumber</key>
  	<false/>
  </dict>
  </plist>
  ```

  (use the Task B3 Step 2 Team ID if it changed) and run:

  ```bash
  xcodebuild -exportArchive -archivePath ios/build/Kiko.xcarchive \
    -exportOptionsPlist ios/build/ExportOptions.plist -exportPath ios/build/export
  ```

- [ ] **Step 4 (verify):** ASC → the app → **TestFlight** tab → iOS Builds shows `1.0 (1)` as "Processing", then "Ready to Test" (10–30 min). Check the Apple ID's inbox for an "ITMS-9xxxx" warning email; if one mentions a **missing privacy manifest in a third-party pod**, note the pod name and fix it (upgrade the pod, or add the missing manifest) before Task B12 — the app-level `PrivacyInfo.xcprivacy` is already correct.
- [ ] **Step 5 (verify):** the build row shows **no "Missing Compliance" badge** — that is `ITSAppUsesNonExemptEncryption = false` from Task A2 doing its job (see B7).

### Task B6 (MANUAL): App Privacy → Data Not Collected

- [ ] **Step 1:** ASC → the app → **App Privacy** → **Get Started**.
- [ ] **Step 2:** "Do you or your third-party partners collect data from this app?" → **No, we do not collect data from this app**. Do **not** declare Monobank balances or the token as collected — they never leave the device (Keychain + local DB), and `PrivacyInfo.xcprivacy` declares `NSPrivacyCollectedDataTypes` empty; the two must agree.
- [ ] **Step 3:** **Publish**.
- [ ] **Step 4 (verify):** App Privacy page reads **Data Not Collected**; the product-page preview shows the "Data Not Collected" label.

### Task B7 (MANUAL): Export compliance → exempt

- [ ] **Step 1:** Because `ITSAppUsesNonExemptEncryption = false` is in the uploaded Info.plist, ASC asks no per-build encryption questions and the build is immediately usable. Nothing to click.
- [ ] **Step 2 (fallback if ASC still asks, e.g. via App Information → App Encryption Documentation):** "Does your app use encryption?" → **Yes** (HTTPS) → "Does your app qualify for any of the exemptions?" → **Yes** — it uses only standard encryption in Apple's OS (HTTPS/TLS and Keychain) → no export documentation required. Set **App Encryption Documentation → None Required / exempt**.
- [ ] **Step 3 (verify):** TestFlight build `1.0 (1)` shows no "Missing Compliance" badge and no "Provide Export Compliance Information" button.

### Task B8 (MANUAL): Store assets and listing metadata

- [ ] **Step 1 — host the privacy policy and a support page. CONFIRM hosting.** The GitHub repo `drizzer14/pff-ios` is **private**, so its Issues page and Pages cannot serve as public URLs. Recommended default: a new public repo `drizzer14/kiko-site` with GitHub Pages enabled, containing `privacy.md` (the content of `docs/store/privacy-policy.md` from Task A7) and `support.md` (title `Кіко — Підтримка / Support`, one line: how to reach the developer by email, the same address used in Step 6 below). Resulting URLs: `https://drizzer14.github.io/kiko-site/privacy` and `https://drizzer14.github.io/kiko-site/support`. Any other host is fine as long as both pages are publicly reachable without login before submission.
- [ ] **Step 2 — screenshots (6.9", 1320×2868, iPhone-only set).** Use the Release build from Task A7 on the `iPhone 17 Pro Max` simulator (its screen is 1320×2868). Seed the simulator with **fictional** data only — manual accounts and holdings with made-up names and round balances; never a real Monobank-connected account (real balances, masked PANs). Capture, in this order, five screens:
  1. Home tab (net-worth headline and line chart)
  2. Accounts tab (accounts grid)
  3. An account's detail screen (holdings list)
  4. Statistics tab
  5. A holding's detail screen (transactions)

  ```bash
  xcrun simctl io booted screenshot ~/Desktop/kiko-01-home.png   # …-02-accounts, -03-account, -04-statistics, -05-holding
  sips -g pixelWidth -g pixelHeight ~/Desktop/kiko-0*.png
  ```

  Expected per file: `pixelWidth: 1320`, `pixelHeight: 2868`. Upload under **iOS Previews and Screenshots → 6.9" Display**; ASC reuses the set for smaller iPhones. No iPad tab appears because the build declares `UIDeviceFamily = [1]`.
- [ ] **Step 3 — text fields (Ukrainian, the primary locale):**
  - Subtitle (≤30 chars): `Особистий трекер капіталу`
  - Promotional Text: leave empty.
  - Description:

    ```
    Кіко — особистий трекер капіталу, який працює повністю на вашому iPhone.

    Додайте рахунки, картки, депозити, облігації, готівку та криптоактиви — і Кіко покаже ваш сукупний капітал у гривні, доларах, євро або біткоїні з перерахунком за актуальними курсами.

    Що вміє Кіко:
    • Рахунки та вкладення — банк, готівка, крипто, брокер; картки, депозити, облігації, банки Monobank.
    • Сукупний капітал — сума всіх вкладень у вибраній базовій валюті.
    • Статистика — динаміка капіталу та розподіл за валютами й рахунками.
    • Історія операцій — уведена вручну або імпортована.
    • Підключення Monobank лише для читання: введіть свій особистий токен API, і Кіко завантажить баланси та виписки ваших рахунків. Кіко не переказує кошти та не виконує жодних банківських операцій.

    Приватність:
    • Усі дані зберігаються тільки на вашому пристрої.
    • Токен Monobank зберігається в Keychain iOS і нікуди не передається.
    • Без реєстрації, без аналітики, без реклами, без відстеження.

    Кіко не є банком і не є застосунком Monobank. Це особистий інструмент обліку, який лише читає дані за вашим власним токеном.
    ```

  - Keywords (≤100 chars; deliberately **without** `monobank` — a third-party trademark in keywords is a Guideline 2.3.7 risk and it sharpens the 3.2.1(viii) question; the description names it factually instead): `капітал,фінанси,облік,баланс,депозит,крипто,заощадження,валюта,статистика,інвестиції`
  - Support URL: the support page from Step 1.
  - Marketing URL: leave empty.
  - Privacy Policy URL (App Information → Privacy Policy): the privacy page from Step 1.
  - Copyright: `2026 <legal name from Task B1 Step 2>`.
  - Version: `1.0`.
- [ ] **Step 4 — Age Rating questionnaire:** answer **None / No** to every content question (violence, sexual content, profanity, horror, medical, gambling, contests, unrestricted web access, user-generated content, parental controls). Expected result: **4+**.
- [ ] **Step 5 — Pricing and Availability:** Price **Free**; Availability **all countries or regions** (default). **CONFIRM** — the spec is silent; restricting to Ukraine is the alternative if the user prefers it.
- [ ] **Step 6 — App Review Information:** Sign-in required **No** (the app has no accounts); Contact first/last name and phone = the developer's; Contact email = the developer's personal (Apple ID) email — **CONFIRM** which address; Notes = filled in Task B12 Step 2.
- [ ] **Step 7 — Version Release:** **Manually release this version**.
- [ ] **Step 8 (verify):** the 1.0 page shows no red "required" markers; the App Information page shows the Privacy Policy URL; opening both URLs in a private browser window returns the pages.

### Task B9 (MANUAL): Localization check (Ukrainian primary)

- [ ] **Step 1:** ASC primary language is Ukrainian (set in Task B4). Do not add an English localization for 1.0 — out of scope.
- [ ] **Step 2 (verify on device, after Task B10 installs the TestFlight build):** iPhone → Settings → General → Language & Region → add `Українська` and make it primary → Home Screen label under the Кіко icon reads `Кіко`; Spotlight search for `Кіко` finds the app. Switch back to English → label still `Кіко` (base `CFBundleDisplayName`).

### Task B10 (MANUAL): TestFlight beta — validate the real Monobank connect flow

- [ ] **Step 1:** ASC → TestFlight → Internal Testing → `+` → group name `Кіко internal` → add the developer's Apple ID as tester → enable build `1.0 (1)`.
- [ ] **Step 2:** On the iPhone, install **TestFlight** from the App Store, accept the invite email, install Кіко.
- [ ] **Step 3 — connect flow, end to end, with the developer's own real token** (obtain it at `https://api.monobank.ua`; never paste it into the repo, a doc, or a chat log):
  1. **Accounts** tab → **Add account** → Kind **Bank** → name it → save.
  2. Open the new account → paste the token into the field with placeholder **Monobank token** → **Save**.
  3. Tap **Connect Monobank** → holdings (cards, jars) appear with balances; the header's last-sync time updates.
  4. Tap **Sync now** → completes without error.
  5. **Home** tab shows the updated net worth; **Statistics** renders.
  6. Back in the account → **Disconnect Monobank** → confirm → the account turns manual and the token is gone (tapping **Connect Monobank** again shows `Add your Monobank token above before connecting.`).
- [ ] **Step 4 — smoke:** cold start from a killed state; light/dark icon on the Home Screen; portrait-only rotation; the Ukrainian-locale check from Task B9 Step 2.
- [ ] **Step 5 (verify):** every step above passes on the TestFlight build, not only on the simulator. Any failure goes back to the developer as a bug before Task B11.

### Task B11 (MANUAL gate): Pre-submit deep check

The spec lists this last but says "before the final submit" — so it runs here, before Task B12.

- [ ] **Step 1 (agent may run):**

  ```bash
  npm run check:deep
  ```

  Expected: mutation score ≥ 60; osv-scanner reports only the two accepted `image-size` advisories (GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr) documented in `CLAUDE.md` — anything else is a real finding to fix first.
- [ ] **Step 2:** Task B10's device smoke test passed on the exact build number about to be submitted.
- [ ] **Step 3 (verify):** `git status --short` clean on `drizzer14/pff-app-store`; the archived build number equals `CURRENT_PROJECT_VERSION` in the pbxproj.

### Task B12 (MANUAL): Submit for review with the 3.2.1(viii) framing and a demo token

- [ ] **Step 1:** ASC → 1.0 → Build → `+` → select `1.0 (1)` (or the latest re-uploaded build).
- [ ] **Step 2 — App Review Information → Notes**, paste verbatim (the spec's draft plus the reviewer steps, which point at the real UI labels):

  ```
  Кіко is a personal, read-only net-worth tracker. It does not move money, execute trades, or act as a financial institution or intermediary. Users who choose to connect Monobank do so with their own personal read-only API token, entered directly by the user; the app only fetches account balances and transaction history to display them locally. No banking credentials, balances, or transaction data are ever transmitted to the developer or any third party — all data is stored on-device (Keychain for the token, a local database for everything else). A demo Monobank token is provided below so the review team can exercise the connect flow without needing a real bank account.

  How to test the Monobank connection:
  1. Accounts tab → "Add account" → Kind: Bank → give it any name → save.
  2. Open the account → paste the demo token into the "Monobank token" field → Save.
  3. Tap "Connect Monobank". Cards and jars from the demo account appear with balances. "Sync now" re-imports; "Disconnect Monobank" removes the token from the Keychain.
  No sign-in, account creation, or payment exists anywhere in the app.

  Demo Monobank token: <paste the token here, in this field only>
  ```

- [ ] **Step 3 — the demo token.** Monobank has no sandbox: the token must be a real personal token issued at `https://api.monobank.ua` for an account the developer controls. Recommended: a dedicated secondary Monobank account with a small balance, so reviewers never see the developer's primary finances. **CONFIRM** which account. After review completes (approve or reject), revoke that token at `https://api.monobank.ua` and issue a new one for any resubmission. The token lives in the ASC Notes field only.
- [ ] **Step 4:** **Add for Review** → **Submit to App Review**.
- [ ] **Step 5 (verify):** status changes to **Waiting for Review**; the confirmation email arrives.
- [ ] **Step 6 — if rejected under Guideline 3.2.1(viii):** reply in the Resolution Center restating the three points (read-only; user's own token; nothing leaves the device) and pointing at the "Data Not Collected" label and the privacy policy. If rejected a second time, file an appeal with the App Review Board (Resolution Center → "Appeal"). This is an accepted risk, not a plan failure — report it to the user rather than changing the app's framing or features to satisfy the reviewer without a decision.
- [ ] **Step 7 — on approval:** Version Release is manual (Task B8 Step 7) → press **Release This Version** when the user says so.

---

## Self-review against the spec

Spec section → task:

- Branch note (land on `kiko-ux-round`, do not redo icon/display name) → A1 (verified as preconditions).
- Config table: `CFBundleDisplayName` → A1 (already done, verified); `app.json displayName` → A5; `uk.lproj/InfoPlist.strings` → A6; `ITSAppUsesNonExemptEncryption` → A2; remove `NSLocationWhenInUseUsageDescription` → A2; `IPHONEOS_DEPLOYMENT_TARGET` ×4 → A3; `platform :ios` unchanged → A3 Step 1; `TARGETED_DEVICE_FAMILY` ×2 → A4; icon PNGs carried forward → A1; optional `~ipad` orientation key → A4 (removed, decision recorded).
- "Do not touch" list → Global Constraints; team ID gets a conditional check in B3 Step 2 (see findings below).
- Process 1–12 → B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B12 (submit), B11 (gate, reordered ahead of submit as the spec's own wording requires).
- 3.2.1(viii) framing + review-note draft → B12 Step 2 (verbatim, plus reviewer steps); appeal stance → B12 Step 6.
- Other risks: pod privacy manifests → B5 Step 4; privacy-policy URL → A7 Step 5 + B8 Step 1; demo token → B12 Step 3; account deletion N/A → no task (nothing to do).
- Assumptions 1–3 → surfaced at A4 (iPhone-only), B1 Step 2 (Individual), A1 Step 3 / B4 Step 3 (name).
- Affected files → File Structure table (all seven paths).

## Findings outside the spec (not tasks — coordinator decision needed)

1. **Launch screen still says "Kiko".** `ios/Kiko/LaunchScreen.storyboard:19` has a label with `text="Kiko"` and line 24 a label `text="Powered by React Native"`. The first thing a reviewer sees on cold start will be "Kiko", not "Кіко". Concrete fix if approved: change `text="Kiko"` to `text="Кіко"` and delete the `Powered by React Native` label element (id `MN2-I3-ftu`) plus its constraints. Not in the spec, so not scheduled here.
2. **Team ID may change on enrollment.** The spec lists `DEVELOPMENT_TEAM = M52858LNYL` as "already correct", but if that ID belongs to a free Personal Team, paid enrollment issues a different Team ID. B3 Step 2 handles it conditionally.
3. **In-app copy is English, store listing is Ukrainian.** All UI strings (`Connect Monobank`, `Sync now`, `Add account`, tab titles) are English; the screenshots will show English UI under a Ukrainian listing. Acceptable for review, but worth a conscious decision.
4. **`ios/build-attempt2.log` (1.7 MB) is tracked in git.** Unrelated hygiene; remove in a separate change.
5. **Hosting for the privacy/support pages is undecided** (spec says so) and the repo is private, so GitHub Pages on this repo is not an option. B8 Step 1 proposes a public `kiko-site` repo as the default.
