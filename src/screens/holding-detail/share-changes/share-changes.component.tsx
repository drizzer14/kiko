import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@kiko/dates/format';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import { ownershipShareDetailText } from '@kiko/holdings/ownership';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { propertyShareChanges } from '@kiko/holdings/holding-descriptor/property-item';

import { styles } from './share-changes.styles';
import type { ShareChangesProps } from './share-changes.props';

// Every stored share change of a property, newest first: the day it took
// effect and the share in the form the user typed it. A row has nothing to
// open on a tap, so Edit joins Delete in its long-press menu. Hidden while no
// change is stored, the same as the Linked payments section.
const ShareChanges: FC<ShareChangesProps> = ({ holding, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const { changes, input } = propertyShareChanges(holding);

  if (changes.length === 0) {
    return null;
  }

  return (
    <Box gap={2}>
      <Text variant="heading">{t('holdingDetail.shareChanges')}</Text>

      {changes.map((change) => {
        const date = formatDate(change.day, { timeZone: 'UTC' });
        const shareText = ownershipShareDetailText(change, input, activeLocale());

        return (
          <CardContextMenu
            key={change.day}
            name={`${shareText} ${t('holdingDetail.shareSince', { date })}`}
            deletable
            onDelete={() => onDelete(change.day)}
            onEdit={() => onEdit(change.day)}
            liftOnHold
          >
            <Card padding={3} testID="share-change-row">
              <Box direction="row" gap={3} style={styles.row}>
                <Text variant="body">{date}</Text>

                <Text variant="body">{shareText}</Text>
              </Box>
            </Card>
          </CardContextMenu>
        );
      })}
    </Box>
  );
};

export default ShareChanges;
