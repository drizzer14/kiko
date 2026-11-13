import type { FC } from 'react';
import { match, P } from 'ts-pattern';
import { useTranslation } from 'react-i18next';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './sync-status-line.styles';
import type { SyncStatusLineProps } from './sync-status-line.props';

// A failure is not drawn here: a long message squeezed beside the Connect button read as nothing,
// so the owning field shows `syncErrorMessage(status)` as a full-width `ErrorNotice` below the row.
const SyncStatusLine: FC<SyncStatusLineProps> = ({ status }) => {
  const { t } = useTranslation();

  return match(status)
    .with({ kind: P.union('idle', 'invalid', 'saveError') }, () => null)
    .with({ kind: 'checking' }, () => {
      return (
        <Text variant="body" tone="textSecondary">
          {t('accountDetail.checking')}
        </Text>
      );
    })
    .with({ kind: 'success' }, ({ message }) => {
      return (
        <Box direction="row" gap={2} style={styles.statusLine}>
          <SymbolIcon
            name="checkmark.circle"
            tone="positive"
            accessibilityLabel={t('common.iconLabel', { name: 'checkmark.circle' })}
          />

          <Text variant="body" tone="positive">
            {message}
          </Text>
        </Box>
      );
    })
    .exhaustive();
};

export default SyncStatusLine;
