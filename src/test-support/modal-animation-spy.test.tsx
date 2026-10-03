import { Modal } from 'react-native';
import { type FC, useEffect, useState } from 'react';
import { render } from '@testing-library/react-native';

import { spyOnModalAnimation } from './modal-animation-spy';

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
  it('reads the animation of the render that hid the Modal', async () => {
    const spy = spyOnModalAnimation('probe-modal');
    const screen = await render(<Probe visible animationType="fade" />);

    await screen.rerender(<Probe visible={false} animationType="none" />);

    expect(spy.lastHiddenAnimation()).toBe('none');

    spy.restore();
  });

  it('reads the animation of the render that showed the Modal', async () => {
    const spy = spyOnModalAnimation('probe-modal');
    const screen = await render(<Probe visible={false} animationType="none" />);

    await screen.rerender(<Probe visible animationType="fade" />);

    expect(spy.lastShownAnimation()).toBe('fade');

    spy.restore();
  });

  // The native dismiss reads the animation the hiding commit carried; a later
  // re-render that changes it is too late, so the spy must not report it.
  it('does not report an animation set after the hiding commit', async () => {
    const spy = spyOnModalAnimation('probe-modal');
    const screen = await render(<Probe visible animationType="fade" setsAnimationLate />);

    await screen.rerender(<Probe visible={false} animationType="fade" setsAnimationLate />);

    expect(spy.lastHiddenAnimation()).toBe('fade');

    spy.restore();
  });

  it('does not report an animation set after the showing commit', async () => {
    const spy = spyOnModalAnimation('probe-modal');
    const screen = await render(<Probe visible={false} animationType="none" setsAnimationLate />);

    await screen.rerender(<Probe visible animationType="none" setsAnimationLate />);

    expect(spy.lastShownAnimation()).toBe('none');

    spy.restore();
  });

  it('reads the latest open and close after a second cycle', async () => {
    const spy = spyOnModalAnimation('probe-modal');
    const screen = await render(<Probe visible animationType="fade" />);

    await screen.rerender(<Probe visible={false} animationType="none" />);
    await screen.rerender(<Probe visible animationType="none" />);
    await screen.rerender(<Probe visible={false} animationType="fade" />);

    expect(spy.lastShownAnimation()).toBe('none');
    expect(spy.lastHiddenAnimation()).toBe('fade');

    spy.restore();
  });
});
