import type { FC } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { useTranslation } from 'react-i18next';
import { remindersRepo } from '@kiko/reminders/repo';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import Text from '@kiko/design-system/components/text';
import Screen from '@kiko/design-system/components/screen';
import { eligibleReminderKinds } from '@kiko/reminders/rules';
import ReminderRow from '@kiko/screens/settings/reminder-row';
import { usePermissionNotice } from '@kiko/reminders/permission';
import { isImplicitAccount } from '@kiko/holdings/implicit-account';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import LoadingState from '@kiko/design-system/components/loading-state';
import NoticeBanner from '@kiko/design-system/components/notice-banner';
import { writeThenReplan } from '@kiko/reminders/use-reminder-scheduler';
import { type ReminderKind, reminderKinds } from '@kiko/reminders/schedule';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import NotificationPreAlertSheet from '@kiko/design-system/components/notification-pre-alert-sheet';

type AccountRemindersScreenProps = NativeStackScreenProps<
  AccountsStackParamList,
  'AccountReminders'
>;

// One row per reminder the account can have (an implicit account: only its
// saved ones), plus any saved reminder the account no longer allows, so the
// user can still see and remove it. The permission notice shows only once
// there is a reminder that could not be delivered.
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
  const isReady = useDataReady(accountLoading, remindersLoading);
  const { notice, sheet } = usePermissionNotice(reminders.length > 0);

  if (!isReady) {
    return (
      <Screen scroll>
        <LoadingState testID="account-reminders-loading" />
      </Screen>
    );
  }

  const account = accounts.at(0);
  const eligibleKinds = foldMap(maybe(account), eligibleReminderKinds) ?? [];
  const reminderOf = (kind: ReminderKind) => reminders.find((saved) => saved.kind === kind);
  // A live implicit account takes no NEW reminder, so it lists only its saved
  // ones: deleting the last leaves no row that opens the create form. They
  // still count as eligible (`available`), so one a merge left stays active.
  const offeredKinds = foldMap(maybe(account), isImplicitAccount) ? [] : eligibleKinds;
  const kinds = reminderKinds.filter(
    (kind) => offeredKinds.includes(kind) || reminderOf(kind) !== undefined,
  );

  return (
    <>
      <Screen scroll>
        <Box gap={4}>
          {foldMap(maybe(notice), (shown) => (
            <NoticeBanner {...shown} testID="account-reminders-notice" />
          ))}

          {kinds.length === 0 && (
            <Text variant="caption" tone="textSecondary">
              {t('reminders.emptyNoKinds')}
            </Text>
          )}

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
                    writeThenReplan(() => remindersRepo.setPaused(id, paused), t),
                  )
                }
                onDelete={() =>
                  foldMap(maybe(saved), ({ id }) =>
                    writeThenReplan(() => remindersRepo.remove(id), t),
                  )
                }
              />
            );
          })}
        </Box>
      </Screen>

      <NotificationPreAlertSheet {...sheet} />
    </>
  );
};

export default AccountRemindersScreen;
