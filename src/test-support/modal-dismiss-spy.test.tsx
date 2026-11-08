import { Modal } from 'react-native';
import { render } from '@testing-library/react-native';

import { spyOnModalDismissPerTest } from './modal-dismiss-spy';

describe('spyOnModalDismissPerTest', () => {
  const spy = spyOnModalDismissPerTest('probe-modal');

  it('calls the dismiss handler the latest render of the Modal was handed', async () => {
    const early = jest.fn();
    const latest = jest.fn();
    const screen = await render(<Modal visible onDismiss={early} testID="probe-modal" />);

    await screen.rerender(<Modal visible={false} onDismiss={latest} testID="probe-modal" />);
    await spy.finishClosing();

    expect(latest).toHaveBeenCalledTimes(1);
    expect(early).not.toHaveBeenCalled();
  });

  // Native reads the handler of the render that hid the Modal, so a handler dropped on that
  // render is a dismiss that never reaches the screen.
  it('calls nothing when the latest render dropped its dismiss handler', async () => {
    const early = jest.fn();
    const screen = await render(<Modal visible onDismiss={early} testID="probe-modal" />);

    await screen.rerender(<Modal visible={false} testID="probe-modal" />);
    await spy.finishClosing();

    expect(early).not.toHaveBeenCalled();
  });

  it('ignores the renders of another Modal', async () => {
    const probe = jest.fn();
    const other = jest.fn();

    await render(
      <>
        <Modal visible onDismiss={probe} testID="probe-modal" />
        <Modal visible onDismiss={other} testID="other-modal" />
      </>,
    );
    await spy.finishClosing();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('fails when the Modal was never rendered, rather than pass on no dismissal', async () => {
    await expect(spy.finishClosing()).rejects.toThrow('probe-modal');
  });
});
