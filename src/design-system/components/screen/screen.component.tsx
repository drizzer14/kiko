import type { FC } from 'react';
import { ScrollView, View } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ScreenProps } from './screen.props';
import { styles } from './screen.styles';

// A large-title navigator header owns the top inset itself, so scroll mode
// drops the SafeAreaView's top edge here — keeping it would double-offset
// content beneath the header (see the redesign feedback round-1 brief,
// task 3, for the root cause).
const SCROLL_SAFE_AREA_EDGES = ['left', 'right', 'bottom'] as const;

const Screen: FC<ScreenProps> = ({ children, scroll = false, footer, bleedBottom = false }) => {
  // The native glass tab bar floats over the screen's bottom edge, so any
  // content that reaches the screen's true bottom edge must clear it —
  // universally, from this one place — rather than each screen re-solving it.
  // Lift it by the bar's measured height plus the bottom safe-area inset.
  // Every current Screen consumer is nested under the native tab navigator
  // (see `root.navigator.tsx`), so the hook always has its context here; the
  // global Jest manual mock returns 0 for standalone renders. Used by the
  // scroll branch's `footer` below and by the plain branch's `content` —
  // never both on one render, since `scroll` selects exactly one return path.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const bottomClearance = tabBarHeight + insets.bottom;
  // The plain branch's `content` reserves the clearance itself only when it is
  // both the screen's true bottom edge AND has nothing else claiming that job:
  // a `footer` (pinned below it, see the plain-branch return) or a
  // `bleedBottom` child (a scrollable list applying the clearance to its own
  // content) each own it instead — reserving it in `content` too would count
  // it twice.
  const contentOwnsClearance = !bleedBottom && footer === undefined;

  if (scroll) {
    return (
      <SafeAreaView edges={SCROLL_SAFE_AREA_EDGES} style={styles.safeArea}>
        <ScrollView
          testID="screen-scroll-view"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.scrollContent}
        >
          {children}
        </ScrollView>
        {footer ? (
          <View testID="screen-footer" style={styles.footer(bottomClearance)}>
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  // The plain (non-scrolling) branch: `content` and `footer` (when present)
  // are siblings in the same flex column, `content` taking `flex: 1` — so a
  // short page's footer still lands pinned to the screen's true bottom edge,
  // exactly like the scroll branch's footer, rather than floating directly
  // beneath a short page's content.
  return (
    <SafeAreaView style={styles.safeArea}>
      <View testID="screen-content" style={styles.content(contentOwnsClearance, bottomClearance)}>
        {children}
      </View>
      {footer ? (
        <View testID="screen-footer" style={styles.footer(bottomClearance)}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
};

export default Screen;
