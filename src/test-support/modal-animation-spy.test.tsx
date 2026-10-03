import { Modal } from 'react-native';
import { type FC, useEffect, useState } from 'react';
import { render } from '@testing-library/react-native';

import { type ModalAnimationSpy, spyOnModalAnimation } from './modal-animation-spy';

type ProbeProps = {
  visible: boolean;
  animationType: 'fade' | 'none';
  // Moves the animation only AFTER the commit that changed `visible`, the
  // shape of a regression that sets the flag in an effect.
  setsAnimationLate?: boolean;
};

const Probe: FC<ProbeProps> = ({ visible, animationType, setsAnimationLate = false }) => {
  const [lateAnimation, setLateAnimation] = useState<'fade' | 'none'>('fade');

  useEffect(() => {
    setLateAnimation(visible ? 'fade' : 'none');
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType={setsAnimationLate ? lateAnimation : animationType}
      testID="probe-modal"
    />
  );
};

describe('spyOnModalAnimation', () => {
  let spy: ModalAnimationSpy;

  beforeEach(() => {
    spy = spyOnModalAnimation('probe-modal');
  });

  afterEach(() => {
    spy.restore();
  });

  it('reads the animation of the render that hid the Modal', async () => {
    const screen = await render(<Probe visible animationType="fade" />);

    await screen.rerender(<Probe visible={false} animationType="none" />);

    expect(spy.lastHiddenAnimation()).toBe('none');
  });

  it('reads the animation of the render that showed the Modal', async () => {
    const screen = await render(<Probe visible={false} animationType="none" />);

    await screen.rerender(<Probe visible animationType="fade" />);

    expect(spy.lastShownAnimation()).toBe('fade');
  });

  // The native dismiss reads the animation the hiding commit carried; a later
  // re-render that changes it is too late, so the spy must not report it.
  it('does not report an animation set after the hiding commit', async () => {
    const screen = await render(<Probe visible animationType="fade" setsAnimationLate />);

    await screen.rerender(<Probe visible={false} animationType="fade" setsAnimationLate />);

    expect(spy.lastHiddenAnimation()).toBe('fade');
  });

  it('does not report an animation set after the showing commit', async () => {
    const screen = await render(<Probe visible={false} animationType="none" setsAnimationLate />);

    await screen.rerender(<Probe visible animationType="none" setsAnimationLate />);

    expect(spy.lastShownAnimation()).toBe('none');
  });

  it('reads the latest open and close after a second cycle', async () => {
    const screen = await render(<Probe visible animationType="fade" />);

    await screen.rerender(<Probe visible={false} animationType="none" />);
    await screen.rerender(<Probe visible animationType="none" />);
    await screen.rerender(<Probe visible={false} animationType="fade" />);

    expect(spy.lastShownAnimation()).toBe('none');
    expect(spy.lastHiddenAnimation()).toBe('fade');
  });

  // The mount render is not a hide: a sheet that opened and never closed has
  // no hiding commit, so a test asserting the close animation must fail.
  it('reports no hide for a Modal that mounted hidden and was only opened', async () => {
    const screen = await render(<Probe visible={false} animationType="fade" />);

    await screen.rerender(<Probe visible animationType="fade" />);

    expect(spy.lastHiddenAnimation()).toBeUndefined();
  });

  it('reports no show for a Modal that mounted visible and was only closed', async () => {
    const screen = await render(<Probe visible animationType="fade" />);

    await screen.rerender(<Probe visible={false} animationType="fade" />);

    expect(spy.lastShownAnimation()).toBeUndefined();
  });

  it('reports no hide and no show for a Modal that only mounted', async () => {
    await render(<Probe visible={false} animationType="fade" />);

    expect(spy.lastHiddenAnimation()).toBeUndefined();
    expect(spy.lastShownAnimation()).toBeUndefined();
  });
});
