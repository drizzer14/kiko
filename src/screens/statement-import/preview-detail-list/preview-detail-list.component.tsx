import type { FC } from 'react';

import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';

import type { PreviewDetailListProps } from './preview-detail-list.props';

/**
 * A small "one line per string" preview block — the statement-import
 * screen's masked-card-hint list and detected-currencies list both reduce to
 * this same shape (an optional label, then one `Text` per item), so both
 * reuse this ONE component instead of two near-identical inline `.map()`
 * blocks (extracted out of `statement-import.screen.tsx` to keep that
 * screen's own cognitive complexity under the project's Biome cap).
 */
const PreviewDetailList: FC<PreviewDetailListProps> = ({ items, label, testID }) => {
  return (
    <Box gap={1} testID={testID}>
      {label !== undefined && (
        <Text variant="body" tone="textSecondary">
          {label}
        </Text>
      )}

      {items.map((item) => (
        <Text key={item} variant="body" tone="textSecondary">
          {item}
        </Text>
      ))}
    </Box>
  );
};

export default PreviewDetailList;
