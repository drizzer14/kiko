import { ActionSheetIOS } from 'react-native';
import { trigger } from 'react-native-haptic-feedback';

import { i18n } from '../i18n';

import { onGridDragEnd, openDeleteMenu } from './grid-interaction';

jest.mock('react-native-haptic-feedback', () => ({ trigger: jest.fn() }));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('onGridDragEnd', () => {
  it('persists the new order when the item actually moved (fromIndex !== toIndex)', () => {
    const persistOrder = jest.fn();

    onGridDragEnd(
      { key: 'b', fromIndex: 1, toIndex: 0, indexToKey: ['b', 'a', 'c'] },
      persistOrder,
    );

    expect(persistOrder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('does nothing when the drag ended where it started — a hold-still opens the delete menu, it is not a reorder', () => {
    const persistOrder = jest.fn();

    onGridDragEnd(
      { key: 'a', fromIndex: 0, toIndex: 0, indexToKey: ['a', 'b', 'c'] },
      persistOrder,
    );

    expect(persistOrder).not.toHaveBeenCalled();
  });
});

describe('openDeleteMenu', () => {
  it('fires a medium-impact haptic and presents a destructive Delete "<name>" sheet, routing confirm to onDelete', () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1));

    openDeleteMenu('Black card', onDelete);

    expect(trigger).toHaveBeenCalledWith('impactMedium');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['Cancel', 'Delete "Black card"'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 0,
      }),
      expect.any(Function),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('does not delete when the sheet is cancelled', () => {
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(0));

    openDeleteMenu('Cash', onDelete);

    expect(onDelete).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('presents the sheet in Ukrainian once the active language switches', async () => {
    await i18n.changeLanguage('uk');
    const onDelete = jest.fn();
    const spy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => callback(1));

    openDeleteMenu('Чорна картка', onDelete);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        options: ['Скасувати', 'Видалити «Чорна картка»'],
      }),
      expect.any(Function),
    );

    spy.mockRestore();
  });
});
