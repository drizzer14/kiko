import type { FC } from 'react';
import { match } from 'ts-pattern';
import Box from '@kiko/design-system/components/box';

import { toGridRows } from './grid-columns';
import { styles } from './statistics-grid.styles';
import type { StatisticsGridProps } from './statistics-grid.props';

/**
 * The Statistics cards in a grid of `columns` equal cells: the lead card is the full-width first
 * row, the rest fill rows of `columns`, each row as tall as its tallest card. At one column it is
 * the plain stack the screen always rendered, with no row around any card.
 */
const StatisticsGrid: FC<StatisticsGridProps> = ({ columns, lead, cards }) =>
  match(columns)
    .with(1, () => (
      <>
        {lead}
        {cards}
      </>
    ))
    .with(2, 3, (rowColumns) => (
      <>
        {lead}
        {toGridRows(cards, rowColumns).map((row) => {
          // A spacer has no identity of its own, so it is keyed by its place in the row.
          const cells = row.map((card, index) => ({
            key: card?.key ?? `spacer-${index}`,
            card,
          }));

          return (
            <Box
              key={cells.map(({ key }) => key).join()}
              direction="row"
              gap={4}
              testID="statistics-grid-row"
            >
              {cells.map(({ key, card }) =>
                card === null ? (
                  <Box key={key} style={styles.cell} testID="statistics-grid-spacer" />
                ) : (
                  <Box key={key} style={styles.cell}>
                    {card}
                  </Box>
                ),
              )}
            </Box>
          );
        })}
      </>
    ))
    .exhaustive();

export default StatisticsGrid;
