import { act } from '@testing-library/react-native';

type ModalProps = { testID?: string; onDismiss?: () => void };

const modalModule = require('react-native/Libraries/Modal/Modal') as {
  default: (props: ModalProps) => unknown;
};

const spyOnModalRender = () => jest.spyOn(modalModule, 'default');

type ModalRenderSpy = ReturnType<typeof spyOnModalRender>;

export type ModalDismissSpy = {
  // Calls the `onDismiss` the Modal was handed in its LATEST render, inside `act`, as native
  // does when the close has finished. A latest render with no `onDismiss` calls nothing.
  finishClosing: () => Promise<void>;
};

// The jest Modal renders nothing once hidden, so a test cannot read its `onDismiss` off the tree
// after the press that hid it, and one read before the press is the handler of an older render.
// Native calls the handler of the latest render, which a sheet may drop once it is hidden, so
// this spies on the Modal's render and reads the props of the last render with the given
// `testID`.
//
// Call it at describe or file level, never inside a test or a hook: it registers its own
// `beforeEach` (spy) and `afterEach` (restore), and the restore has to live here because the
// project's `clearMocks` only clears call history. It assumes one mounted Modal per `testID`.
export const spyOnModalDismissPerTest = (modalTestID: string): ModalDismissSpy => {
  let spy: ModalRenderSpy | undefined;

  beforeEach(() => {
    spy = spyOnModalRender();
  });

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  const finishClosing = async (): Promise<void> => {
    if (spy === undefined) {
      throw new Error('The Modal dismiss spy is only readable while a test runs.');
    }

    const latest = spy.mock.calls
      .map(([props]) => props)
      .filter((props) => props.testID === modalTestID)
      .at(-1);

    if (latest === undefined) {
      throw new Error(`The Modal "${modalTestID}" was never rendered.`);
    }

    await act(async () => {
      latest.onDismiss?.();
    });
  };

  return { finishClosing };
};
