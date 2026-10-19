import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';
import MoneyText from '@kiko/design-system/components/money-text';
import ConvertedCaption from '@kiko/design-system/components/converted-caption';

import { styles } from './account-total.styles';
import type { AccountTotalProps } from './account-total.props';

// The account card's trailing figure: the total in the account's own currency, with the
// base-currency caption under it when there is one.
const AccountTotal: FC<AccountTotalProps> = ({ total, inBase, convertedTestID }) => (
  <Box style={styles.column}>
    <MoneyText money={total} context="balance" />

    <ConvertedCaption money={inBase} testID={convertedTestID} />
  </Box>
);

export default AccountTotal;
