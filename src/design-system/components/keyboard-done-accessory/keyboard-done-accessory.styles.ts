import { StyleSheet } from 'react-native-unistyles';
import { darkTheme } from '@kiko/design-system/theme';

// The Done pill's minimum height (and tap target) — the iOS HIG 44pt minimum
// touch target (`kiko-design-system`'s "Touch targets" HIG axis), the same
// floor `button.styles.ts`'s `COMPACT_MIN_HEIGHT` and `bottom-sheet.styles.ts`'s
// `GRABBER_REGION_MIN_HEIGHT` restore for their own controls. Also the pill's
// actual rendered height, not just its floor: its only content is the single
// short `t('common.done')` label, well under 44pt tall, so `minHeight` is what
// binds — see `KEYBOARD_ACCESSORY_HEIGHT` below, which relies on this being
// the pill's real height, not merely a lower bound.
const DONE_PILL_MIN_SIZE = 44;

// The accessory container's own top/bottom padding step (`accessoryContainer`
// below applies it via `paddingVertical`, i.e. both edges) — pulled out so
// `KEYBOARD_ACCESSORY_HEIGHT` derives from the SAME token the container
// itself uses, rather than a second, drifting copy of "2".
const ACCESSORY_VERTICAL_PADDING_STEP = 2;

// The accessory's total on-screen height: the Done pill's own height
// (`DONE_PILL_MIN_SIZE`) plus the container's top AND bottom padding
// (`ACCESSORY_VERTICAL_PADDING_STEP`, doubled for both edges). Exported for
// `BottomSheet` (`bottom-sheet.component.tsx` / `bottom-sheet.keyboard.ts`)
// to lift its sheet to the BOTTOM of this strip — the real top of the
// keyboard's keys — rather than the strip's top, which left the dark modal
// scrim showing through the strip's own transparent container as a black
// band (device bug, builds 17/18). A statically-known constant, not an
// `onLayout` measurement, because both of its inputs are themselves fixed
// design tokens rather than measured/dynamic content (see `DONE_PILL_MIN_SIZE`'s
// own doc for why the pill's height is exactly its floor).
export const KEYBOARD_ACCESSORY_HEIGHT =
  DONE_PILL_MIN_SIZE + 2 * darkTheme.spacing(ACCESSORY_VERTICAL_PADDING_STEP);

export const styles = StyleSheet.create((theme) => ({
  // The InputAccessoryView host. REDESIGN (2026-09-14): this used to be a
  // full-width, flush toolbar bar with its own solid fill, top hairline, and
  // bottom-rounded corners tucked against the keyboard's own curve (see git
  // history — commits ed4cceb/5aa3fda/0faaab3 — for that bar's now-removed
  // layering). It is now fully TRANSPARENT — no fill, no border, no corner
  // geometry of its own — and exists only to position the compact Done pill
  // below: full width so the pill can right-align within it
  // (`alignItems: 'flex-end'`), with `paddingBottom` holding the pill clear of
  // the keyboard's own top edge (the floating gap) and `paddingHorizontal`
  // matching the app's standard edge inset so the pill lines up with content
  // above it.
  accessoryContainer: {
    alignItems: 'flex-end',
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(ACCESSORY_VERTICAL_PADDING_STEP),
  },
  // The Done pill itself: a `Pressable` sized to hug its own label (intrinsic
  // width) rather than stretching full width, with comfortable horizontal
  // padding and the 44pt HIG floor on height (see `DONE_PILL_MIN_SIZE`) — no
  // separate `minWidth` floor: the label is always `t('common.done')`, and
  // `theme.spacing(5)` horizontal padding on both sides already pushes the
  // pill past 44pt wide, so a width floor could never bind. `doneGlass`
  // (below) is an absolutely-positioned sibling filling these exact bounds,
  // so this View's own padding/minHeight — not `doneGlass` — is what
  // determines the pill's final size; the label centers inside it above the
  // glass.
  doneButton: {
    minHeight: DONE_PILL_MIN_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(5),
  },
  // The live Liquid Glass fill: an absolutely-positioned sibling painted
  // BEHIND the Done label, sized to match `doneButton`'s own rendered bounds
  // exactly (no extension past any edge — unlike the old bar, this pill has
  // no keyboard-curve mismatch to route around, since it floats clear of the
  // keyboard entirely). `GlassSurface`'s `material` variant is the same
  // live-blur variant `BottomSheet` uses for its own card background (no
  // color-pinning backdrop, so it samples the real content behind the pill on
  // the glass path; a translucent, never-opaque fallback fill elsewhere).
  // `radius="full"` (see its own doc in `glass-surface.props.d.ts`) rounds
  // this into a true capsule at whatever height the pill resolves to.
  doneGlass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // The Done label: white (`textPrimary` — pure white on this dark theme, see
  // its own doc in `theme.ts`), replacing the earlier blue `accent` tone now
  // that Done is a neutral glass pill rather than a tinted link-style action.
  // `textPrimary`, not `onAccent`: this pill carries no filled accent/
  // destructive background (`onAccent` is reserved for text on THAT kind of
  // fill, per `kiko-design-system`'s "The `onAccent` rule") — it is a neutral
  // translucent glass surface, the same class of surface the settings/system
  // cards already pair with `textPrimary` labels. Semibold here so Done still
  // reads as the keyboard's emphasized action.
  doneLabel: {
    fontWeight: '600',
  },
}));
