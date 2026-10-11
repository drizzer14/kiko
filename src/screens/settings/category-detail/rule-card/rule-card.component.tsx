import type { FC } from 'react';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';

import type { RuleCardProps } from './rule-card.props';

// One rule as a card. A still hold offers the delete, named by the rule's own line, which also
// covers a rule that can not be read: it has no other action.
const RuleCard: FC<RuleCardProps> = ({ title, onDelete }) => {
  return (
    <CardContextMenu name={title} deletable onDelete={onDelete}>
      <Card testID="rule-card" padding={4}>
        <Text variant="body">{title}</Text>
      </Card>
    </CardContextMenu>
  );
};

export default RuleCard;
