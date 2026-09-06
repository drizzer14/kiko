import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import AccountDetailScreen from '../screens/account-detail/account-detail.screen';
import AccountsScreen from '../screens/accounts/accounts.screen';
import AccountFormScreen from '../screens/forms/account-form.screen';
import ContributionFormScreen from '../screens/forms/contribution-form.screen';
import HoldingFormScreen from '../screens/forms/holding-form.screen';
import TransactionFormScreen from '../screens/forms/transaction-form.screen';
import HoldingDetailScreen from '../screens/holding-detail/holding-detail.screen';

import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';
import type { AccountsStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountsStackParamList>();

/**
 * The Accounts tab's native stack. The list and form screens use a large title,
 * the standard iOS pattern. The tab root ("Accounts") and the form screens carry
 * a static title here — the create case is the default, so a constant "Add …"
 * reads correctly and belongs in the navigator config; the account/holding
 * forms override it to "Edit …" via `navigation.setOptions` when opened in edit
 * mode. The two detail screens set a dynamic title (the account/holding name)
 * from their own route params (the entity name, captured at navigation time) via
 * `navigation.setOptions`, so they take no static title here; without one a
 * screen would otherwise show its raw camelCase route name. The title is set
 * from the param name at first render (a fresher live-queried name takes over
 * once loaded), so the native large title — and the back button on any screen
 * pushed from a detail screen — reads the name immediately, with no async
 * large-title toggle. The entity's identity icon sits beside the Balance/Value
 * amount in the body (`EntityHeaderIcon`), not in the nav title.
 */
const AccountsStack: FC = () => {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{ headerLargeTitle: true }}
      screenListeners={resetTabStackOnBlur}
    >
      <Stack.Screen
        name="Accounts"
        component={AccountsScreen}
        options={{ title: t('accounts.title') }}
      />
      <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
      <Stack.Screen name="HoldingDetail" component={HoldingDetailScreen} />
      <Stack.Screen
        name="AccountForm"
        component={AccountFormScreen}
        options={{ title: t('forms.account.addTitle') }}
      />
      <Stack.Screen
        name="HoldingForm"
        component={HoldingFormScreen}
        options={{ title: t('forms.holding.addTitle') }}
      />
      <Stack.Screen
        name="TransactionForm"
        component={TransactionFormScreen}
        options={{ title: t('forms.transaction.addTitle') }}
      />
      <Stack.Screen
        name="ContributionForm"
        component={ContributionFormScreen}
        options={{ title: t('forms.contribution.addTitle') }}
      />
    </Stack.Navigator>
  );
};

export default AccountsStack;
