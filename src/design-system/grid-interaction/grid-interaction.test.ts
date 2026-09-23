import { onGridDragEnd } from './grid-interaction';

describe('onGridDragEnd', () => {
  it('persists the new order when the item actually moved (fromIndex !== toIndex)', () => {
    const persistOrder = jest.fn();

    onGridDragEnd({ fromIndex: 1, toIndex: 0, indexToKey: ['b', 'a', 'c'] }, persistOrder);

    expect(persistOrder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('does nothing when the drag ended where it started — a hold-still opens the delete confirm, it is not a reorder', () => {
    const persistOrder = jest.fn();

    onGridDragEnd({ fromIndex: 0, toIndex: 0, indexToKey: ['a', 'b', 'c'] }, persistOrder);

    expect(persistOrder).not.toHaveBeenCalled();
  });
});
