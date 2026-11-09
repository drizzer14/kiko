import { Modal } from 'react-native';
import { render } from '@testing-library/react-native';

import { spyOnModalDismissPerTest } from './modal-dismiss-spy';

// Read by the describe after the one that registers it, to see an accessor outliving its test.
let spyOfFirstDescribe: ReturnType<typeof spyOnModalDismissPerTest>;

describe('spyOnModalDismissPerTest', () => {
  const spy = spyOnModalDismissPerTest('probe-modal');
  spyOfFirstDescribe = spy;

  it('spies on the Modal render while the test runs', () => {
    expect(jest.isMockFunction(Modal)).toBe(true);
  });

  it('calls the dismiss handler the latest render of the Modal was handed', async () => {
    const early = jest.fn();
    const latest = jest.fn();
    const screen = await render(<Modal visible onDismiss={early} testID="probe-modal" />);

    await screen.rerender(<Modal visible={false} onDismiss={latest} testID="probe-modal" />);
    await spy.finishClosing();

    expect(latest).toHaveBeenCalledTimes(1);
    expect(early).not.toHaveBeenCalled();
  });

  // Native calls the handler of the latest render, so a handler dropped on that render is a
  // dismiss that never reaches the screen.
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
        <Modal visible={false} onDismiss={probe} testID="probe-modal" />
        <Modal visible={false} onDismiss={other} testID="other-modal" />
      </>,
    );
    await spy.finishClosing();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  // Native fires the handler only after a hide, so a test that finishes a close the Modal never
  // started would pass on a dismissal that cannot happen.
  it('fails while the latest render of the Modal is still visible', async () => {
    const dismiss = jest.fn();

    await render(<Modal visible onDismiss={dismiss} testID="probe-modal" />);

    await expect(spy.finishClosing()).rejects.toThrow('still visible');
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('fails when the Modal was never rendered, rather than pass on no dismissal', async () => {
    await expect(spy.finishClosing()).rejects.toThrow('probe-modal');
  });
});

// Jest runs a file's tests in definition order, so this describe runs after the one above: it
// proves the helper restored the Modal, so a test that comes later sees the real one. The
// project's `clearMocks` only clears call history and never restores a spy. The proof needs that
// in-file order: under --randomize it would pass vacuously.
describe('a describe after the one that registered the helper', () => {
  it('sees the real Modal, not the spy', () => {
    expect(jest.isMockFunction(Modal)).toBe(false);
  });

  it('refuses to read the spy of a test that has finished', async () => {
    await expect(spyOfFirstDescribe.finishClosing()).rejects.toThrow(
      'only readable while a test runs',
    );
  });
});
