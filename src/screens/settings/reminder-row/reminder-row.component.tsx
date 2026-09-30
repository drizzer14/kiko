import type { FC } from 'react';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import type { ViewProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { deviceRegion } from '@kiko/i18n/device-region';
import { weekStartFor } from '@kiko/calendar/week-start';
import Switch from '@kiko/design-system/components/switch';
import type { ReminderRow as SavedReminder } from '@kiko/db';
import SettingsRow from '@kiko/screens/settings/settings-row';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { describeSchedule, isReminderSchedule, type ReminderKind } from '@kiko/reminders/schedule';

import type { ReminderRowProps } from './reminder-row.props';

// The import glyph is account detail's own "Import statement" button glyph.
const KIND_ICON: Record<ReminderKind, string> = {
  statement_import: 'doc.badge.plus',
  add_transactions: genericEntitySymbol.transaction,
};

const kindLabel = (kind: ReminderKind, t: TFunction): string =>
  match(kind)
    .with('statement_import', () => t('reminders.kind.statementImport'))
    .with('add_transactions', () => t('reminders.kind.addTransactions'))
    .exhaustive();

// A restored row may carry another build's schedule shape; it reads as Off
// rather than breaking the page.
const summaryOf = (reminder: SavedReminder | undefined, t: TFunction): string => {
  const schedule: unknown = reminder?.schedule;

  return isReminderSchedule(schedule)
    ? describeSchedule(schedule, t, weekStartFor(deviceRegion()))
    : t('reminders.off');
};

// Why a saved reminder is not sent right now; every reason that holds shows.
// Only an add-transactions reminder can be unavailable: an import reminder is
// only offered on a bank account, and an account's kind never changes.
const statusCaptions = (
  reminder: SavedReminder,
  available: boolean,
  accountArchived: boolean,
  t: TFunction,
): string[] => [
  ...(available ? [] : [t('reminders.unavailable.addTransactions')]),
  ...(accountArchived ? [t('reminders.accountArchived')] : []),
  ...(reminder.pauseReason === 'backoff' ? [t('reminders.pausedAfterNoResponse')] : []),
];

const PAUSE_ACTION = 'togglePaused';

// VoiceOver reads the row as one element, so the switch inside it is out of
// reach; the row itself carries the switch's state and action.
const pauseAccessibility = (
  reminder: SavedReminder,
  onPausedChange: (paused: boolean) => void,
  t: TFunction,
): Required<
  Pick<ViewProps, 'accessibilityValue' | 'accessibilityActions' | 'onAccessibilityAction'>
> => {
  const on = reminder.pausedAt === null;

  return {
    accessibilityValue: { text: on ? t('reminders.on') : t('reminders.off') },
    accessibilityActions: [
      { name: PAUSE_ACTION, label: on ? t('reminders.turnOff') : t('reminders.turnOn') },
    ],
    onAccessibilityAction: ({ nativeEvent }) => {
      if (nativeEvent.actionName === PAUSE_ACTION) {
        onPausedChange(on);
      }
    },
  };
};

// Not `{}`: TypeScript merges `X | {}` into one shape with every prop of X
// optional, which loses the tie between the switch and its action that
// SettingsRowProps requires on a pressable row.
const NO_SWITCH = { trailing: undefined };

const ReminderRow: FC<ReminderRowProps> = ({
  kind,
  reminder,
  available,
  accountArchived,
  onOpen,
  onPausedChange,
  onDelete,
}) => {
  const { t } = useTranslation();
  const label = kindLabel(kind, t);
  const saved = maybe(reminder);
  const captions =
    foldMap(saved, (found) => statusCaptions(found, available, accountArchived, t)) ?? [];

  return (
    <CardContextMenu name={label} deletable={reminder !== undefined} onDelete={onDelete}>
      <Card padding={3}>
        <SettingsRow
          {...(foldMap(saved, (found) => ({
            ...pauseAccessibility(found, onPausedChange, t),
            trailing: (
              <Switch
                value={found.pausedAt === null}
                onValueChange={(on) => onPausedChange(!on)}
                accessibilityLabel={t('reminders.enabledLabel')}
              />
            ),
          })) ?? NO_SWITCH)}
          icon={KIND_ICON[kind]}
          label={label}
          onPress={onOpen}
        >
          <Box gap={1}>
            <Text variant="caption" tone="textSecondary">
              {summaryOf(reminder, t)}
            </Text>

            {captions.map((caption) => (
              <Text key={caption} variant="caption" tone="textSecondary">
                {caption}
              </Text>
            ))}
          </Box>
        </SettingsRow>
      </Card>
    </CardContextMenu>
  );
};

export default ReminderRow;
