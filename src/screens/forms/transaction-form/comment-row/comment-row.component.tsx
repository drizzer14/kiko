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
// This does NOT reuse `SummaryTable`
// (the app's shared "label left, value right" ROW layout) — `SummaryTable`
// was built for short values (money, counts, dates); Comment is free text
// that can run to a full sentence. `SummaryTable` wraps a row's `value` in
// its OWN `Box` (`summary-table.component.tsx`'s `<Box
// testID={row.testID}>{row.value}</Box>`), one level BELOW the row's own
// flex-row layout — a `flexShrink`/`textAlign` set on the VALUE node I pass
// in (a grandchild of the row, not a direct flex child of it) has no effect
// on that row's own layout pass in Yoga; only the WRAPPING `Box` itself
// (which `SummaryTable` owns, not a caller) would need `flexShrink` — and
// `SummaryTable`'s shared row must not change for one
// caller. Stacking the label ABOVE the value instead — a plain `Box`
// column, not a flex row — sidesteps the problem entirely: the value
// `Text` gets the row's FULL width to itself and wraps normally, with no
// label competing for horizontal space on the same line.
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
