import type { FC, ReactElement } from 'react';
import Box from '@kiko/design-system/components/box';

import { toGridRows } from './grid-columns';
import { styles } from './statistics-grid.styles';
import type { StatisticsGridProps } from './statistics-grid.props';

type Cell = { key: string; card: ReactElement | null };

// A spacer has no identity of its own, so it is keyed by how many cells come before it.
const keyedCells = (row: (ReactElement | null)[]) =>
  row.reduce<Cell[]>(
    (cells, card) => [...cells, { key: card?.key ?? `spacer-${cells.length}`, card }],
    [],
  );

/**
 * The Statistics cards in a grid of `columns` equal cells: the lead card is the full-width first
 * row, the rest fill rows of `columns`, each row as tall as its tallest card. At one column it is
 * the plain stack the screen always rendered, with no row around any card.
 */
const StatisticsGrid: FC<StatisticsGridProps> = ({ columns, lead, cards }) => {
  if (columns === 1) {
    return (
      <>
        {lead}
        {cards}
      </>
    );
  }

  return (
    <>
      {lead}
      {toGridRows(cards, columns).map((row) => {
        const cells = keyedCells(row);

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
  );
};

export default StatisticsGrid;
