import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import SummaryTable from '@kiko/design-system/components/summary-table';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';

import { styles } from './rule-card.styles';
import type { RuleCardProps } from './rule-card.props';

// One rule as a card: its conditions as a label/value table. A tap opens it in the editor; a still
// hold offers the delete, which also covers a rule that can not be read: it has no other action and
// no tap. The summary is a whole sentence, so the confirm has a title of its own rather than the
// line quoted inside `Delete "<name>"`.
const RuleCard: FC<RuleCardProps> = ({ rows, summary, onPress, onDelete }) => {
  const { t } = useTranslation();
  const content =
    rows === undefined ? (
      <Text variant="body">{summary}</Text>
    ) : (
      <SummaryTable
        rows={rows.map((row) => ({
          key: row.key,
          label: row.label,
          wraps: true,
          value: (
            <Text variant="caption" style={styles.value}>
              {row.value}
            </Text>
          ),
        }))}
      />
    );

  return (
    <CardContextMenu
      name={summary}
      deletable
      deleteTitle={t('categoryPage.deleteRuleTitle')}
      liftOnHold
      onDelete={onDelete}
    >
      <Card testID="rule-card" padding={4}>
        {onPress === undefined ? (
          content
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={summary} onPress={onPress}>
            {content}
          </Pressable>
        )}
      </Card>
    </CardContextMenu>
  );
};

export default RuleCard;
