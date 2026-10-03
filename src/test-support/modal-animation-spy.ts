type ModalProps = { visible: boolean; animationType?: string; testID?: string };

const modalModule = require('react-native/Libraries/Modal/Modal') as {
  default: (props: ModalProps) => unknown;
};

export type ModalAnimationSpy = {
  // The animation the Modal was handed in the render that hid it (the last
  // render with `visible` false), which is what native reads for that dismiss.
  lastHiddenAnimation: () => string | undefined;
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
  const lastAnimation = (visible: boolean): string | undefined =>
    spy.mock.calls
      .map(([props]) => props)
      .filter((props) => props.testID === modalTestID && Boolean(props.visible) === visible)
      .at(-1)?.animationType;

  return {
    lastHiddenAnimation: () => lastAnimation(false),
    lastShownAnimation: () => lastAnimation(true),
    restore: () => spy.mockRestore(),
  };
};
