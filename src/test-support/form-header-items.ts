import { act } from '@testing-library/react-native';

type HeaderItem = {
  type: string;
  label: string;
  variant?: string;
  disabled?: boolean;
  onPress: () => void;
};

type HeaderSlotName = 'unstable_headerLeftItems' | 'unstable_headerRightItems';

type HeaderSlot = (props: { canGoBack: boolean }) => HeaderItem[];

/**
 * The items the screen last registered for one nav-bar slot, asked the way native-stack asks:
 * `canGoBack` says whether the stack draws a back button for this screen.
 */
export const headerItems = (
  setOptions: jest.Mock,
  slot: HeaderSlotName,
  canGoBack = false,
): HeaderItem[] => {
  const registrations: Partial<Record<HeaderSlotName, HeaderSlot>>[] = setOptions.mock.calls
    .map(([options]) => options)
    .filter((options) => slot in options);

  return registrations.at(-1)?.[slot]?.({ canGoBack }) ?? [];
};

/**
 * A form's Save lives in the nav bar, so a form test reads and presses the item the screen last
 * registered with `navigation.setOptions`, as the native bar would. The label is a parameter so a
 * Ukrainian test passes its own.
 */
export const saveItem = (setOptions: jest.Mock, label = 'Save'): HeaderItem | undefined =>
  headerItems(setOptions, 'unstable_headerRightItems').find((item) => item.label === label);

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
  // The native bar never delivers a press to a disabled item; a test that wants the raw handler
  // calls `saveItem(...)?.onPress()` itself.
  if (item?.disabled === true) {
    throw new Error(`The ${label} item is disabled, so the native bar would not press it.`);
  }

  await act(async () => {
    item?.onPress();
  });
};
