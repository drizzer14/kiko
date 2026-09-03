import {
  DELETE_ACTION_ID,
  deleteMenuActions,
  onGridDragEnd,
  onMenuAction,
} from './grid-interaction';

describe('onGridDragEnd', () => {
  it('persists the new order when the item actually moved (fromIndex !== toIndex)', () => {
    const persistOrder = jest.fn();

    onGridDragEnd(
      { key: 'b', fromIndex: 1, toIndex: 0, indexToKey: ['b', 'a', 'c'] },
      persistOrder,
    );

    expect(persistOrder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('does nothing when the drag ended where it started — a hold-still opens the native menu, it is not a reorder', () => {
    const persistOrder = jest.fn();

    onGridDragEnd(
      { key: 'a', fromIndex: 0, toIndex: 0, indexToKey: ['a', 'b', 'c'] },
      persistOrder,
    );

    expect(persistOrder).not.toHaveBeenCalled();
  });
});

describe('deleteMenuActions', () => {
  it('offers a single destructive Delete "<name>" carrying the trash SF Symbol', () => {
    expect(deleteMenuActions('Black card')).toEqual([
      {
        id: DELETE_ACTION_ID,
        title: 'Delete "Black card"',
        attributes: { destructive: true },
        image: 'trash',
      },
    ]);
  });
});

describe('onMenuAction', () => {
  it('runs onDelete when the pressed action is the delete action', () => {
    const onDelete = jest.fn();

    onMenuAction(DELETE_ACTION_ID, onDelete);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('ignores an unrelated action id', () => {
    const onDelete = jest.fn();

    onMenuAction('something-else', onDelete);

    expect(onDelete).not.toHaveBeenCalled();
  });
});
