---
name: release
description: Use when publishing a Kiko release — GitHub release tagging/notes and App Store archive prep and handoff.
---

Standing rules:
- Every GitHub release tag is `vX.Y.Z`. Versions follow semantic versioning.
- Release notes list ONLY user-facing changes. Never list internal changes.
- Never attach an app build to a GitHub release. App builds reach the
  App Store only by the user's manual upload.

Preconditions:
- On `main`, or on a `release-X.Y` branch (see "Release branch cut from an older main").
- Clean tree (the harmless Xcode `TARGETED_DEVICE_FAMILY`/pbxproj
  normalization is allowed).
- A queued check-all or verify line for the release sha is green (typed `npm run check:all`
  is denied).

Merging into `main` (coordinator ruling): never commit, apply, merge, rebase,
pull, cherry-pick, revert, or am in the main checkout (what passes for apply, merge, rebase,
pull, cherry-pick, revert and am:
`-h`/`--help`, the recovery options such as `--abort`/`--continue`,
and `git apply --check`/`--stat`; see `RECOVERY_OPTIONS` there; the closed set is
`MAIN_CHECKOUT_SUBCOMMANDS` in `scripts/checks/kill-guard.js`, and `commit` is not in it: a
commit is the `mainMove` kind, where only help passes and `--abort`/`--continue` are denied)
(`/Users/drizzer14/Developer/Projects/pff-ios`); every session's hooks
run from it, so a conflict marker there breaks every hook. The
kill-guard denies it (see kiko-linter's "MAIN-CHECKOUT deny"). Do the
real merge, conflicts and all, in a separate detached worktree, verify
it there with a queued `scripts/job-queue.sh verify` of the merge commit, then fast-forward
main with `bash scripts/ff-main.sh <sha>` (it needs that verify's done.log line to be exit 0;
a raw `merge --ff-only` on main is denied).

Who does what: the coordinator drives Part A (steps 1-5), `kiko:ops`
does step 6, the user does step 8. The skill stops at step 8 — nobody
uploads to the App Store on the user's behalf.

## Part A — GitHub release (coordinator)

1. Pick the version. Show every commit since the last `vX.Y.Z` tag:
   `git describe --tags --match 'v*'` and
   `git log <lasttag>..HEAD --oneline`. Suggest the bump — a breaking
   change is major, a `feat` is minor, a `fix` is patch. The user
   confirms the final X.Y.Z.
2. Build the changelog. Collect `feat:` and `fix:` commits since the
   last tag. Drop internal scopes with a denylist: `chore`, `ci`,
   `build`, `test`, `docs`, `style`, `refactor`, `harness`, `deps`,
   `check`, and merge commits. Present the user-facing draft; the user
   trims it. This text becomes the release notes.
3. Sync the versions:
   - Set `MARKETING_VERSION = X.Y.Z` in ALL configs in
     `ios/Kiko.xcodeproj/project.pbxproj`.
   - Add 1 to `CURRENT_PROJECT_VERSION` (all configs).
   - Set `package.json` `"version"` to `X.Y.Z`.
   - Commit as `chore(release): vX.Y.Z`.
4. Tag and push: `git tag vX.Y.Z` on the release commit, then
   `git push origin <branch> --follow-tags`. The tag waits for App Store
   publication (see "Lessons from past submissions").
5. Publish:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"`.
   Attach NO files.

## Release branch cut from an older main

- Cut `release-X.Y` from the last releasable `main` commit and cherry-pick only the commits that
  ship. Test the picks first with a trial cherry-pick in a scratch worktree (git < 2.40 has no
  `merge-tree --merge-base`).
- Compare the shipped files against `main` per file (`git diff --stat main -- <file>` per file,
  or via `xargs`). A file list passed as ONE shell word compares nothing in zsh. Make sure the
  check can fail.
- Re-derive every user-facing claim (help text, What's New, review notes) against the BRANCH
  code, not `main`: a claim true on `main` can be false on the branch.
- A release branch adds no migration. `src/db/run-migrations.ts` counts the applied rows
  (`readAppliedCount`) and slices the journal (`journal.entries.slice`), so a device that already
  ran `main`'s later migration skips the branch's one silently.
- While a device runs the release build, export `.kiko` only from a `main` build: an older
  build's export drops the columns it does not know (`src/data-transfer/snapshot/read-snapshot.ts`
  selects its own table columns), and `main` does not restore them.
- Before installing the release build over a dev device that ran `main`, prove from the migrator
  what happens (example: 1.2 over `main`'s migration 0058 runs nothing; the extra nullable column
  is ignored). Check `main` for a data-rewriting migration the release branch lacks: 0059
  rescales USDT and, unlike a nullable column, is not harmless. 0060 adds a nullable
  device-local settings column (`history_backfill_state`): an older build drops it. A `main`
  export is read only by `main`-or-later builds (`READABLE_EXPORT_VERSIONS`).
- Release-only commits (claim fixes, version bump, demo regen) stay on the branch, small and
  separate. After publication only the version bump goes to `main` by cherry-pick, and `main`
  regenerates its own demo `.kiko` files (never the branch's binary). Test-infra fixes `main`
  already has are cherry-picked from `main`, never re-authored.
- The mutation gate runs per small change set, base = the branch's cut commit. Paused by the
  user since 2026-10-25 until lifted; verify + review only.

## Part B — App Store prep, then hand off

Precondition gotcha: in the MAIN checkout, `npm run check:secrets`
(gitleaks over the working tree) can flag Podfile.lock checksums inside
a copied review diff in the untracked `memory/refs/` folder (a false
positive; worktrees pass). Run the release `check:all` in a clean
worktree at the release commit (as done for v1.1.0: next worktree at
1c7c8731), or move the copied diff; never allowlist it silently.

After a merge that adds a migration or a snapshot key, regenerate the demo
.kiko fixtures (`KIKO_REGEN_DEMO=1 npx jest e2e/screenshot/fixtures/generate-demo-kiko.test.ts`,
see e2e/screenshot/fixtures/README.md; example commit e764fb6f) and copy
kiko-demo-en.kiko to the reviewer kit before the build bump.

Freshness: the demo dates derive from an anchor set at regen time, so the
files thin out within weeks and go empty. Regenerate both files on the
upload day and again on EVERY resubmission, then refresh the kit
(the reviewer-kit folder is per release: point at the new hand-off folder's reviewer-kit when the
kit is built; kiko-demo.kiko in it = the en file), and do the same
before a screenshot session. The kit's HOW-TO-IMPORT.txt gets the same claim check as the Notes
(a copied text once carried two false claims). Read "The anchor" in
e2e/screenshot/fixtures/README.md for the mechanism and numbers.

The fake bank statement for the reviewer kit is generated, in the main
checkout (the folder is untracked), by
memory/refs/demo-statement/make-fake-statement.py. The upload-day refresh does not rebuild it:
it stays as it is unless the user asks, or its rows no longer fit the reviewer's use. Check the
kit's demo file equals the fresh en file and that the kit's key file opens it (a real decrypt).
The kit folder's own file list is the inventory (never copy its names here); the uk demo file
(kiko-demo-uk.kiko) is in the kit, and the key check covers every .kiko in the kit.

A demo row set that a live rule demo relies on never shares a merchant name with the kit
statement, or the live "Apply to existing" count depends on the import order (the kit statement
has Glovo rows, so the demo uses KFC; see "The live rule demo" in
e2e/screenshot/fixtures/README.md).

The coordinator checks this before it briefs step 6: stop the release if
`src/design-system/unistyles/unistyles.ts` registers a `light` theme and
`ios/Kiko/Info.plist` still has `UIUserInterfaceStyle`: the light theme is registered but the app
cannot yet reach it (a tip with sets 2-5 and no set 6), and set 6 removes the plist key and this
step.

6. `kiko:ops` archives the `Release` configuration (signed with the
   KikoDistribution provisioning profile and the distribution
   certificate). Archive `Release`; `Release-AdHoc` exists only
   for `scripts/deploy-device.sh`.
7. Verify the archive invariants:
   - `UIDeviceFamily` is `[1]` (iPhone only).
   - The distribution signing identity is used.
   - App Group `group.com.dmytro-vasylkivskyi.kiko` is present and the
     old `group.com.dmytro.pff` is absent.
   - `get-task-allow = false`.
   - The embedded provisioning profile is KikoDistribution.
   - `CFBundleShortVersionString` and `CFBundleVersion` equal the bumped values.
   - The Info.plist key DTXcodeBuild names a non-beta Xcode build (betas are 27A5xxx-style;
     see memory `appstore-no-beta-xcode-and-bump-build`).
   - `main.jsbundle` holds no string of a feature the build lacks (grep a distinctive identifier
     with `strings -a | grep -c -F`; plain `grep -c` can print nothing on the 7 MB bundle). This
     string check for an iPad-only feature applies only when the release has an unmerged iPad
     track with `src/` changes to search for; otherwise report it "not applicable" with that
     reason. `UIDeviceFamily` stays the check for iPhone-only.
   - The Xcode SDK carries the iOS version that the `canImport(UIKit, _version: ...)` line in
     `ios/Kiko/DisplayRegions/DisplayRegionsCenter.swift` needs (read DTSDKName from the
     archive); an older SDK silently drops the Duo fold handling.
8. Hand off. First confirm the demo .kiko files and the reviewer kit copies were
   regenerated today, the kit's demo file equals the fresh en file and the kit's key file opens
   every .kiko in it (see the Freshness note above). The kit's HOW-TO-IMPORT.txt carries the
   archive's version and build: update its version line and its "new in X.Y" list each submission
   (plain text). All App Store Connect texts are plain .txt files in the kit, one per field and
   language, no markdown (the fields are plain textareas). Then run the Privacy
   policy check below; hand off only when it exits 0. App Privacy has one answer, "Data Not
   Collected", and the submission info states that one answer. The skill stops here. The user
   uploads the archive and
   the screenshots through the Xcode Organizer. State plainly that
   this skill does not upload to the App Store.

### Privacy policy check (before the upload)

The App Store links the live policy (`https://drizzer14.github.io/kiko`,
`/en.html`), not the repo markdown. Before the user uploads, compare
the markdown's effective date and the hosts it names with the live
page and with the hosts the code contacts:

```
npm run privacy:site -- check
```

It fetches the two public pages (no key, one `fetch` each) and exits 1
with a `DRIFT` line per difference: effective date (md vs live), a host
named on one side only, a host `.env.example`/`src/` names that the md omits. Run
it by hand at submission time; no `check:*` gate calls it (a gate must
not touch the network). On drift, regenerate the pages
(`npm run privacy:site -- build`, output in `docs/privacy-site/`),
have the user approve them, and hand the user the gh-pages publish
commands; the release does not go to upload until `check` exits 0.
Never edit the markdown without bumping its effective date, and re-date it
to the PUBLISH day when gh-pages goes out later than the edit; `npm run
privacy:site -- check` exits 0 before the upload. Check the
data flows against `src/` and `ios/Kiko/Info.plist` (hosts, pinning,
Keychain surviving uninstall) first. The host list lives in the code
and the md, never copy it here.

### What's New format

The App Store "What's New" text is one flat bullet list with no section
headings. List only the major new features and behaviour changes a user
notices, each as "Name: one sentence" or one short sentence; leave out
small UI polish. All fixes collapse into the last line "Bug fixes and
stability improvements." (uk: "Виправлення помилок і покращення
стабільності."); never list individual fixes. The uk text mirrors the en
list item by item (kiko-translator; screen names as in `uk.ts`). The
full change list goes to the GitHub release notes instead. The minimum
iOS is stated by the deployment target and the App Store listing, never
repeated in the What's New text. The notes live in App Store Connect,
not in the repo; the changelog from step 2 is the draft.

### Navigation reachability for review notes

Zero-dependency, no script file, no new dependency — a single grep run
fresh at each submission lists every registered screen name from
`src/navigation/`:

```
grep -h -oE 'name="[A-Za-z]+"' $(find src/navigation -name '*.tsx' ! -name '*.test.tsx') | sort -u
```

Paste the resulting list into the App Store review notes as Guideline
2.5.19 evidence that every screen is reachable with no flag or env gate
(see "Guideline 2.5.19 — no hidden features" in `kiko-architecture`). Do
not hardcode the list here — it drifts with every added screen; always
re-run the grep at submission time. Guideline 2.5.19 is the per-feature duty: describe every
NEW feature of the build specifically in the notes (generic text is rejected); on a release
branch list only what the branch contains.

Guideline 2.3.14 (creative assets): if creative assets are ever added on the product page, they
carry no specific or discounted pricing, no unverifiable product claims, and no reference to
another app that could mislead.

App Review reviews each submitted version, an update included
(Guideline 2.1(a) asks for a complete, final build and, for an app with a
login, demo account information and the back end turned on; App Store Connect Help ties App Review information to
each version). Update notes keep the demo-access steps and add a "what
changed in X.Y and where to find it" list; cut the tour of unchanged
features. A new screen recording is recommended (not required) when new
hard-to-reach features ship (permissions, biometrics); check the
attachment per version. A recording from an earlier version is stale: the user re-records, or
the notes do not claim a recording.

## Lessons from past submissions

Read the live `pbxproj` / git tags directly for the current version
state — do not trust a number restated here, it moves with every
archive.

This two-phase ordering is the **general rule for every release**:
Part A's steps 1-5 are written above as one sequence, but steps 4-5
(tag + publish) always wait for the App Store to actually publish the
app, never merely for it to be submitted, in review, or rejected. Step
3 (the version sync) and step 6 (the archive) always run first and always
tag-less, even across multiple rejected submissions.

Durable lessons carried forward from `1.0.0`'s submission history (see
memory `release-5-6-audit-findings` and
`guidelines-compliance-is-architecture-rule` for the full account):

- **Guideline 2.5.19 (hidden features; formerly 2.3.1(a)) is a real rejection risk, twice
  over.** A build was rejected once for a screenshot/demo subsystem
  compiled into the shipping binary, and again for a `SHOW_*`-style
  flag that only hid a not-ready feature (bunq/PrivatBank) from the UI
  while its full client code still shipped. Fix by REMOVING a
  not-ready feature's code entirely, never by flag-hiding it — see
  "Guideline 2.5.19 — no hidden features" in `kiko-architecture`.
- **A spent build number cannot be resubmitted.** Apple Store Connect
  will not re-accept a build number it has already seen, even after a
  rejection — bump `CURRENT_PROJECT_VERSION` before every re-archive,
  including a same-`MARKETING_VERSION` hotfix re-submission.
- **A spent build's archive is MOVED, never deleted or renamed in place.** Move it out of
  `~/Library/Developer/Xcode/Archives` to `Archives-spent/<name> SPENT-DO-NOT-UPLOAD.xcarchive`.
