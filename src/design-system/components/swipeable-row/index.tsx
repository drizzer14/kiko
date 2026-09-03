import { type FC, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  type PanResponderInstance,
  PanResponder,
  Pressable,
  Text,
  View,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import {
  ACTION_WIDTH,
  clampTranslate,
  resolveSnap,
  shouldClaimSwipe,
  shouldMergeEdge,
} from './gesture';

type SwipeableRowProps = {
  children: ReactNode;
  onDelete: () => void;
  disabled?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  testID?: string;
  // Corner radius the row clips to, so the revealed delete action never
  // bleeds past the wrapping card's rounded corners and its own corners
  // match the card exactly. Defaults to theme.radii.lg (the standard
  // GlassSurface card radius) — pass the wrapping card's actual radius
  // (e.g. theme.radii.md, theme.radii.sm) when it differs.
  radius?: number;
};

const styles = StyleSheet.create((theme) => ({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  actionLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  },
  deleteAction: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    // The button's LEFT corners stay square so its inner edge meets the card's
    // squared right edge as one seam; its RIGHT corners (the row's outer edge)
    // take the card radius, applied inline where cornerRadius is known.
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  // A surface-coloured backing pinned to the card's right edge. The wrapped
  // card (a GlassSurface) rounds its own right corners, and overflow-clipping
  // cannot square a child's rounded corner, so this strip paints the two corner
  // notches with the card's surface colour: while the row is open its right
  // corners square off, filling the gap so the card reads flush against the
  // delete button. It sits behind the card content (only the notches show) and
  // in front of the delete action, and is invisible at rest.
  seamFiller: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: theme.colors.surface,
  },
  deleteLabel: {
    color: theme.colors.textPrimary,
    ...theme.typography.body,
    fontWeight: '600',
  },
}));

const SwipeableRow: FC<SwipeableRowProps> = ({
  children,
  onDelete,
  disabled = false,
  confirmTitle = 'Delete',
  confirmMessage = 'This cannot be undone.',
  testID,
  radius,
}) => {
  const { theme } = useUnistyles();
  // theme is only available inside the component body, so the radii.lg
  // default is applied here rather than as a destructured default.
  const cornerRadius = radius ?? theme.radii.lg;
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  // Whether the row is swiped open (delete action revealed). Gates the
  // action's presence in the accessibility tree so a screen reader cannot
  // reach "Delete" on a visually-closed row.
  const [isOpen, setIsOpen] = useState(false);
  // Whether the card's right corners are squared off to meet the delete button
  // as one seam. Driven off the live translateX so the merge snaps in the
  // moment the swipe crosses a small threshold and restores on settle-back;
  // setEdgeMerged with an unchanged boolean is a no-op, so this only re-renders
  // on an actual open/closed flip, not on every drag frame.
  const [edgeMerged, setEdgeMerged] = useState(false);
  useEffect(() => {
    const id = translateX.addListener(({ value }) => {
      setEdgeMerged(shouldMergeEdge(value));
    });

    return () => {
      translateX.removeListener(id);
    };
  }, [translateX]);

  // The pan responder closes over stable refs, so it is built once via a
  // lazy ref initializer rather than a memo (no dependency list to keep in
  // sync, no stale-closure risk). setIsOpen's identity is stable across
  // renders, so capturing it here once is safe.
  const responderRef = useRef<PanResponderInstance | null>(null);
  if (responderRef.current === null) {
    // A stable resting state is the only thing the row is ever allowed to
    // settle at: fully open or fully closed, always animated with a bounded
    // spring so a cancelled or stolen gesture returns cleanly rather than
    // resting partway.
    const snapTo = (value: number) => {
      offset.current = value;
      setIsOpen(value !== 0);
      Animated.spring(translateX, {
        toValue: value,
        useNativeDriver: true,
        bounciness: 0,
      }).start();
    };
    responderRef.current = PanResponder.create({
      // Do not claim on touch-down, so a plain tap on the row still reaches
      // its children.
      onStartShouldSetPanResponder: () => false,
      // activeOffsetX / failOffsetY arbitration: claim the swipe only on a
      // clear, dominant horizontal drag, and never when the movement is
      // vertical (which must fall through to the enclosing list's scroll).
      onMoveShouldSetPanResponder: (_e, gesture) => shouldClaimSwipe(gesture.dx, gesture.dy),
      // Once the horizontal swipe is committed, refuse to hand the gesture
      // back to a parent scroll view mid-drag — that hand-off is exactly what
      // left the row stranded partly open.
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, gesture) => {
        translateX.setValue(clampTranslate(offset.current, gesture.dx));
      },
      onPanResponderRelease: (_e, gesture) => {
        snapTo(resolveSnap(offset.current, gesture.dx));
      },
      // If the gesture is nonetheless terminated (e.g. an ancestor forcibly
      // takes over), still settle to a stable state instead of freezing
      // partway open.
      onPanResponderTerminate: (_e, gesture) => {
        snapTo(resolveSnap(offset.current, gesture.dx));
      },
    });
  }
  const panResponder = responderRef.current;

  // The action layer is mounted behind the row content at all times (so the
  // reveal can animate), but the row itself is a translucent GlassSurface
  // card — an opaque background on the row cannot be assumed. Tying opacity
  // to the same translateX driving the reveal makes the action genuinely
  // invisible (not just accessibility-hidden) at rest, and ramps it in only
  // as the row is actually dragged open, so nothing can bleed through a
  // closed glass card.
  const actionOpacity = translateX.interpolate({
    inputRange: [-ACTION_WIDTH, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const confirmDelete = () => {
    Alert.alert(confirmTitle, confirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  if (disabled) {
    return <View testID={testID}>{children}</View>;
  }

  return (
    // overflow: hidden (in styles.container) plus this same borderRadius is
    // what keeps the revealed delete action clipped to the wrapping card's
    // rounded corners instead of bleeding past them as a square.
    <View style={[styles.container, { borderRadius: cornerRadius }]} testID={testID}>
      {/* When closed, the action stays mounted (for the reveal animation)
          but is removed from the accessibility tree so a screen reader
          cannot reach a visually-hidden "Delete". It flips to reachable
          once the row is swiped open. */}
      <Animated.View
        testID={testID ? `${testID}-actions` : 'swipeable-row-actions'}
        style={[styles.actionLayer, { opacity: actionOpacity }]}
        pointerEvents="box-none"
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete"
          onPress={confirmDelete}
          style={[
            styles.deleteAction,
            {
              backgroundColor: theme.colors.negative,
              // Outer (right) corners take the row's radius; the left corners
              // are squared in styles.deleteAction to meet the card's seam.
              borderTopRightRadius: cornerRadius,
              borderBottomRightRadius: cornerRadius,
            },
          ]}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </Animated.View>

      {/* Behind the card content, in front of the delete action: the surface
          strip that squares the card's right edge against the button. It
          tracks the card via the same translateX and stays invisible at rest
          via the same reveal opacity, so a closed row shows the card's normal
          rounded right corners. */}
      <Animated.View
        testID={testID ? `${testID}-seam` : 'swipeable-row-seam'}
        pointerEvents="none"
        style={[
          styles.seamFiller,
          { width: cornerRadius, opacity: actionOpacity, transform: [{ translateX }] },
          {
            borderTopLeftRadius: cornerRadius,
            borderBottomLeftRadius: cornerRadius,
            borderTopRightRadius: edgeMerged ? 0 : cornerRadius,
            borderBottomRightRadius: edgeMerged ? 0 : cornerRadius,
          },
        ]}
      />

      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
};

export default SwipeableRow;
