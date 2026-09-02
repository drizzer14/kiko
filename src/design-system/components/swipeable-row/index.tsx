import { type FC, type ReactNode, useRef, useState } from 'react';
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

type SwipeableRowProps = {
  children: ReactNode;
  onDelete: () => void;
  disabled?: boolean;
  confirmTitle?: string;
  confirmMessage?: string;
  testID?: string;
};

// Width the row travels to fully reveal the delete action, and the drag
// distance past which a release snaps open instead of closed.
const ACTION_WIDTH = 88;
const OPEN_THRESHOLD = ACTION_WIDTH / 2;

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
}) => {
  const { theme } = useUnistyles();
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  // Whether the row is swiped open (delete action revealed). Gates the
  // action's presence in the accessibility tree so a screen reader cannot
  // reach "Delete" on a visually-closed row.
  const [isOpen, setIsOpen] = useState(false);

  // The pan responder closes over stable refs, so it is built once via a
  // lazy ref initializer rather than a memo (no dependency list to keep in
  // sync, no stale-closure risk). setIsOpen's identity is stable across
  // renders, so capturing it here once is safe.
  const responderRef = useRef<PanResponderInstance | null>(null);
  if (responderRef.current === null) {
    const snapTo = (value: number) => {
      offset.current = value;
      setIsOpen(value !== 0);
      Animated.spring(translateX, { toValue: value, useNativeDriver: true }).start();
    };
    responderRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_e, gesture) =>
        Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 4,
      onPanResponderMove: (_e, gesture) => {
        const next = Math.min(0, Math.max(-ACTION_WIDTH, offset.current + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_e, gesture) => {
        const next = offset.current + gesture.dx;
        snapTo(next < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0);
      },
    });
  }
  const panResponder = responderRef.current;

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
    <View style={styles.container} testID={testID}>
      {/* When closed, the action stays mounted (for the reveal animation)
          but is removed from the accessibility tree so a screen reader
          cannot reach a visually-hidden "Delete". It flips to reachable
          once the row is swiped open. */}
      <View
        style={styles.actionLayer}
        pointerEvents="box-none"
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete"
          onPress={confirmDelete}
          style={[styles.deleteAction, { backgroundColor: theme.colors.negative }]}
        >
          <Text style={styles.deleteLabel}>Delete</Text>
        </Pressable>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
};

export default SwipeableRow;
