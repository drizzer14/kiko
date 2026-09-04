# Plan: Kiko app scaffold (bare React Native, iOS only)

## Metadata

- **Goal:** Scaffold a bare React Native app, latest iOS only, TypeScript, in the `pff-ios` repository. Preserve the existing `.git` and `.claude` directories.
- **Spec:** `docs/superpowers/specs/2026-08-30-kiko-scaffold-and-harness-design.md` (Section 3 only).
- **Tech stack:** React Native (Community CLI), TypeScript, Xcode 26.6, CocoaPods, Ruby, Jest (the default React Native test).
- **Scope:** This plan covers the app scaffold only. It does not cover the quality harness (plan #2). It does not cover the agent plugin (plan #3).
- **Status:** Not started.

## Branch isolation note

This plan runs inside an Orca worktree on its own branch. Every commit step commits to that worktree branch only. The coordinator presents the branch to the user before any merge to `main`. No task in this plan merges to `main`.

## Global Constraints

- iOS only. Remove `android/` and the Android scripts.
- TypeScript: try the TS 7 native preview first. Roll back to TS 5.x stable if Metro, Jest, or typecheck break.
- Use `@react-native-community/cli init`.
- Preserve the existing `.git`, `.claude`, and `docs/` directories. Init into a temporary directory, then move the files in.
- Ruby must be 3.1 or later for CocoaPods. Node is 22.20. Xcode is 26.6.
- App and project name: `Kiko`.

---

## Task 1 — Tooling preflight

Verify the toolchain before any scaffold. Fix Ruby if it is too old.

**Files:**

- None created. This task inspects and prepares the machine only.

**Steps:**

- [ ] Verify Node is version 22:
  ```bash
  node --version   # expect: v22.x
  ```
- [ ] Verify Xcode and the command line tools:
  ```bash
  xcodebuild -version   # expect: Xcode 26.6
  xcode-select -p       # expect: a path ending in /Contents/Developer
  ```
- [ ] Check the current Ruby version:
  ```bash
  ruby --version   # current machine: 2.7.5 — too old
  ```
- [ ] If Ruby is below 3.1, install Ruby 3.3 with rbenv:
  ```bash
  brew install rbenv ruby-build   # if rbenv is absent
  rbenv install 3.3.5
  rbenv local 3.3.5               # writes .ruby-version in the repo
  eval "$(rbenv init - zsh)"
  ruby --version                  # expect: ruby 3.3.5
  ```
- [ ] Install and verify bundler and CocoaPods:
  ```bash
  gem install bundler
  bundle --version                # expect: Bundler version 2.x
  gem install cocoapods
  pod --version                   # expect: 1.14 or later
  ```

**Verification:**

- [ ] `node --version` prints `v22.x`.
- [ ] `xcodebuild -version` prints `Xcode 26.6`.
- [ ] `ruby --version` prints `ruby 3.3.x`.
- [ ] `bundle --version` and `pod --version` both print a version, not an error.

**Commit:**

- [ ] Commit only if `.ruby-version` was created at the repo root:
  ```bash
  git add .ruby-version
  git commit -m "chore: pin Ruby 3.3.5 for iOS toolchain"
  ```

---

## Task 2 — Init the bare React Native app and move it into the repo root

Init into a temporary directory. Then move the files in without clobbering `.git`, `.claude`, or `docs/`.

**Files:**

- Adds the React Native app files at the repo root: `package.json`, `index.js`, `App.tsx`, `ios/`, `tsconfig.json`, `metro.config.js`, `babel.config.js`, `jest.config.js`, `Gemfile`, `.ruby-version`, and more.

**Steps:**

- [ ] Create the temporary directory outside the repo:
  ```bash
  TMP="$(mktemp -d)/kiko-init"
  mkdir -p "$TMP"
  ```
- [ ] Init the bare app into the temporary directory:
  ```bash
  npx @react-native-community/cli@latest init Kiko --directory "$TMP/Kiko" --skip-git-init --pm npm
  ```
- [ ] Confirm the app generated in the temporary directory:
  ```bash
  ls "$TMP/Kiko/package.json" "$TMP/Kiko/index.js" "$TMP/Kiko/ios"
  ```
- [ ] Move the app files into the repo root. Use rsync to protect `.git`, `.claude`, and `docs/`:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  rsync -a --exclude='.git' --exclude='.claude' --exclude='docs' "$TMP/Kiko/" ./
  ```
- [ ] Remove the temporary directory:
  ```bash
  rm -rf "$TMP"
  ```

**Verification:**

- [ ] The app files exist at the repo root and the preserved directories are intact:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  ls package.json index.js ios App.tsx   # all present
  ls -d .git .claude docs                # all still present
  ```

**Commit:**

- [ ] Commit the scaffold:
  ```bash
  git add -A
  git commit -m "feat: scaffold bare React Native app (Kiko)"
  ```

---

## Task 3 — iOS-only cleanup

Remove the Android platform and its scripts.

**Files:**

- Removes `android/`.
- Edits `package.json` to drop Android scripts.

**Steps:**

- [ ] Remove the Android directory:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  rm -rf android
  ```
- [ ] Remove any Android script from `package.json`. Open `package.json` and delete the `"android": "react-native run-android"` line from `scripts`. Keep the `ios`, `start`, and `test` scripts.

**Verification:**

- [ ] No Android reference remains in the tracked project files:
  ```bash
  grep -rIl --exclude-dir=node_modules --exclude-dir=.git -e "run-android" -e "android/" package.json scripts 2>/dev/null
  # expect: no output (exit code 1)
  ```
- [ ] The `android/` directory is gone:
  ```bash
  ls android 2>/dev/null   # expect: no such file or directory
  ```

**Commit:**

- [ ] Commit the cleanup:
  ```bash
  git add -A
  git commit -m "chore: remove Android platform (iOS only)"
  ```

---

## Task 4 — TypeScript version selection

Try the TS 7 native preview first. Roll back to TS 5.x stable if the toolchain breaks.

**Decision rule:** If `tsgo` typecheck, the Metro bundle, or the Jest test fails on the TS 7 preview, then roll back to TS 5.x stable and re-run the same three checks.

**Files:**

- Edits `package.json` `devDependencies` (the TypeScript entry).

**Steps (TS 7 preview path):**

- [ ] Install the TS 7 native preview:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  npm install -D @typescript/native-preview
  ```
- [ ] Typecheck with `tsgo`:
  ```bash
  npx tsgo --noEmit
  ```
- [ ] Build a Metro bundle:
  ```bash
  npx react-native bundle --platform ios --entry-file index.js --bundle-output /tmp/kiko-main.jsbundle --dev false
  ```
- [ ] Run the default Jest test:
  ```bash
  npm test
  ```

**Steps (roll back to TS 5.x — only if any TS 7 check fails):**

- [ ] Remove the preview and install stable TypeScript:
  ```bash
  npm uninstall @typescript/native-preview
  npm install -D typescript@5
  ```
- [ ] Re-run the three checks with the stable compiler:
  ```bash
  npx tsc --noEmit
  npx react-native bundle --platform ios --entry-file index.js --bundle-output /tmp/kiko-main.jsbundle --dev false
  npm test
  ```

**Verification:**

- [ ] The chosen path passes all three checks: typecheck, the Metro bundle, and `npm test`.
- [ ] Record the chosen TypeScript version in the commit message.

**Commit:**

- [ ] Commit the selection:
  ```bash
  git add -A
  git commit -m "chore: select TypeScript version for scaffold"
  ```

---

## Task 5 — iOS build and smoke verification

Install the pods, build the app, boot it on a simulator, and run the tests.

**Files:**

- Adds `ios/Pods/` and `ios/Podfile.lock` (Podfile.lock is committed; Pods are usually gitignored by the template).

**Steps:**

- [ ] Install the Ruby gems for the iOS build:
  ```bash
  cd /Users/drizzer14/Developer/Projects/pff-ios
  bundle install
  ```
- [ ] Install the CocoaPods dependencies:
  ```bash
  bundle exec pod install --project-directory=ios
  ```
- [ ] List an available simulator:
  ```bash
  xcrun simctl list devices available | grep iPhone
  ```
- [ ] Build and boot the app on a simulator:
  ```bash
  npx react-native run-ios --simulator "iPhone 16"
  ```
- [ ] Run the default Jest test:
  ```bash
  npm test
  ```

**Verification:**

- [ ] `bundle exec pod install` finishes with "Pod installation complete".
- [ ] `npx react-native run-ios` builds and the app boots in the simulator (the default React Native screen appears).
- [ ] `npm test` passes.

**Commit:**

- [ ] Commit the lockfile:
  ```bash
  git add ios/Podfile.lock Gemfile.lock
  git commit -m "chore: lock iOS pods and gems"
  ```

---

## Done criteria

- [ ] All five tasks pass their verification.
- [ ] The app builds and boots on an iOS simulator.
- [ ] `npm test` passes.
- [ ] The `.git`, `.claude`, and `docs/` directories are intact.
- [ ] No `android/` directory and no Android scripts remain.
- [ ] The chosen TypeScript version is recorded in a commit.
- [ ] All commits are on the worktree branch. Nothing is merged to `main`.
