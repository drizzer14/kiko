import type { FC } from 'react';
import Box from '../design-system/components/box';
import SymbolIcon from '../design-system/components/symbol';
import Text from '../design-system/components/text';
import { styles } from './entity-identity-header.styles';

// The view-only identity block at the top of the account- and holding-detail
// screens: the entity's icon, tinted by its effective color, beside its name as
// text. Identity EDITING (rename / re-icon / recolor) now lives in the
// dedicated edit form reached via the header Edit button — this block only
// DISPLAYS the identity, so both detail screens present one identical control
// rather than each hand-wrapping an icon + label. The caller resolves the
// effective icon (stored icon or kind/type fallback) and color before passing
// them in.
const EntityIdentityHeader: FC<{ icon: string; name: string; color: string }> = ({
  icon,
  name,
  color,
}) => (
  <Box direction="row" gap={3} style={styles.container}>
    <SymbolIcon name={icon} size={28} color={color} accessibilityLabel={`Icon ${icon}`} />
    <Text variant="heading">{name}</Text>
  </Box>
);

export default EntityIdentityHeader;
