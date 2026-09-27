import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import AccountsScreen from '@kiko/screens/accounts';
import LotFormScreen from '@kiko/screens/forms/lot-form';
import AccountDetailScreen from '@kiko/screens/account-detail';
import HoldingDetailScreen from '@kiko/screens/holding-detail';
import ColumnMappingScreen from '@kiko/screens/column-mapping';
import AccountFormScreen from '@kiko/screens/forms/account-form';
import HoldingFormScreen from '@kiko/screens/forms/holding-form';
import StatementImportScreen from '@kiko/screens/statement-import';
import PricePointFormScreen from '@kiko/screens/forms/price-point-form';
import TransactionFormScreen from '@kiko/screens/forms/transaction-form';
import ContributionFormScreen from '@kiko/screens/forms/contribution-form';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OwnershipChangeFormScreen from '@kiko/screens/forms/ownership-change-form';

import type { AccountsStackParamList } from '../types';
import { resetTabStackOnBlur } from '../reset-tab-stack-on-blur';

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

      <Stack.Screen
        name="PricePointForm"
        component={PricePointFormScreen}
        options={{ title: t('forms.pricePoint.title') }}
      />

      <Stack.Screen
        name="LotForm"
        component={LotFormScreen}
        options={{ title: t('forms.lot.addTitle') }}
      />

      <Stack.Screen
        name="OwnershipChangeForm"
        component={OwnershipChangeFormScreen}
        options={{ title: t('forms.ownershipChange.title') }}
      />

      <Stack.Screen
        name="StatementImport"
        component={StatementImportScreen}
        options={{ title: t('statementImport.previewHeading') }}
      />

      <Stack.Screen
        name="ColumnMapping"
        component={ColumnMappingScreen}
        options={{ title: t('columnMapping.title') }}
      />
    </Stack.Navigator>
  );
};

export default AccountsStack;
