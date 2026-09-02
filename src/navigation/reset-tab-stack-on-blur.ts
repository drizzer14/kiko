import { type NavigationProp, type ParamListBase, StackActions } from '@react-navigation/native';

/**
 * `screenListeners` for a tab's native stack that pops it back to its root
 * whenever the tab is left.
 *
 * A native stack keeps its pushed screens across tab switches, so returning to
 * a tab would otherwise restore the last-pushed detail instead of the tab
 * root. A screen `blur` fires both on an in-stack push and on a tab switch, so
 * the reset is gated on the parent tab no longer being focused: `getParent()`
 * resolves to the tab route hosting the stack, and its `isFocused()` is only
 * `false` once another tab is active. In-stack navigation is left untouched.
 * The reset is additionally gated on `getState().index > 0` — the stack must
 * hold a pushed screen to pop; dispatching `popToTop` on an already-rooted
 * stack is not a no-op, it makes react-navigation warn that `POP_TO_TOP` was
 * not handled because there is nothing to go back to.
 */
export const resetTabStackOnBlur = ({
  navigation,
}: {
  navigation: NavigationProp<ParamListBase>;
}) => ({
  blur: () => {
    if (navigation.getParent()?.isFocused() === false && navigation.getState().index > 0) {
      navigation.dispatch(StackActions.popToTop());
    }
  },
});
