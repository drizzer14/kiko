import { act } from '@testing-library/react-native';

// The grid's drag lifecycle, driven straight through the mocked `Sortable.Grid`
// host's props: Jest cannot hit-test a hold, so a lift is `onDragStart`, and the
// drop after the finger leaves is `onActiveItemDropped`.
export type LiftableGrid = { props: Record<string, unknown> };

type GridLifecycle = {
  onDragStart: (event: { key: string }) => void;
  onActiveItemDropped: (event: { key: string }) => void;
};

export const liftCard = async (grid: LiftableGrid, key: string): Promise<void> => {
  const { onDragStart } = grid.props as GridLifecycle;

  await act(async () => {
    onDragStart({ key });
  });
};

export const dropCard = async (grid: LiftableGrid, key: string): Promise<void> => {
  const { onActiveItemDropped } = grid.props as GridLifecycle;

  await act(async () => {
    onActiveItemDropped({ key });
  });
};
