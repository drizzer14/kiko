type ModalRenderProps = {
  visible?: boolean;
  animationType?: string;
  testID?: string;
  onDismiss?: () => void;
};

const modalModule = require('react-native/Libraries/Modal/Modal') as {
  default: (props: ModalRenderProps) => unknown;
};

// The jest Modal renders nothing once hidden, so a test cannot read what it was handed off the
// tree. This spies on the Modal's render and returns the props every render was handed, for the
// one Modal whose `testID` is given (a screen renders other sheets too, and they re-render with
// it). It filters by `testID` only, so it assumes one mounted Modal instance per `testID` for the
// test's lifetime (a remount, or two live Modals with the same `testID`, would mix their runs).
//
// Call it at describe or file level, never inside a test or a hook: it registers its own
// `beforeEach` (spy) and `afterEach` (restore), and Jest rejects a hook defined inside a test.
// The restore has to live here and not with the caller: the project's `clearMocks` only clears
// call history, so a spy a test forgot to restore would hand every later test in the file a Modal
// that is still a mock. No other export creates the spy, so a caller cannot skip the restore.
export const spyOnModalRendersPerTest = (modalTestID: string): (() => ModalRenderProps[]) => {
  let spy: jest.SpyInstance<unknown, [ModalRenderProps]> | undefined;

  beforeEach(() => {
    spy = jest.spyOn(modalModule, 'default');
  });

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  return () => {
    if (spy === undefined) {
      throw new Error('The Modal render spy is only readable while a test runs.');
    }

    return spy.mock.calls.map(([props]) => props).filter((props) => props.testID === modalTestID);
  };
};
