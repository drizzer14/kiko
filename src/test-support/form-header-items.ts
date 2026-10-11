import { act } from '@testing-library/react-native';

type HeaderItem = {
  type: string;
  label: string;
  variant?: string;
  disabled?: boolean;
  onPress: () => void;
};

type HeaderSlot = (props: { canGoBack: boolean }) => HeaderItem[];

/**
 * A form's Save lives in the nav bar, so a form test reads and presses the item the screen last
 * registered with `navigation.setOptions`, as the native bar would. The label is a parameter so a
 * Ukrainian test passes its own.
 */
export const saveItem = (setOptions: jest.Mock, label = 'Save'): HeaderItem | undefined => {
  const registrations: { unstable_headerRightItems?: HeaderSlot }[] = setOptions.mock.calls
    .map(([options]) => options)
    .filter((options) => 'unstable_headerRightItems' in options);

  return registrations
    .at(-1)
    ?.unstable_headerRightItems?.({ canGoBack: false })
    .find((item) => item.label === label);
};

/**
 * A form offers Save only as the prominent nav-bar item: no Save text and no footer in its body.
 */
export const expectNavBarSaveOnly = (
  setOptions: jest.Mock,
  {
    queryByText,
    queryByTestId,
  }: { queryByText: (text: string) => unknown; queryByTestId: (testId: string) => unknown },
): void => {
  expect(saveItem(setOptions)).toMatchObject({ label: 'Save', variant: 'prominent' });
  expect(queryByText('Save')).toBeNull();
  expect(queryByTestId('screen-footer')).toBeNull();
};

export const pressSave = async (setOptions: jest.Mock, label = 'Save'): Promise<void> => {
  const item = saveItem(setOptions, label);

  expect(item).toBeDefined();
  await act(async () => {
    item?.onPress();
  });
};
