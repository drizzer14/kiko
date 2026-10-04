import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { accountIdentity } from '@kiko/holdings/account-identity';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import EntityIconTile from '@kiko/design-system/components/entity-icon-tile';

import { styles } from './implicit-account-heading.styles';
import type { ImplicitAccountHeadingProps } from './implicit-account-heading.props';

// The Accounts screen's Property / Debts section heading: the implicit
// account's squircle icon tile (the compact one the Settings > Reminders
// account heading uses, since the tile sits beside a heading over cards of its
// own) and its display name. It carries no accessibility label of its own: the
// name beside the tile already reads out. To drop the tile, delete the
// `EntityIconTile` element and the `accountIdentity` line.
const ImplicitAccountHeading: FC<ImplicitAccountHeadingProps> = ({ account, testID }) => {
  const { t } = useTranslation();
  const { icon, color } = accountIdentity(account);

  return (
    <Box testID={testID} direction="row" gap={3} style={styles.heading}>
      <EntityIconTile name={icon} color={color} compact />

      <Box style={styles.name}>
        <Text variant="heading">{accountDisplayName(account, t)}</Text>
      </Box>
    </Box>
  );
};

export default ImplicitAccountHeading;
