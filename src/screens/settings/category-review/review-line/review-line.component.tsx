import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';

import { styles } from './review-line.styles';
import type { ReviewLineProps } from './review-line.props';

const SEPARATOR = ' · ';

// One group of transactions without a category: its name, or the start of its names, with the
// counts under it, and the button that opens the category options. A one-name group carries no
// name count, which would only say "1 name" under that name.
const ReviewLine: FC<ReviewLineProps> = ({ group, onChoose }) => {
  const { t } = useTranslation();
  const isPrefix = group.rule.kind === 'nameStartsWith';
  const rowCount = t('categoryReview.rowCount', { count: group.rowCount });
  const heading = isPrefix
    ? t('categoryReview.startsWith', { name: group.rule.text })
    : group.rule.text;
  const counts = isPrefix
    ? [t('categoryReview.nameCount', { count: group.names.length }), rowCount].join(SEPARATOR)
    : rowCount;

  return (
    <Card testID="review-line" padding={3}>
      <Box direction="row" style={styles.main}>
        <Box gap={1} style={styles.lines}>
          <Text variant="body">{heading}</Text>

          <Text variant="caption" tone="textSecondary">
            {counts}
          </Text>
        </Box>

        <Box style={styles.action}>
          <Button
            variant="secondary"
            size="small"
            fullWidth={false}
            onPress={() => onChoose(group)}
          >
            {t('categoryReview.choose')}
          </Button>
        </Box>
      </Box>
    </Card>
  );
};

export default ReviewLine;
