import type { ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';

import type { CommentRowProps } from './comment-row.props';

// The counterparty->comment column writes a real value no screen ever
// surfaced, shown whenever the loaded row carries a non-blank comment.
// Not gated by `isReadOnly`:
// `mapParsedTransaction`/Monobank sync can write `comment` onto any
// imported row regardless of `source`, and a Monobank-synced row is exactly
// the read-only case this must still cover — so this renders for
// both. A component of its own for the same cognitive-complexity-budget
// reason as `ReadOnlyNotice`.
//
// This does NOT use a `SummaryTable` row, even one with `wraps`: that layout puts the label
// beside the value, so a comment that runs to a full sentence would wrap inside the narrow
// column the label leaves. Stacked, the label above the value, the sentence gets the full width
// and reads as text.
const CommentRow = ({ comment, label }: CommentRowProps): ReactElement | null => {
  const trimmed = comment?.trim();

  if (!trimmed) {
    return null;
  }

  return (
    <Box gap={1} testID="transaction-comment">
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <Text variant="body">{trimmed}</Text>
    </Box>
  );
};

export default CommentRow;
