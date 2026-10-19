import { expectNavBarSaveOnly, headerItems, pressSave, saveItem } from './form-header-items';

describe('form header items test helper', () => {
  it('reads the Save item of the last registration that has the trailing slot', () => {
    const first = jest.fn();
    const last = jest.fn();
    const setOptions = jest.fn();

    setOptions({ unstable_headerRightItems: () => [{ label: 'Save', onPress: first }] });
    setOptions({ unstable_headerRightItems: () => [{ label: 'Save', onPress: last }] });
    setOptions({ title: 'Other' });

    saveItem(setOptions)?.onPress();

    expect(last).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('asks the slot with canGoBack false, like a screen without a back button', () => {
    const slot = jest.fn((_props: { canGoBack: boolean }) => []);
    const setOptions = jest.fn();

    setOptions({ unstable_headerRightItems: slot });
    saveItem(setOptions);

    expect(slot).toHaveBeenCalledWith({ canGoBack: false });
  });

  it('finds the Save item by the label it is given', () => {
    const setOptions = jest.fn();

    setOptions({
      unstable_headerRightItems: () => [
        { label: 'Other', onPress: jest.fn() },
        { label: 'Зберегти', onPress: jest.fn(), disabled: true },
      ],
    });

    expect(saveItem(setOptions, 'Зберегти')).toMatchObject({ label: 'Зберегти', disabled: true });
    expect(saveItem(setOptions)).toBeUndefined();
  });

  it('reads the items of the last registration of either slot, asked with the given canGoBack', () => {
    const slot = jest.fn((props: { canGoBack: boolean }) =>
      props.canGoBack ? [] : [{ label: 'Cancel', onPress: jest.fn() }],
    );
    const setOptions = jest.fn();

    setOptions({ unstable_headerLeftItems: () => [{ label: 'Old', onPress: jest.fn() }] });
    setOptions({ unstable_headerLeftItems: slot });
    setOptions({ title: 'Other' });

    expect(headerItems(setOptions, 'unstable_headerLeftItems').map((item) => item.label)).toEqual([
      'Cancel',
    ]);
    expect(headerItems(setOptions, 'unstable_headerLeftItems', true)).toEqual([]);
    expect(headerItems(setOptions, 'unstable_headerRightItems')).toEqual([]);
  });

  it('has no Save item when nothing registered the trailing slot', () => {
    const setOptions = jest.fn();

    setOptions({ title: 'Only a title' });

    expect(saveItem(setOptions)).toBeUndefined();
    expect(saveItem(jest.fn())).toBeUndefined();
  });

  it('passes a body with no Save text and no footer, and fails one that has either', () => {
    const setOptions = jest.fn();
    const body = (saveText: unknown, footer: unknown) => ({
      queryByText: () => saveText,
      queryByTestId: () => footer,
    });

    setOptions({ unstable_headerRightItems: () => [{ label: 'Save', variant: 'prominent' }] });

    expectNavBarSaveOnly(setOptions, body(null, null));
    expect(() => expectNavBarSaveOnly(setOptions, body({}, null))).toThrow();
    expect(() => expectNavBarSaveOnly(setOptions, body(null, {}))).toThrow();
    expect(() => expectNavBarSaveOnly(jest.fn(), body(null, null))).toThrow();
  });

  it('presses the Save item', async () => {
    const onPress = jest.fn();
    const setOptions = jest.fn();

    setOptions({ unstable_headerRightItems: () => [{ label: 'Save', onPress }] });

    await pressSave(setOptions);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('refuses to press a disabled Save item, as the native bar would', async () => {
    const onPress = jest.fn();
    const setOptions = jest.fn();

    setOptions({ unstable_headerRightItems: () => [{ label: 'Save', onPress, disabled: true }] });

    await expect(pressSave(setOptions)).rejects.toThrow('Save item is disabled');
    expect(onPress).not.toHaveBeenCalled();
  });

  it('fails the test when there is no Save item to press', async () => {
    await expect(pressSave(jest.fn())).rejects.toThrow('expect(received).toBeDefined()');
  });
});
