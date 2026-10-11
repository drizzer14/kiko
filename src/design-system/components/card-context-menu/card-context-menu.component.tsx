import { View } from 'react-native';
import either, { bifoldr } from 'fnts/either';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import { trigger } from 'react-native-haptic-feedback';
import { type FC, type ReactNode, useRef, useState } from 'react';
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
// drive the CHOICE that a hold opens once `onDuplicate`, `onEdit`, or
// `closeAction` is wired. Only present then (a delete-only card never renders the
// action list — it opens the confirm directly).
export const DUPLICATE_ACTION_TEST_ID = 'card-context-menu-duplicate';
export const EDIT_ACTION_TEST_ID = 'card-context-menu-edit';
export const CLOSE_ACTION_TEST_ID = 'card-context-menu-close';
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
 * Wraps a grid card in a self-contained "deep-press (haptic)" context menu.
 *
 * A card with any action (deletable, or given `onDuplicate`/`onEdit`/
 * `closeAction`) gets a `react-native-gesture-handler` `LongPress` composed
 * alongside — never over — the card:
 *
 * - a quick TAP never activates the long-press (its min duration is not met), so
 *   it falls straight through to the child card's own `onPress` (open detail).
 *   Nothing is layered on top of the card that could swallow the tap.
 * - a touch-and-HOLD that stays still (past `HOLD_DURATION_MS`, within
 *   `HOLD_MAX_DISTANCE`) plays a medium-impact haptic. On a delete-only card
 *   it raises the shared, themed `ConfirmSheet` (a `BottomSheet`, NOT a
 *   native `ActionSheetIOS`) straight away, titled `Delete "<name>"` with a
 *   bare destructive `Delete` confirm and no body, unless the card passes a
 *   `deleteMessage`. A card with another action
 *   opens the action list instead, whose Delete (only when deletable) hands
 *   off to that same confirm. Only the confirm routes to `onDelete`; Cancel
 *   and a scrim/back dismiss delete nothing. The named title keeps an
 *   accidental hold from deleting an unnamed item.
 * - a hold that MOVES past `HOLD_MAX_DISTANCE` fails the long-press, freeing the
 *   finger for the enclosing sortables drag-to-reorder.
 *
 * The confirm's visibility is component state (`confirmVisible`) because a
 * `BottomSheet` lives in the render tree — unlike the old imperative
 * `ActionSheetIOS`. The `LongPress` runs `.runOnJS(true)`, so its `onStart`
 * callback (the haptic bridge plus the `setState`) runs on the JS thread
 * directly, neither being a worklet.
 *
 * A card with no action at all (a synced (Monobank) entity) renders bare — no
 * gesture and no sheet. This keeps the synced guard AND, deliberately, leaves
 * the touch-and-hold free for the enclosing sortables drag to claim, so a
 * synced card can still be reordered.
 *
 * COEXISTENCE NOTE: both this long-press and the sortables drag begin from a
 * hold. A hold that stays still opens this menu; a hold that moves the finger
 * fails this gesture (`HOLD_MAX_DISTANCE`) and reorders instead; a quick tap
 * opens the card. On-device, `HOLD_DURATION_MS` may need tuning against the
 * grid's drag activation so the two never both fire on a single hold. The grid
 * lifts the card at its own 200 ms activation, before this menu's hold. A still
 * hold released before the menu can still deliver a press after the lift; the
 * grid's `useGridLiftGuard`, not this component, keeps that press from opening
 * the card. A moved drag and an opened menu deliver no press at all.
 */
const CardContextMenu: FC<{
  name: string;
  deletable: boolean;
  onDelete: () => void;
  // An optional "duplicate this entity" action. It joins the action list a
  // hold opens instead of the delete confirm. Only the transaction rows (Home
  // + the holding-detail ledger) pass it, for manual rows only — the
  // account/holding cards and grids never do.
  onDuplicate?: () => void;
  // An optional "edit this entry" action for a row that has no tap target of
  // its own to open an editor (the holding detail's share changes). Joins
  // the same action list as Duplicate.
  onEdit?: () => void;
  // An optional "close this entity, keep its history" action (a manual
  // holding the user sold or gave away). Joins the same action list; the
  // consumer owns its label and its confirm, since what closing means, and
  // what the entity is called, is the entity's own.
  closeAction?: { label: string; onPress: () => void };
  // An optional body message under the delete confirm's title, for a delete
  // whose effect the user would not guess from the title alone. Omitted, the
  // confirm stays title-only. A function reads the text when the delete is
  // requested (the confirm opens once it settles, so the user never sees the
  // sheet change under their finger), for a message that depends on what is
  // stored right now; a rejection or `undefined` opens the title-only confirm.
  deleteMessage?: () => Promise<string | undefined>;
  // An optional title for the delete confirm, for an item whose own name is a whole sentence (a
  // rule's summary) that would read badly inside `Delete "<name>"`. Omitted, the confirm is
  // titled with the name; `name` still heads the action list.
  deleteTitle?: string;
  // Opt-in press feedback for a card that sits in a PLAIN (non-sortable)
  // list, matching the barely-there `activeItemScale={1.03}` lift the
  // account/holding sortable grids already get for free from
  // `react-native-sortables`' own drag-activation animation. Defaults to
  // `false`/omitted, which renders the plain (non-`Animated`) `View` byte-
  // for-byte as before — an account/holding card must NEVER pass this, since
  // its grid already lifts the card itself; a second, competing scale here
  // would double-animate it. Only cards in a plain list pass it (the Home transaction row, the
  // holding detail's rows, the category page's rule cards).
  liftOnHold?: boolean;
  children: ReactNode;
}> = ({
  name,
  deletable,
  onDelete,
  onDuplicate,
  onEdit,
  closeAction,
  deleteMessage,
  deleteTitle,
  liftOnHold = false,
  children,
}) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [confirmVisible, setConfirmVisible] = useState(false);
  // The text a `deleteMessage` function resolved to for the confirm now open.
  const [resolvedMessage, setResolvedMessage] = useState<string | undefined>(undefined);
  // The newest request to open the confirm, so a read that settles after a newer
  // request is dropped.
  const latestRequest = useRef(0);
  // The action list's visibility, separate from the delete confirm's: a hold
  // opens THIS when a duplicate, edit, or close action exists, and choosing
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
  const canClose = closeAction !== undefined;
  const hasActionList = canDuplicate || canEdit || canClose;

  // A card with NO action renders bare — no gesture, no sheet — leaving the
  // touch-and-hold free for an enclosing sortables drag to claim (a synced
  // row keeps its reorder this way).
  if (!deletable && !hasActionList) {
    return <>{children}</>;
  }

  // A message that must be read first holds the sheet back until it settles; no
  // message opens the sheet at once. A read that fails opens the title-only
  // confirm: the delete itself never depends on the text. A request made while an
  // earlier read is pending supersedes it, so the earlier read settling late
  // neither overwrites the newer text nor opens a confirm of its own.
  const openConfirm = async (): Promise<void> => {
    latestRequest.current += 1;
    const request = latestRequest.current;

    if (deleteMessage !== undefined) {
      const message = bifoldr(await either(async () => deleteMessage()));

      if (request !== latestRequest.current) {
        return;
      }

      setResolvedMessage(message);
    }

    setConfirmVisible(true);
  };

  // A hold offers the action-list CHOICE only when a duplicate, edit, or close action exists;
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

      // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
      openConfirm();
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

  const runClose = (): void => {
    setActionsVisible(false);
    closeAction?.onPress();
  };

  // Delete from the action list hands off to the SAME named confirm sheet the
  // delete-only path uses: close the list, open the confirm.
  const chooseDelete = (): void => {
    setActionsVisible(false);
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
    openConfirm();
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

          {canClose && (
            <Button onPress={runClose} testID={CLOSE_ACTION_TEST_ID}>
              {closeAction?.label}
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
        title={deleteTitle ?? t('common.deleteNamed', { name })}
        message={resolvedMessage}
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
