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

const Screen: FC<ScreenProps> = ({ children, scroll = false, footer }) => {
  // The native glass tab bar floats over the screen's bottom edge, so every
  // footer must clear it — universally, from this one place — rather than each
  // screen re-solving it. Lift the footer by the bar's measured height plus the
  // bottom safe-area inset. Every current Screen consumer is nested under the
  // native tab navigator (see `root.navigator.tsx`), so the hook always has its
  // context here; the global Jest manual mock returns 0 for standalone renders.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const footerClearance = tabBarHeight + insets.bottom;

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
          <View testID="screen-footer" style={styles.footer(footerClearance)}>
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
};

export default Screen;
