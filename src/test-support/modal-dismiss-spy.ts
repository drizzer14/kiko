import { act } from '@testing-library/react-native';

import { spyOnModalRendersPerTest } from './modal-render-spy';

// The jest Modal renders nothing once hidden, so a test cannot read its `onDismiss` off the tree
// after the press that hid it, and one read before the press is the handler of an older render.
// Native calls the handler of the latest render, which a sheet may drop once it is hidden, so
// this reads the props of the last render with the given `testID` (see `spyOnModalRendersPerTest`,
// whose call rules and one-Modal-per-`testID` assumption it shares).
//
// `finishClosing` calls the `onDismiss` the Modal was handed in its LATEST render, inside `act`,
// as native does when the close has finished. A latest render with no `onDismiss` calls nothing,
// and one that is still visible throws: native fires the handler only after a hide.
export const spyOnModalDismissPerTest = (modalTestID: string) => {
  const rendersOfModal = spyOnModalRendersPerTest(modalTestID);

  const finishClosing = async (): Promise<void> => {
    const latest = rendersOfModal().at(-1);

    if (latest === undefined) {
      throw new Error(`The Modal "${modalTestID}" was never rendered.`);
    }

    if (latest.visible !== false) {
      throw new Error(`The Modal "${modalTestID}" is still visible, so it has nothing to finish.`);
    }

    await act(async () => {
      latest.onDismiss?.();
    });
  };

  return { finishClosing };
};
