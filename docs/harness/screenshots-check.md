# App Store screenshots — manual marketing procedure

> This file kept its name across the 2026-09-19 purge below (renaming buys
> nothing and breaks cross-links from `.claude/skills/kiko-compliance/SKILL.md`
> and `docs/harness/documented-exceptions.md`), but its content is now a
> checklist, not a check spec.

## 2026-09-19 — the automated subsystem was deleted (Guideline 5.6)

`check:screenshots` and its `:empty`/`:locked` siblings, the pixelmatch
diff engine (`scripts/checks/screenshot-diff/`), the stable-glass build
(`GlassSurface`'s `isStableGlassCapture()` branch and the `StableSurface`
component it rendered), the launch-arg/native capture reader
(`src/test-support/ui-test-capture.ts`, `ios/Kiko/KikoTestEnv.{swift,m}`),
the boot-time seed (`seedScreenshotDataIfEnabled` in `migrations.gate.tsx`),
and the four `.env.screenshots*` files were all **removed outright** — no
`@env` flag, launch argument, or native module survives that makes the app
render differently for a test harness. This is an architecture rule, not a
one-off cleanup: see `.claude/skills/kiko-architecture/SKILL.md`
("Guideline 5.6 — no hidden features"). The Semgrep rule
`kiko-no-hidden-feature-flag-or-demo-import` (`rules/semgrep-mobile.yml`)
mechanizes the ban on any `SCREENSHOT_*` `@env` read or `src/`→`e2e/`
crossing (static import or dynamic `require`) returning.

What survives is a **pure demo dataset**, built once and exported into two
committed `.kiko` files (`e2e/screenshot/fixtures/kiko-demo-uk.kiko`,
`kiko-demo-en.kiko`), that both consumers below load through the app's
**real Import UI** — there is no other entry point. See
`e2e/screenshot/fixtures/README.md` for how the fixtures are built and
regenerated.

The App Store deliverable images this doc's procedure produces
(`screenshots/appstore/**`, 20 PNGs) are **kept** — they are shipped
metadata, not a regression baseline.

## Manual marketing screenshot procedure

There is no script and no automated capture any more. The user shoots the
App Store screenshots by hand, following this checklist.

1. **Device.** Pinned simulator "iPhone 17 Pro Max" — 6.9-inch, 1320x2868,
   portrait-only. Shoot a second pass on a 6.5-inch simulator for the
   second required App Store display size (`screenshots/appstore/6.5-inch/`).
2. **Clock.** Set the simulator's device clock to **2026-09-10** before
   importing data. The demo dataset's `ANCHOR`
   (`e2e/screenshot/seed/screenshot-seed.ts`) is fixed at that date and its
   66 transactions span roughly the 6 months ending there — every "last 30
   days" chart needs the device clock at or after `ANCHOR` to render full.
3. **Data.** Fresh install (or wipe existing data), launch the app, go to
   Settings → Import data, pick `e2e/screenshot/fixtures/kiko-demo-uk.kiko`,
   paste the key from `e2e/screenshot/fixtures/kiko-demo.key`, confirm the
   replace-everything warning, then **cold-relaunch** (kill the app fully,
   reopen) so the imported Ukrainian language setting takes effect on the
   next launch.
4. **Shots — 10 deliverables, in order** (names match the files already
   committed under `screenshots/appstore/6.9-inch/uk/`, which this
   procedure reproduces):
   1. `01-home-networth` — Home tab, top of screen.
   2. `02-home-transactions-scrolled` — Home tab, scrolled to the
      transaction list mid-content.
   3. `03-accounts-grid` — Accounts tab.
   4. `04-account-detail` — an account opened from the Accounts tab.
   5. `05-holding-detail-ledger` — a holding opened from an account.
   6. `06-statistics-net-worth-line` — Statistics tab, net-worth chart.
   7. `07-statistics-account-contribution` — Statistics tab, scrolled to
      the account-contribution block.
   8. `08-statistics-expenses-by-category` — Statistics tab, scrolled to
      the expenses-by-category block.
   9. `09-settings-main` — Settings tab.
   10. `10-settings-system` — Settings tab, scrolled to the system section
       (language, base currency).
5. **Navigation.** Every "return to a tab's root" step is a tab switch,
   not `back` — each of the 4 tab stacks pops itself to root on blur
   (`src/navigation/reset-tab-stack-on-blur/reset-tab-stack-on-blur.ts`), so switching away and
   back always lands on that tab's root screen.
6. **Destination.** Save each shot as `screenshots/appstore/<size>/uk/<name>.png`,
   overwriting the existing file of the same name.

**Known non-determinism — informational only, nothing to exclude any
more.** Shots 2, 7, and 8 above are mid-scroll: they land on whatever frame
`scrollUntilVisible`-style momentum settles on, so the landing offset can
drift a little between shoots of the same screen. There is no pixel-diff
any more, so this is not a gate — it is a note to the human shooter to
eyeball those three frames before accepting them, since nothing else will
catch a bad one.

## The reviewer's copy

`e2e/screenshot/fixtures/kiko-demo-en.kiko` exists for the **App Store
reviewer**, not for this procedure: it carries the same dataset in English
so a reviewer is not handed a Ukrainian-language app. It is referenced in
the resubmission reviewer notes, not shot from directly.
