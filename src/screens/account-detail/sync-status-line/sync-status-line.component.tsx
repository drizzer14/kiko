import type { FC } from 'react';
import { match, P } from 'ts-pattern';
import { useTranslation } from 'react-i18next';

import { styles } from '../account-detail.styles';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import SymbolIcon from '../../../design-system/components/symbol';

import type { SyncStatusLineProps } from './sync-status-line.props';

// One glyph + tone per outcome; `invalid` and `saveError` share the negative
// treatment and differ only in the message the owning field supplies.
const SyncStatusLine: FC<SyncStatusLineProps> = ({ status }) => {
  const { t } = useTranslation();

  return match(status)
    .with({ kind: 'idle' }, () => null)
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
    .with({ kind: P.union('invalid', 'saveError') }, ({ message }) => {
      return (
        <Box direction="row" gap={2} style={styles.statusLine}>
          <SymbolIcon
            name="xmark.circle"
            tone="negative"
            accessibilityLabel={t('common.iconLabel', { name: 'xmark.circle' })}
          />

          <Text variant="body" tone="negative">
            {message}
          </Text>
        </Box>
      );
    })
    .exhaustive();
};

export default SyncStatusLine;
