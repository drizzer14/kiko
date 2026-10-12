import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';

import type { RuleCardProps } from './rule-card.props';

// One rule as a card. A tap opens it in the editor; a still hold offers the delete, which also
// covers a rule that can not be read: it has no other action and no tap. The rule's line is a whole
// sentence, so the confirm has a title of its own rather than the line quoted inside
// `Delete "<name>"`.
const RuleCard: FC<RuleCardProps> = ({ title, onPress, onDelete }) => {
  const { t } = useTranslation();
  const line = <Text variant="body">{title}</Text>;

  return (
    <CardContextMenu
      name={title}
      deletable
      deleteTitle={t('categoryPage.deleteRuleTitle')}
      liftOnHold
      onDelete={onDelete}
    >
      <Card testID="rule-card" padding={4}>
        {onPress === undefined ? (
          line
        ) : (
          <Pressable accessibilityRole="button" onPress={onPress}>
            {line}
          </Pressable>
        )}
      </Card>
    </CardContextMenu>
  );
};

export default RuleCard;
