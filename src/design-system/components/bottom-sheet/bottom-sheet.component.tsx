import { isLiquidGlassSupported, LiquidGlassView } from '@callstack/liquid-glass';
import { type FC, useEffect } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import GlassSurface from '../glass-surface';
import { KEYBOARD_ACCESSORY_HEIGHT } from '../keyboard-done-accessory/keyboard-done-accessory.styles';

import { clampSheetTranslate, shouldDismissSheet } from './bottom-sheet.gesture';
import {
  resolveKeyboardAwareBottomPadding,
  resolveKeyboardAwareMaxHeight,
  resolveKeyboardLift,
} from './bottom-sheet.keyboard';
import type { BottomSheetProps } from './bottom-sheet.props';
import { SHEET_PADDING_STEP, styles } from './bottom-sheet.styles';

// Every sheet caps at 66% of the current window height, no exceptions — a
// tall sheet scrolls past that point instead of growing over the status bar /
// into the notch, via the shared `ScrollView` this primitive wraps `children`
// in by default (see the `scrollable` prop). This lives here, in the ONE
// shared primitive, rather than as a per-call-site prop, so no sheet can
// drift past it the way the icon picker (80%) and the category field (70%)
// each used to hand-roll their own, looser cap.
const MAX_HEIGHT_RATIO = 0.66;

// The iOS system keyboard's own top corners are rounded (a redesigned,
// continuous-corner keyboard shape, iOS 26+) — a curve the keyboard itself
// draws, not something this app controls. The sheet's card, by contrast, has
// a perfectly FLAT bottom edge (see `bottom-sheet.styles.ts`'s `sheet`), so
// once that flat edge lands exactly at the top of the keys
// (`resolveKeyboardLift`), the keyboard's own corner curve exposes a small
// triangular sliver of whatever sits BEHIND both of them at the top-left/
// top-right corners — the dark modal scrim, not the sheet's glass, reading as
// two small black notches (device bug, on-device review). Folding this extra
// distance into the SAME "accessory height" both `resolveKeyboardLift` and
// `resolveKeyboardAwareBottomPadding` already take (see `sheetAnimatedStyle`
// below) lifts the sheet LESS (its bottom edge now extends this far PAST the
// top of the keys, behind them, where its own glass fills the notch) while
// growing the bottom padding by the exact same amount, so the content's own
// position — and the symmetric gap around the Done pill
// (`resolveKeyboardAwareBottomPadding`'s own doc) — stays pixel-identical.
// Measured on an iOS 27 sim Release build (`Maestro` view-hierarchy dump plus
// a pixel-level fit of the corner curve, ~80px on a 3x device -> ~27pt);
// rounded up to a clean spacing step for a small safety margin so the curve
// is always fully covered rather than landing exactly on its edge.
export const KEYBOARD_CORNER_OVERLAP = 28;

// The spring the sheet settles back on when a drag is released short of the
// dismiss threshold: a snappy, non-bouncy return to rest (translateY 0).
const SHEET_SPRING = { damping: 20, stiffness: 220 } as const;

// The drag gesture's jest test id, exported so the component test can look the
// Pan up with `getByGestureTestId` and drive it past / short of the threshold.
export const SHEET_DRAG_GESTURE_TEST_ID = 'bottom-sheet-drag';

/**
 * The one bottom-sheet primitive: a transparent Modal, a full-bleed dismiss
 * scrim, and a bottom-anchored sheet card that owns the correct bottom padding
 * (a single base step plus the bottom safe-area inset, since a Modal renders
 * outside any SafeAreaView). Every hand-rolled `Modal + backdrop + Box` sheet
 * routes through here so the safe-area inset and base padding can never drift
 * (or, as with the filter menu, go missing) per sheet again.
 *
 * The scrim and the sheet are siblings inside the overlay, not parent/child, so
 * a tap on the sheet never reaches the scrim's dismiss handler — the sheet
 * simply sits on top of the scrim in paint order, and the sheet's ScrollView (shared or
 * a call site's own — see `scrollable`) scrolls freely (no
 * `onStartShouldSetResponder` guard is needed).
 *
 * The scrim itself is a frosted dim, not opaque black: a real Liquid Glass
 * blur (`LiquidGlassView`, `effect="regular"`, tinted with `theme.colors.scrim`)
 * on iOS 26+, a flat translucent-black `View` everywhere else, structurally
 * branched on `isLiquidGlassSupported` the same way `GlassSurface` branches —
 * see `kiko-design-system`'s "GlassSurface `isLiquidGlassSupported` branch".
 * `LiquidGlassView` never blocks the dismiss tap: it is a non-interactive
 * (`pointerEvents="none"`) child of the `Pressable` that owns the tap/testID/
 * a11y, not the pressable target itself.
 *
 * DEVICE BUG fix: Liquid Glass draws a native specular rim at the edge of
 * whatever bounds it is given (a `UIGlassEffect` property, not a border/inset
 * this app draws), which at this scrim's original full-screen size landed
 * exactly on the screen edge and read as a sharp 1px hairline around the
 * whole perimeter, on every Modal (all route through this one scrim). Rather
 * than dropping to a flat, non-blurred dim, `styles.backdropFill` keeps the
 * live blur and extends its bounds past all four screen edges
 * (`BACKDROP_RIM_OVERSCAN`), which pushes the rim itself off-screen — the
 * Modal's native window still clips at the real screen edges regardless, so
 * only the uniform blur is ever visible. The sheet CARD's own Liquid Glass
 * (`glassFill` below) is untouched by this — only the full-bleed scrim
 * changed. The rim is only reproducible on an iOS 26+ Liquid Glass device, so
 * this fix needs on-device confirmation, not a simulator/unit-test check.
 *
 * The sheet card's own background is a REAL translucent blur MATERIAL, reusing
 * `GlassSurface`'s `material` variant rather than a fork of its layering — the
 * live see-through Liquid Glass on iOS 26+ (no backdrop under it, so it
 * samples the actual content behind the sheet for a true blur, not a
 * color-pinned near-opaque panel), the same themed flat TRANSLUCENT fallback
 * elsewhere. A modal sheet's backdrop is static while it is open, so the
 * lightness-drift concern that motivates `transparent`'s partial-pin backdrop
 * for a scrolling CARD does not apply here — `material` is `transparent`'s
 * sibling variant for exactly this static-backdrop case (see
 * `glass-surface.props.d.ts`'s `material` doc for the full distinction; this
 * was `transparent` before, which painted a translucent `surfaceTranslucent`
 * backdrop UNDER the glass and muted the live sample into a near-solid dark
 * panel — device feedback). It also takes `bloom` (part of the app-wide
 * bloom rollout — see `glass-surface.props.d.ts`'s `bloom` doc): since
 * `material` already renders no backdrop on the glass path, the only change
 * `bloom` adds here is switching the native `UIGlassEffect` style from
 * `'regular'` to `'clear'`, Apple's more transparent, less legibility-biased
 * material — consistent with the sheet already being the live-sample,
 * static-backdrop surface `bloom` is designed for. It is rendered as an
 * absolutely-positioned first child (`styles.glassFill`), painted BEHIND the
 * grabber and the body content
 * that follow it in JSX, so every sheet in the app picks this up from this one
 * change point. `padding={0}` keeps the card's own existing padding
 * (`styles.sheet`) as the single inset — `GlassSurface`'s own `padding` prop
 * is deliberately unused here, so the two never stack. See `styles.glassFill`
 * for why it is sized slightly larger than the card rather than an exact
 * `absoluteFill`.
 */
const BottomSheet: FC<BottomSheetProps> = ({
  visible,
  onDismiss,
  children,
  header,
  gap = 3,
  animationType = 'fade',
  maxHeight,
  scrollable = true,
  testID,
  backdropTestID,
  backdropAccessibilityLabel,
}) => {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  // `useWindowDimensions` (not a one-shot `Dimensions.get`) so the 66% cap
  // recomputes on rotation, per the design-system requirement.
  const windowHeight = useWindowDimensions().height;
  // The 66% cap is the absolute ceiling — a call site's own `maxHeight` can
  // only tighten it further, never loosen it past 66%.
  const capHeight = windowHeight * MAX_HEIGHT_RATIO;
  const resolvedMaxHeight = maxHeight === undefined ? capHeight : Math.min(maxHeight, capHeight);
  // The sheet's own base bottom-padding step (no safe-area inset) — resolved
  // once, on the JS thread, from the same token `styles.sheet` uses, so the
  // keyboard-aware override below (`resolveKeyboardAwareBottomPadding`) never
  // re-derives it as a second, drifting magic number on the UI thread.
  const sheetBasePadding = theme.spacing(SHEET_PADDING_STEP);

  // The sheet card's live vertical offset, driven by the top grabber's Pan. It
  // rests at 0; a downward drag follows the finger (clamped so it never rises
  // above rest), and a release either dismisses or springs it back.
  const translateY = useSharedValue(0);
  // The sheet's measured height, used to turn the drag distance into the
  // dismiss threshold (a fraction of it). Seeded to the resolved cap so the
  // very first drag — before onLayout has fired — still has a sane threshold.
  const sheetHeight = useSharedValue(resolvedMaxHeight);
  // DEVICE BUG fix: a `KeyboardAvoidingView` around the sheet's OWN body
  // (attempt B) does nothing for a Modal-anchored sheet like this one — a KAV
  // repositions its own subtree within its PARENT's layout, but this sheet's
  // parent is the Modal's own transparent root, which never resizes for the
  // keyboard, so the KAV had zero effect on device. What actually needs to
  // move is the CARD itself: a live keyboard-height shared value, so the
  // card's own translateY (already driven by the drag gesture below) also
  // subtracts it, lifting the whole sheet — its top-pinned search field AND
  // its own shrinking result list — clear of the keyboard.
  // `resolveKeyboardAwareMaxHeight` shrinks the 66% cap by the same live
  // height so the lifted sheet still fits above the keyboard instead of
  // merely sliding up while staying capped against the FULL
  // (keyboard-occluded) window height. Both terms are exactly 0 with no
  // keyboard shown, so every one of the 12+ keyboard-less sheet consumers
  // (date-field, filter-menu, confirm-sheet, etc.) sees no layout change at
  // all — see `bottom-sheet.keyboard.ts`'s own no-op doc.
  //
  // VISUAL fix (build 19): `endCoordinates` (what `keyboardHeight` reads)
  // covers the WHOLE keyboard frame on iOS, including the attached
  // `InputAccessoryView` — the floating "Done" pill strip
  // (`use-keyboard-done-accessory.tsx`) rendered directly above the real
  // keys. Lifting the sheet by that FULL height (builds 17/18) put the
  // sheet's own bottom edge at the TOP of the accessory strip, leaving the
  // strip's own transparent container sitting between the sheet and the
  // keys — the dark modal scrim behind the sheet showed straight through it
  // as a solid black band. `resolveKeyboardLift` lifts by the keys' own
  // height instead (the raw keyboard height minus the accessory's fixed
  // height, `KEYBOARD_ACCESSORY_HEIGHT`), landing the sheet's bottom edge at
  // the BOTTOM of the strip — the real top of the keys — so the accessory now
  // floats directly over the sheet's own glass. `resolveKeyboardAwareMaxHeight`
  // and `sheetAnimatedStyle`'s `paddingBottom` (via
  // `resolveKeyboardAwareBottomPadding`) both take this SAME lift/accessory
  // height so the cap and the padding never drift out of sync with the lift:
  // the padding grows to the accessory's own height MINUS `sheetBasePadding`
  // (build 18 instead dropped the bottom safe-area inset — the wrong
  // direction; a first build-19 pass then set it to the FULL accessory
  // height, which still read wrong — every sheet's content carries its own
  // fixed bottom buffer, the SAME base-padding token, stacked underneath this
  // one, so subtracting it here is what makes the gap above the Done pill
  // match its own fixed gap below to the keys — confirmed on an iOS 27 sim
  // Release build; see `resolveKeyboardAwareBottomPadding`'s own doc for the
  // full derivation). Both reduce to a no-op with no keyboard shown
  // (`keyboardHeight` 0 -> `resolveKeyboardLift` 0), so every one of the 12+
  // keyboard-less sheet consumers (date-field, filter-menu, confirm-sheet,
  // etc.) sees no layout change at all.
  //
  // CRASH fix: this used to read reanimated's own `useAnimatedKeyboard()`,
  // whose native observer (`REAKeyboardEventObserver`) reaches for
  // `[[UIApplication sharedApplication] delegate] window]` — a legacy
  // AppDelegate-owns-the-window assumption. This app runs the iOS UIScene
  // lifecycle (`SceneDelegate` owns the window, `AppDelegate` has none), so
  // that call hit an unrecognized selector and crashed on cold launch, on
  // every screen that renders a `BottomSheet` (all of them, via this one
  // shared primitive). RN core's `Keyboard` events read the frame straight
  // off the notification's `userInfo` — no AppDelegate/window lookup, so it
  // is Scene-safe — and drive the same shared value by hand instead.
  const keyboardHeight = useSharedValue(0);
  useEffect(() => {
    const willChange = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      keyboardHeight.value = withTiming(Math.max(0, windowHeight - event.endCoordinates.screenY), {
        duration: event.duration ?? 250,
      });
    });
    const willHide = Keyboard.addListener('keyboardWillHide', () => {
      keyboardHeight.value = withTiming(0, { duration: 250 });
    });

    return () => {
      willChange.remove();
      willHide.remove();
    };
  }, [keyboardHeight, windowHeight]);
  const sheetAnimatedStyle = useAnimatedStyle(() => {
    // `KEYBOARD_CORNER_OVERLAP` folds into the SAME "accessory height" both
    // `resolveKeyboardLift` and `resolveKeyboardAwareBottomPadding` take (see
    // that constant's own doc): it lifts the sheet less, extending its glass
    // this far PAST the top of the keys to cover the keyboard's own rounded
    // top corners, while growing the bottom padding by the exact same amount
    // so the content's position (and the symmetric Done-pill gap) is
    // unaffected.
    const effectiveAccessoryHeight = KEYBOARD_ACCESSORY_HEIGHT + KEYBOARD_CORNER_OVERLAP;
    const keyboardLift = resolveKeyboardLift(keyboardHeight.value, effectiveAccessoryHeight);

    return {
      transform: [{ translateY: translateY.value - keyboardLift }],
      maxHeight: resolveKeyboardAwareMaxHeight(
        windowHeight,
        keyboardLift,
        MAX_HEIGHT_RATIO,
        maxHeight,
      ),
      paddingBottom: resolveKeyboardAwareBottomPadding(
        sheetBasePadding,
        insets.bottom,
        keyboardHeight.value,
        effectiveAccessoryHeight,
      ),
    };
  });

  // A reopened sheet must start at rest even if it was left mid-drag when it
  // dismissed (the Modal keeps this subtree mounted while hidden), so snap the
  // offset back to 0 whenever the sheet becomes visible again.
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible, translateY]);

  // The Pan is attached to the grabber region ONLY (the grabber pill plus an
  // optional `header` node, never the scrollable body), so it never competes
  // with the sheet's own ScrollView. `.runOnJS(true)`
  // keeps its handlers on the JS thread, per the "runOnJS for non-worklet
  // callbacks" rule — `onEnd` reaches `onDismiss`, a plain prop, not a worklet.
  const dragToDismiss = Gesture.Pan()
    .runOnJS(true)
    .withTestId(SHEET_DRAG_GESTURE_TEST_ID)
    .onUpdate((event) => {
      translateY.value = clampSheetTranslate(event.translationY);
    })
    .onEnd((event) => {
      if (shouldDismissSheet(event.translationY, event.velocityY, sheetHeight.value)) {
        onDismiss();
      } else {
        translateY.value = withSpring(0, SHEET_SPRING);
      }
    });
  // F5 device bug fix: the 66% cap above is forced on every sheet, but a
  // plain-Box sheet rendered no scroll container of its own, so content
  // taller than the cap was simply CLIPPED rather than scrollable. The
  // default path wraps `children` in a `ScrollView` so every sheet scrolls
  // its overflow; `scrollable={false}` opts a sheet that needs its own
  // pinned header/footer/ref-controlled scroll region out of this (see the
  // prop's own docs).
  const body = scrollable ? (
    <ScrollView
      style={styles.scrollBody}
      contentContainerStyle={styles.scrollContent(theme.spacing(gap))}
      showsVerticalScrollIndicator={false}
      testID={testID && `${testID}-scroll`}
    >
      {children}
    </ScrollView>
  ) : (
    <Box gap={gap} style={styles.box}>
      {children}
    </Box>
  );

  return (
    <Modal transparent visible={visible} animationType={animationType} onRequestClose={onDismiss}>
      {/* A Modal portals to its own native root OUTSIDE the app's root
          GestureHandlerRootView, so the sheet's drag Pan would never be
          recognized without this local root wrapping the overlay. */}
      <GestureHandlerRootView style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onDismiss}
          testID={backdropTestID}
          accessibilityRole={backdropAccessibilityLabel === undefined ? undefined : 'button'}
          accessibilityLabel={backdropAccessibilityLabel}
        >
          {isLiquidGlassSupported ? (
            <LiquidGlassView
              effect="regular"
              colorScheme="dark"
              tintColor={theme.colors.scrim}
              style={styles.backdropFill}
              pointerEvents="none"
            />
          ) : (
            <View style={[styles.backdropFill, styles.backdropFallback]} pointerEvents="none" />
          )}
        </Pressable>

        <Animated.View
          style={[styles.sheet(insets.bottom, resolvedMaxHeight), sheetAnimatedStyle]}
          onLayout={(event) => {
            sheetHeight.value = event.nativeEvent.layout.height;
          }}
          testID={testID}
        >
          <GlassSurface
            material
            bloom
            radius="lg"
            padding={0}
            style={styles.glassFill}
            testID={testID && `${testID}-glass`}
          />

          {/* The grabber pill AND an optional `header` node share this one
              draggable region, so a drag anywhere across the header — not just
              the small pill — drives the Pan. `{body}` stays OUTSIDE it, so a
              scrollable body still owns its own touch and scrolls freely. */}
          <GestureDetector gesture={dragToDismiss}>
            <View style={styles.grabberRegion} testID={testID && `${testID}-grabber`}>
              <View style={styles.grabber} />

              {header}
            </View>
          </GestureDetector>

          {body}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
};

export default BottomSheet;
