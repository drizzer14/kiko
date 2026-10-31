import type { FC } from 'react';
import Box from '@kiko/design-system/components/box';

import { styles } from './statistics-grid.styles';
import type { StatisticsGridProps } from './statistics-grid.props';

/**
 * The Statistics cards: the full-width ones, one per row at their own height, then the shared
 * cards, side by side in one row of equal cells when `isRowShared`, else more full-width rows.
 * Without the row there is no wrapper around any card.
 */
const StatisticsGrid: FC<StatisticsGridProps> = ({ isRowShared, fullWidth, shared }) => {
  return (
    <>
      {fullWidth}
      {isRowShared ? (
        <Box direction="row" gap={4} testID="statistics-grid-row">
          {shared.map((card) => (
            <Box key={card.key} style={styles.cell}>
              {card}
            </Box>
          ))}
        </Box>
      ) : (
        shared
      )}
    </>
  );
};

export default StatisticsGrid;
