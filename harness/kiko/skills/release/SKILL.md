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
- On `main`.
- Clean tree (the harmless Xcode `TARGETED_DEVICE_FAMILY`/pbxproj
  normalization is allowed).
- `npm run check:all` is green.

Merging into `main` (coordinator ruling): never apply, merge, rebase,
pull, cherry-pick, revert, or am in the main checkout (what passes:
`-h`/`--help`, the recovery options such as `--abort`/`--continue`,
`git apply --check`/`--stat`, and the `merge --ff-only`/`pull
--ff-only` update forms; see `RECOVERY_OPTIONS` there; the closed set is
`MAIN_CHECKOUT_SUBCOMMANDS` in `scripts/checks/kill-guard.js`)
(`/Users/drizzer14/Developer/Projects/pff-ios`); every session's hooks
run from it, so a conflict marker there breaks every hook. The
kill-guard denies it (see kiko-linter's "MAIN-CHECKOUT deny"). Do the
real merge, conflicts and all, in a separate detached worktree, verify
it there (`npm run check:all`), then fast-forward main:
`git -C /Users/drizzer14/Developer/Projects/pff-ios merge --ff-only <sha>`.

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
4. Tag and push: `git tag vX.Y.Z`, then
   `git push origin main --follow-tags`.
5. Publish:
   `gh release create vX.Y.Z --title "vX.Y.Z" --notes "<changelog>"`.
   Attach NO files.

## Part B — App Store prep, then hand off

Precondition gotcha: in the MAIN checkout, `npm run check:secrets`
(gitleaks over the working tree) can flag Podfile.lock checksums inside
a copied review diff in the untracked `memory/refs/` folder (a false
positive; worktrees pass). Run the release `check:all` in a clean
worktree at the release commit (as done for v1.1.0: next worktree at
1c7c8731), or move the copied diff; never allowlist it silently.

6. `kiko:ops` archives the `Release` configuration (signed with the
   KikoDistribution provisioning profile and the distribution
   certificate). Only Debug and Release configurations exist;
   Release-AdHoc is the device-test configuration only.
7. Verify the archive invariants:
   - `UIDeviceFamily` is `[1]` (iPhone only).
   - The distribution signing identity is used.
   - App Group `group.com.dmytro-vasylkivskyi.kiko` is present and the
     old `group.com.dmytro.pff` is absent.
   - `get-task-allow = false`.
   - The embedded provisioning profile is KikoDistribution.
8. Hand off. First run the Privacy policy check below; hand off only
   when it exits 0. The skill stops here. The user uploads the archive and
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
Never edit the markdown without bumping its effective date; check the
data flows against `src/` and `ios/Kiko/Info.plist` (hosts, pinning,
Keychain surviving uninstall) first. The host list lives in the code
and the md, never copy it here.

### Release notes standing lines

The App Store "What's New" text for 1.1.0 and later ends with
"Requires iOS 18.2 or later." (uk: "Потрібна iOS 18.2 або новіша.").
The notes live in App Store Connect, not in the repo; the changelog
from step 2 is the draft, so add the line there.

### Navigation reachability for review notes

Zero-dependency, no script file, no new dependency — a single grep run
fresh at each submission lists every registered screen name from
`src/navigation/`:

```
grep -h -oE 'name="[A-Za-z]+"' $(find src/navigation -name '*.tsx' ! -name '*.test.tsx') | sort -u
```

Paste the resulting list into the App Store review notes as Guideline
5.6 evidence that every screen is reachable with no flag or env gate
(see "Guideline 5.6 — no hidden features" in `kiko-architecture`). Do
not hardcode the list here — it drifts with every added screen; always
re-run the grep at submission time.

## Lessons from past submissions

Read the live `pbxproj` / git tags directly for the current version
state — do not trust a number restated here, it moves with every
archive.

This two-phase ordering is the **general rule for every release**:
Part A's steps 1-5 are written above as one sequence, but steps 4-5
(tag + publish) always wait for the App Store to actually publish the
app, never merely for it to be submitted, in review, or rejected. Step
3 (version sync + archive) always runs first and always tag-less, even
across multiple rejected submissions.

Durable lessons carried forward from `1.0.0`'s submission history (see
memory `release-5-6-audit-findings` and
`guidelines-compliance-is-architecture-rule` for the full account):

- **Guideline 5.6 (hidden features) is a real rejection risk, twice
  over.** A build was rejected once for a screenshot/demo subsystem
  compiled into the shipping binary, and again for a `SHOW_*`-style
  flag that only hid a not-ready feature (bunq/PrivatBank) from the UI
  while its full client code still shipped. Fix by REMOVING a
  not-ready feature's code entirely, never by flag-hiding it — see
  "Guideline 5.6 — no hidden features" in `kiko-architecture`.
- **A spent build number cannot be resubmitted.** Apple Store Connect
  will not re-accept a build number it has already seen, even after a
  rejection — bump `CURRENT_PROJECT_VERSION` before every re-archive,
  including a same-`MARKETING_VERSION` hotfix re-submission.
