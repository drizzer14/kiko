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

6. `kiko:ops` archives the Release / KikoDistribution configuration.
7. Verify the archive invariants:
   - `UIDeviceFamily` is `[1]` (iPhone only).
   - The distribution signing identity is used.
   - App Group `group.com.dmytro-vasylkivskyi.kiko` is present and the
     old `group.com.dmytro.pff` is absent.
   - `get-task-allow = false`.
8. Hand off. The skill stops here. The user uploads the archive and
   the screenshots through the Xcode Organizer. State plainly that
   this skill does not upload to the App Store.

## First release

Part A's steps 4-5 (tag + publish) always wait for the App Store to
actually publish, never merely to be submitted — this two-phase
ordering (tag-less archive first, then tag+publish only after
publication) is the general rule for every release, not something
special about this one. `v1.0.0`, the first release, is simply the
first time it applies; these notes record its concrete state:

1. **Earlier, tag-less step — build bump + archive (DONE).** Step 3's
   version-sync ran with `MARKETING_VERSION` going from `1.0` (build
   `2`) to `MARKETING_VERSION=1.0.0` (build `3`), and Part B's archive
   was produced from build `3`. **No git tag was created at this
   step** — step 4 (`git tag`) and step 5 (`gh release create`) were
   deliberately skipped for the first release. Build `3` has since
   been submitted for App Store review.
2. **Later, post-publication step — tag + publish (PENDING).** Create
   the `v1.0.0` tag and run `gh release create` (Part A steps 4-5)
   ONLY after the App Store actually **publishes** the app — being
   "submitted" or "in review" is not enough. Until Apple's review
   finishes and the app goes live, there is no `v1.0.0` tag and no
   GitHub release, even though the archive already exists and is
   already with Apple.

This two-phase ordering is the **general rule for every release, not
an exception for the first one**: Part A's steps 1-5 are written above
as one sequence, but steps 4-5 (tag + publish) always wait for the App
Store to actually publish the app, never merely for it to be
submitted or in review. Step 3 (version sync + archive) always runs
first and always tag-less. `v1.0.0` is simply the first release this
ordering applies to.
