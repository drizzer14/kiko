import { StackActions } from '@react-navigation/native';

import { resetTabStackOnBlur } from './reset-tab-stack-on-blur';

/**
 * Builds a fake stack-screen navigation whose parent tab reports the given
 * focus state (`undefined` = no parent navigator at all) and whose stack sits
 * at the given route index (`0` = the stack is at its root, nothing to pop).
 */
const buildNavigation = (parentFocused: boolean | undefined, stackIndex = 1) => {
  const dispatch = jest.fn();
  const getParent = () =>
    parentFocused === undefined ? undefined : { isFocused: () => parentFocused };
  const getState = () => ({ index: stackIndex });
  // Only `getParent`, `getState`, and `dispatch` are exercised; cast the fake.
  const navigation = { dispatch, getParent, getState } as unknown as Parameters<
    typeof resetTabStackOnBlur
  >[0]['navigation'];
  return { dispatch, navigation };
};

describe('resetTabStackOnBlur', () => {
  it('pops the stack to its root when the tab is no longer focused', () => {
    const { dispatch, navigation } = buildNavigation(false, 1);

    resetTabStackOnBlur({ navigation }).blur();

    expect(dispatch).toHaveBeenCalledWith(StackActions.popToTop());
  });

  it('does not pop when the unfocused tab is already at its stack root', () => {
    const { dispatch, navigation } = buildNavigation(false, 0);

    resetTabStackOnBlur({ navigation }).blur();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves an in-stack push untouched while the tab stays focused', () => {
    const { dispatch, navigation } = buildNavigation(true, 1);

    resetTabStackOnBlur({ navigation }).blur();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does nothing when the stack has no parent tab', () => {
    const { dispatch, navigation } = buildNavigation(undefined, 1);

    resetTabStackOnBlur({ navigation }).blur();

    expect(dispatch).not.toHaveBeenCalled();
  });
});
