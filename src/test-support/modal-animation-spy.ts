import { spyOnModalRendersPerTest } from './modal-render-spy';

export type ModalAnimationSpy = {
  // The animation the Modal was handed in the render that last hid it (the
  // first render of the latest run with `visible` false), which is what native
  // reads for that dismiss. A later re-render does not count: native has
  // already started the dismiss. The mount render is not a hide, so a Modal
  // that mounted hidden and was never shown then hidden reports undefined.
  lastHiddenAnimation: () => string | undefined;
  // The same for the render that last showed it (undefined when it mounted
  // visible and was never hidden then shown).
  lastShownAnimation: () => string | undefined;
};

// The jest Modal renders nothing once hidden, so a test cannot read the close
// animation off the tree. This reads the props every render of the one Modal
// whose `testID` is given was handed (see `spyOnModalRendersPerTest`, whose
// call rules and one-Modal-per-`testID` assumption it shares).
export const spyOnModalAnimationPerTest = (modalTestID: string): ModalAnimationSpy => {
  const rendersOfModal = spyOnModalRendersPerTest(modalTestID);

  const transitionAnimation = (toVisible: boolean): string | undefined => {
    const renders = rendersOfModal();
    const inState = renders.map((props) => Boolean(props.visible) === toVisible);
    const lastInState = inState.lastIndexOf(true);
    const runStart = inState.slice(0, lastInState + 1).lastIndexOf(false) + 1;

    // A run that starts at the first render is the mount, not a transition.
    return lastInState === -1 || runStart === 0 ? undefined : renders[runStart]?.animationType;
  };

  return {
    lastHiddenAnimation: () => transitionAnimation(false),
    lastShownAnimation: () => transitionAnimation(true),
  };
};
