import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import { remindersRepo } from '@kiko/reminders/repo';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import Text from '@kiko/design-system/components/text';
import Screen from '@kiko/design-system/components/screen';
import Divider from '@kiko/design-system/components/divider';
import type { ReminderRow as SavedReminder } from '@kiko/db';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import ReminderRow from '@kiko/screens/settings/reminder-row';
import { usePermissionNotice } from '@kiko/reminders/permission';
import type { SettingsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import { writeThenReplan } from '@kiko/reminders/use-reminder-scheduler';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import NotificationPreAlertSheet from '@kiko/design-system/components/notification-pre-alert-sheet';

import { styles } from './reminders.styles';

type RemindersScreenProps = NativeStackScreenProps<SettingsStackParamList, 'Reminders'>;

type ListedReminder = Awaited<ReturnType<typeof remindersRepo.listWithAccountQuery>>[number];

type AccountGroup = {
  accountId: string;
  name: string;
  archived: boolean;
  eligibleKinds: ReminderKind[];
  reminders: SavedReminder[];
};

// Groups keep the accounts list order the rows arrive in; within a group,
// import comes first, as on the account's own page.
const groupByAccount = (rows: readonly ListedReminder[]): AccountGroup[] =>
  [
    ...rows
      .reduce((groups, { reminder, account, hasImport }) => {
        const group = groups.get(reminder.accountId) ?? {
          accountId: reminder.accountId,
          name: account.name,
          archived: account.archivedAt !== null,
          eligibleKinds: eligibleReminderKinds(account, hasImport),
          reminders: [],
        };

        return groups.set(reminder.accountId, {
          ...group,
          reminders: [...group.reminders, reminder],
        });
      }, new Map<string, AccountGroup>())
      .values(),
  ].map((group) => ({
    ...group,
    reminders: reminderKinds.flatMap((kind) =>
      group.reminders.filter((reminder) => reminder.kind === kind),
    ),
  }));

// Every saved reminder, under its account's name. Reminders are created from
// an account's page, so this list has no Add.
const RemindersScreen: FC<RemindersScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();
  const { data: rows, isLoading } = useLiveQuery(
    remindersRepo.listWithAccountQuery(),
    ['reminders', 'accounts', 'transactions', 'holdings'],
    true,
    { cached: true },
  );
  const isReady = useDataReady(isLoading);
  const { notice, sheet } = usePermissionNotice(rows.length > 0);

  if (!isReady) {
    return (
      <Screen scroll>
        <LoadingState testID="reminders-loading" />
      </Screen>
    );
  }

  const groups = groupByAccount(rows);

  return (
    <>
      <Screen scroll>
        <Box gap={4}>
          {foldMap(maybe(notice), (shown) => (
            <NoticeBanner {...shown} testID="reminders-notice" />
          ))}

          {groups.length === 0 && (
            <Box gap={1} style={styles.empty}>
              <Text tone="textSecondary" style={styles.emptyText}>
                {t('reminders.emptyList')}
              </Text>

              <Text variant="caption" tone="textSecondary" style={styles.emptyText}>
                {t('reminders.emptyHint')}
              </Text>
            </Box>
          )}

          {groups.map((group, index) => (
            <Box key={group.accountId} gap={4}>
              {index > 0 && <Divider testID="reminders-account-divider" spacing={2} />}

              <Box testID={`reminders-account-${group.accountId}`} gap={3}>
                <Text variant="heading">{group.name}</Text>

                <Box gap={4}>
                  {group.reminders.map((reminder) => (
                    <ReminderRow
                      key={reminder.id}
                      kind={reminder.kind}
                      reminder={reminder}
                      available={group.eligibleKinds.includes(reminder.kind)}
                      accountArchived={group.archived}
                      onOpen={() =>
                        navigation.navigate('ReminderForm', { reminderId: reminder.id })
                      }
                      onPausedChange={(paused) =>
                        writeThenReplan(() => remindersRepo.setPaused(reminder.id, paused), t)
                      }
                      onDelete={() => writeThenReplan(() => remindersRepo.remove(reminder.id), t)}
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Screen>

      <NotificationPreAlertSheet {...sheet} />
    </>
  );
};

export default RemindersScreen;
