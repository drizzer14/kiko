import type { FC } from 'react';
import { match } from 'ts-pattern';
import { Linking } from 'react-native';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { useTranslation } from 'react-i18next';
import { remindersRepo } from '@kiko/reminders/repo';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import Screen from '@kiko/design-system/components/screen';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import ReminderRow from '@kiko/screens/settings/reminder-row';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { useNotificationPreAlert } from '@kiko/reminders/permission';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import { replanReminders } from '@kiko/reminders/use-reminder-scheduler';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import NotificationPreAlertSheet from '@kiko/design-system/components/notification-pre-alert-sheet';

type AccountRemindersScreenProps = NativeStackScreenProps<
  AccountsStackParamList,
  'AccountReminders'
>;

type Notice = { message: string; actionLabel: string; onAction: () => void };

// One row per reminder the account can have, plus any saved reminder the
// account no longer allows, so the user can still see and remove it. The
// permission notice shows only once there is a reminder that could not be
// delivered.
const AccountRemindersScreen: FC<AccountRemindersScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { t } = useTranslation();
  const { data: accounts, isLoading: accountLoading } = useLiveQuery(
    accountsRepo.byIdQuery(accountId),
    ['accounts'],
    true,
    { cached: true },
  );
  const { data: reminders, isLoading: remindersLoading } = useLiveQuery(
    remindersRepo.listByAccountQuery(accountId),
    ['reminders'],
    true,
    { cached: true },
  );
  const { data: imports, isLoading: importLoading } = useLiveQuery(
    remindersRepo.hasImportQuery(accountId),
    ['transactions', 'holdings'],
    true,
    { cached: true },
  );
  const isReady = useDataReady(accountLoading, remindersLoading, importLoading);
  const preAlert = useNotificationPreAlert();

  if (!isReady) {
    return (
      <Screen scroll>
        <LoadingState testID="account-reminders-loading" />
      </Screen>
    );
  }

  const account = accounts.at(0);
  const eligibleKinds =
    foldMap(maybe(account), (found) => eligibleReminderKinds(found, imports.length > 0)) ?? [];
  const reminderOf = (kind: ReminderKind) => reminders.find((saved) => saved.kind === kind);
  const kinds = reminderKinds.filter(
    (kind) => eligibleKinds.includes(kind) || reminderOf(kind) !== undefined,
  );

  const notice = match(reminders.length > 0 ? preAlert.status : undefined)
    .returnType<Notice | undefined>()
    .with('denied', () => ({
      message: t('reminders.permission.deniedMessage'),
      actionLabel: t('reminders.permission.openSettings'),
      onAction: () => Linking.openSettings(),
    }))
    .with('notDetermined', () => ({
      message: t('reminders.permission.notDeterminedMessage'),
      actionLabel: t('reminders.permission.turnOn'),
      onAction: preAlert.open,
    }))
    .otherwise(() => undefined);

  const writeThenReplan = async (write: () => Promise<void>): Promise<void> => {
    try {
      await write();
    } catch {
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    replanReminders();
  };

  return (
    <>
      <Screen scroll>
        <Box gap={4}>
          {foldMap(maybe(notice), (shown) => (
            <NoticeBanner {...shown} testID="account-reminders-notice" />
          ))}

          {kinds.map((kind) => {
            const saved = reminderOf(kind);

            return (
              <ReminderRow
                key={kind}
                kind={kind}
                reminder={saved}
                available={eligibleKinds.includes(kind)}
                accountArchived={account?.archivedAt != null}
                onOpen={() =>
                  navigation.navigate(
                    'ReminderForm',
                    foldMap(maybe(saved), ({ id }) => ({ reminderId: id })) ?? { accountId, kind },
                  )
                }
                onPausedChange={(paused) =>
                  foldMap(maybe(saved), ({ id }) =>
                    writeThenReplan(() => remindersRepo.setPaused(id, paused)),
                  )
                }
                onDelete={() =>
                  foldMap(maybe(saved), ({ id }) => writeThenReplan(() => remindersRepo.remove(id)))
                }
              />
            );
          })}
        </Box>
      </Screen>

      <NotificationPreAlertSheet {...preAlert.sheet} />
    </>
  );
};

export default AccountRemindersScreen;
