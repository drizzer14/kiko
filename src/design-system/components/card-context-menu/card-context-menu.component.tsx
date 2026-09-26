import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import { trigger } from 'react-native-haptic-feedback';
import { type FC, type ReactNode, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import Text from '../text';
import Button from '../button';
import BottomSheet from '../bottom-sheet';
import ConfirmSheet from '../confirm-sheet';

// The gesture's jest test id, exported so the component test can look the
// long-press up with `getByGestureTestId` and drive it.
export const HOLD_GESTURE_TEST_ID = 'card-context-menu-hold';

// The confirm button's jest test id, exported so a consumer's screen test can
// drive the themed delete confirm to completion (every card grid routes its
// delete through here, so they share one selector).
export const DELETE_CONFIRM_TEST_ID = 'card-context-menu-delete-confirm';

// The action-list buttons' jest test ids, exported so a consumer's test can
// drive the CHOICE that a hold opens once `onDuplicate` or `onEdit` is wired.
// Only present then (a delete-only card never renders the action list — it
// opens the confirm directly).
export const DUPLICATE_ACTION_TEST_ID = 'card-context-menu-duplicate';
export const EDIT_ACTION_TEST_ID = 'card-context-menu-edit';
export const DELETE_ACTION_TEST_ID = 'card-context-menu-delete-action';

// A touch-and-hold must stay still for this long to open the delete confirm —
// long enough that a scroll or a drag-to-reorder (which both move the finger)
// is not mistaken for a delete intent.
const HOLD_DURATION_MS = 450;

// ...and must not travel past this many points. Any real movement past it
// CANCELS the long-press, so the finger is free to start the sortables
// drag-to-reorder instead of opening the confirm.
const HOLD_MAX_DISTANCE = 10;

// The `liftOnHold` scale, matched to the SAME `activeItemScale={1.03}` the
// account/holding sortable grids already apply on their own long-press-to-
// drag activation (`accounts.screen.tsx`, `account-detail.screen.tsx`) — a
// barely-there lift, not the library's own bolder `1.1` default. A plain
// (non-sortable) list card, which gets no such lift from a grid, opts into
// the identical feel here instead. `HOLD_LIFT_DURATION_MS` matches
// `react-native-sortables`' own `activationAnimationDuration` default (300ms,
// its `constants/props.js`), so the two lifts settle at the same pace.
const HOLD_LIFT_SCALE = 1.03;
const HOLD_LIFT_DURATION_MS = 300;

/**
 * Wraps a grid card in a self-contained "deep-press (haptic)" delete confirm.
 *
 * A manual (deletable) entity gets a `react-native-gesture-handler` `LongPress`
 * composed alongside — never over — the card:
 *
 * - a quick TAP never activates the long-press (its min duration is not met), so
 *   it falls straight through to the child card's own `onPress` (open detail).
 *   Nothing is layered on top of the card that could swallow the tap.
 * - a touch-and-HOLD that stays still (past `HOLD_DURATION_MS`, within
 *   `HOLD_MAX_DISTANCE`) plays a medium-impact haptic and raises the shared,
 *   themed `ConfirmSheet` (a `BottomSheet`, NOT a native `ActionSheetIOS`),
 *   titled `Delete "<name>"` with a bare destructive `Delete` confirm and no
 *   body. Only that confirm routes to `onDelete`; Cancel and a scrim/back
 *   dismiss delete nothing. The named title keeps an accidental hold from
 *   deleting an unnamed item.
 * - a hold that MOVES past `HOLD_MAX_DISTANCE` fails the long-press, freeing the
 *   finger for the enclosing sortables drag-to-reorder.
 *
 * The confirm's visibility is component state (`confirmVisible`) because a
 * `BottomSheet` lives in the render tree — unlike the old imperative
 * `ActionSheetIOS`. The `LongPress` runs `.runOnJS(true)`, so its `onStart`
 * callback (the haptic bridge plus the `setState`) runs on the JS thread
 * directly, neither being a worklet.
 *
 * A synced (Monobank) entity is not deletable here, so it renders bare — no
 * gesture and no sheet. This keeps the synced guard AND, deliberately, leaves
 * the touch-and-hold free for the enclosing sortables drag to claim, so a
 * synced card can still be reordered.
 *
 * COEXISTENCE NOTE: both this long-press and the sortables drag begin from a
 * hold. A hold that stays still opens this confirm; a hold that moves the finger
 * fails this gesture (`HOLD_MAX_DISTANCE`) and reorders instead; a quick tap
 * opens the card. On-device, `HOLD_DURATION_MS` may need tuning against the
 * grid's drag activation so the two never both fire on a single hold.
 */
const CardContextMenu: FC<{
  name: string;
  deletable: boolean;
  onDelete: () => void;
  // An optional "duplicate this entity" action. When provided, a hold opens a
  // themed CHOICE (Duplicate + Delete) instead of the delete confirm directly;
  // when omitted, the hold keeps its original delete-only behavior byte-for-
  // behavior. Only the transaction rows (Home + the holding-detail ledger) pass
  // it, for manual rows only — the account/holding cards and grids never do.
  onDuplicate?: () => void;
  // An optional "edit this entry" action for a row that has no tap target of
  // its own to open an editor (the holding detail's share changes). Joins
  // the same action list as Duplicate.
  onEdit?: () => void;
  // Opt-in press feedback for a card that sits in a PLAIN (non-sortable)
  // list, matching the barely-there `activeItemScale={1.03}` lift the
  // account/holding sortable grids already get for free from
  // `react-native-sortables`' own drag-activation animation. Defaults to
  // `false`/omitted, which renders the plain (non-`Animated`) `View` byte-
  // for-byte as before — an account/holding card must NEVER pass this, since
  // its grid already lifts the card itself; a second, competing scale here
  // would double-animate it. Only the Home transaction row passes it today.
  liftOnHold?: boolean;
  children: ReactNode;
}> = ({ name, deletable, onDelete, onDuplicate, onEdit, liftOnHold = false, children }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [confirmVisible, setConfirmVisible] = useState(false);
  // The Duplicate/Delete action list's visibility, separate from the delete
  // confirm's: a hold opens THIS when a duplicate action exists, and choosing
  // Delete from it hands off to the confirm sheet below.
  const [actionsVisible, setActionsVisible] = useState(false);
  // The `liftOnHold` scale, driven straight from the JS thread (the whole
  // gesture already runs `.runOnJS(true)` for the haptic/state calls below,
  // so a shared-value write here needs no worklet). Unconditionally created
  // (rules of hooks) but only ever animated away from `1` when `liftOnHold`
  // is true.
  const liftScale = useSharedValue(1);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ scale: liftScale.value }] }));

  const canDuplicate = onDuplicate !== undefined;
  const canEdit = onEdit !== undefined;
  const hasActionList = canDuplicate || canEdit;

  // A card with NO action renders bare — no gesture, no sheet — leaving the
  // touch-and-hold free for an enclosing sortables drag to claim (a synced
  // row keeps its reorder this way).
  if (!deletable && !hasActionList) {
    return <>{children}</>;
  }

  // A hold offers the action-list CHOICE only when a duplicate or edit action exists;
  // otherwise it keeps the original behavior and opens the delete confirm
  // straight away, so every delete-only consumer is unchanged. `liftOnHold`
  // additionally scales the card up on `onStart` and eases it back to 1 on
  // `onFinalize` — which fires on every release, success or failure, so a
  // hold that ends without opening anything (there is none today, but a
  // future short-circuit could add one) still always settles back to rest.
  const holdToActivate = Gesture.LongPress()
    .minDuration(HOLD_DURATION_MS)
    .maxDistance(HOLD_MAX_DISTANCE)
    .runOnJS(true)
    .withTestId(HOLD_GESTURE_TEST_ID)
    .onStart(() => {
      trigger('impactMedium');

      if (liftOnHold) {
        liftScale.value = withTiming(HOLD_LIFT_SCALE, { duration: HOLD_LIFT_DURATION_MS });
      }

      if (hasActionList) {
        setActionsVisible(true);

        return;
      }

      setConfirmVisible(true);
    })
    .onFinalize(() => {
      if (liftOnHold) {
        liftScale.value = withTiming(1, { duration: HOLD_LIFT_DURATION_MS });
      }
    });

  const cancelDelete = (): void => {
    setConfirmVisible(false);
  };

  const dismissActions = (): void => {
    setActionsVisible(false);
  };

  // Duplicate and Edit close the action list first, THEN run the handler
  // (which typically navigates away), keeping the setState off a
  // soon-unmounted node.
  const runDuplicate = (): void => {
    setActionsVisible(false);
    onDuplicate?.();
  };

  const runEdit = (): void => {
    setActionsVisible(false);
    onEdit?.();
  };

  // Delete from the action list hands off to the SAME named confirm sheet the
  // delete-only path uses: close the list, open the confirm.
  const chooseDelete = (): void => {
    setActionsVisible(false);
    setConfirmVisible(true);
  };

  // Close first, THEN delete: `onDelete` typically removes this card from its
  // grid, which unmounts this component — closing before that keeps the
  // setState off an unmounted node.
  const confirmDelete = (): void => {
    setConfirmVisible(false);
    onDelete();
  };

  return (
    <>
      <GestureDetector gesture={holdToActivate}>
        {liftOnHold ? (
          <Animated.View testID="card-context-menu" style={liftStyle}>
            {children}
          </Animated.View>
        ) : (
          <View testID="card-context-menu">{children}</View>
        )}
      </GestureDetector>

      {hasActionList && (
        <BottomSheet
          visible={actionsVisible}
          onDismiss={dismissActions}
          gap={3}
          header={<Text variant="heading">{name}</Text>}
          testID="card-context-menu-actions"
        >
          {canEdit && (
            <Button onPress={runEdit} testID={EDIT_ACTION_TEST_ID}>
              {t('common.edit')}
            </Button>
          )}

          {canDuplicate && (
            <Button onPress={runDuplicate} testID={DUPLICATE_ACTION_TEST_ID}>
              {t('common.duplicate')}
            </Button>
          )}

          {deletable && (
            <Button variant="destructive" onPress={chooseDelete} testID={DELETE_ACTION_TEST_ID}>
              {t('common.delete')}
            </Button>
          )}

          <Button variant="ghost" textColor={theme.colors.negative} onPress={dismissActions}>
            {t('common.cancel')}
          </Button>
        </BottomSheet>
      )}

      <ConfirmSheet
        visible={confirmVisible}
        title={t('common.deleteNamed', { name })}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        destructive
        confirmTestID={DELETE_CONFIRM_TEST_ID}
      />
    </>
  );
};

export default CardContextMenu;
