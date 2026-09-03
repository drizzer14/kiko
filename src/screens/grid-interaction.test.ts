import { ActionSheetIOS } from 'react-native';
import { onGridDragEnd, showDeleteActionSheet } from './grid-interaction';

describe('onGridDragEnd', () => {
  it('persists the new order when the item actually moved (fromIndex !== toIndex)', () => {
    const persistOrder = jest.fn();
    const openContextMenu = jest.fn();

    onGridDragEnd(
      { key: 'b', fromIndex: 1, toIndex: 0, indexToKey: ['b', 'a', 'c'] },
      persistOrder,
      openContextMenu,
    );

    expect(persistOrder).toHaveBeenCalledWith(['b', 'a', 'c']);
    expect(openContextMenu).not.toHaveBeenCalled();
  });

  it('opens the item context menu when the drag ended where it started (long-press in place)', () => {
    const persistOrder = jest.fn();
    const openContextMenu = jest.fn();

    onGridDragEnd(
      { key: 'a', fromIndex: 0, toIndex: 0, indexToKey: ['a', 'b', 'c'] },
      persistOrder,
      openContextMenu,
    );

    expect(openContextMenu).toHaveBeenCalledWith('a');
    expect(persistOrder).not.toHaveBeenCalled();
  });
});

describe('showDeleteActionSheet', () => {
  it('offers a destructive Delete plus Cancel', () => {
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => undefined);

    showDeleteActionSheet(jest.fn());

    expect(spy).toHaveBeenCalledWith(
      { options: ['Delete', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      expect.any(Function),
    );
    spy.mockRestore();
  });

  it('runs onDelete when Delete (index 0) is chosen', () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(0));

    showDeleteActionSheet(onDelete);

    expect(onDelete).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does nothing when Cancel (index 1) is chosen', () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1));

    showDeleteActionSheet(onDelete);

    expect(onDelete).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
