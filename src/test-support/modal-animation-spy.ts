type ModalProps = { visible: boolean; animationType?: string; testID?: string };

const modalModule = require('react-native/Libraries/Modal/Modal') as {
  default: (props: ModalProps) => unknown;
};

export type ModalAnimationSpy = {
  // The animation the Modal was handed in the render that last hid it (the
  // first render of the latest run with `visible` false), which is what native
  // reads for that dismiss. A later re-render does not count: native has
  // already started the dismiss.
  lastHiddenAnimation: () => string | undefined;
  // The same for the render that last showed it.
  lastShownAnimation: () => string | undefined;
  restore: () => void;
};

// The jest Modal renders nothing once hidden, so a test cannot read the close
// animation off the tree. This spies on the Modal's render and reads the props
// every render was handed instead, for the one Modal whose `testID` is given
// (a screen renders other sheets too, and they re-render with it). Call
// `restore` in `afterEach`.
export const spyOnModalAnimation = (modalTestID: string): ModalAnimationSpy => {
  const spy = jest.spyOn(modalModule, 'default');
  const transitionAnimation = (toVisible: boolean): string | undefined => {
    const renders = spy.mock.calls
      .map(([props]) => props)
      .filter((props) => props.testID === modalTestID);
    const inState = renders.map((props) => Boolean(props.visible) === toVisible);
    const lastInState = inState.lastIndexOf(true);
    const runStart = inState.slice(0, lastInState + 1).lastIndexOf(false) + 1;

    return lastInState === -1 ? undefined : renders[runStart]?.animationType;
  };

  return {
    lastHiddenAnimation: () => transitionAnimation(false),
    lastShownAnimation: () => transitionAnimation(true),
    restore: () => spy.mockRestore(),
  };
};
