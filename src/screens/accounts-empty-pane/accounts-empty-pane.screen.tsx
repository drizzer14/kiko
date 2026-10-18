import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Screen from '@kiko/design-system/components/screen';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { styles } from './accounts-empty-pane.styles';

type AccountsEmptyPaneScreenProps = NativeStackScreenProps<
  AccountsStackParamList,
  'AccountsEmptyPane'
>;

/**
 * What the primary pane of the Accounts tab shows while there is no account to open there: the
 * same empty state the list shows, with the same way out.
 */
const AccountsEmptyPaneScreen: FC<AccountsEmptyPaneScreenProps> = ({ navigation }) => {
  const { t } = useTranslation();

  return (
    <Screen>
      <Box style={styles.empty}>
        <EmptyState
          icon={genericEntitySymbol.account}
          title={t('accounts.empty.title')}
          message={t('accounts.empty.message')}
          action={{
            label: t('accounts.addAccount'),
            icon: genericEntitySymbol.account,
            onPress: () => navigation.navigate('AccountForm', {}),
          }}
          testID="accounts-empty-pane"
        />
      </Box>
    </Screen>
  );
};

export default AccountsEmptyPaneScreen;
