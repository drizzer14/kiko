import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
// Real i18n init (side effect), same as App.tsx. Previously reached only by
// accident through GlassSurface -> screenshot-mode -> i18n before the 5.6
// screenshot-subsystem strip removed that import chain; now imported directly
// so `t('common.cancel')` resolves under test the same way it does at runtime.
import '@kiko/i18n/init';

import ConfirmSheet from '.';

// The real Button routes its variant fill/label colors through a
// react-native-unistyles `variants` block that the project's Jest mock strips
// from the resolved style (see button.component.test.tsx), so the destructive
// vs. primary choice cannot be proven from the rendered style. Mock Button to
// forward every prop onto a host Pressable (and render its label in a Text) so
// the `variant` ConfirmSheet passes is the honest, assertable signal while the
// press handler still fires.
jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text } = require('react-native');
  const MockButton = ({ children, ...rest }: { children?: unknown }) => (
    <Pressable {...rest}>
      <Text>{children}</Text>
    </Pressable>
  );

  return { __esModule: true, default: MockButton };
});

const CONFIRM_TEST_ID = 'confirm-action';

describe('ConfirmSheet', () => {
  it('renders the title, message, and confirm label while visible', async () => {
    const { getByText } = await render(
      <ConfirmSheet
        visible
        title={'Delete "Cash"'}
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(getByText('Delete "Cash"')).toBeTruthy();
    expect(getByText('This cannot be undone.')).toBeTruthy();
    expect(getByText('Delete')).toBeTruthy();
  });

  it('renders nothing while not visible', async () => {
    const { queryByText } = await render(
      <ConfirmSheet
        visible={false}
        title={'Delete "Cash"'}
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(queryByText('Delete "Cash"')).toBeNull();
  });

  it('renders no body when no message is passed (a bare title-only confirm)', async () => {
    const { queryByText, getByText } = await render(
      <ConfirmSheet
        visible
        title={'Delete "Cash"'}
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(getByText('Delete "Cash"')).toBeTruthy();
    expect(queryByText('This cannot be undone.')).toBeNull();
  });

  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <ConfirmSheet
        visible
        title={'Delete "Cash"'}
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
        confirmTestID={CONFIRM_TEST_ID}
      />,
    );

    await fireEvent.press(getByTestId(CONFIRM_TEST_ID));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when the ghost Cancel is pressed (a dismiss behaves like cancel)', async () => {
    const onCancel = jest.fn();
    const { getByText } = await render(
      <ConfirmSheet
        visible
        title={'Delete "Cash"'}
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    await fireEvent.press(getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses the destructive Button variant for the confirm action when destructive', async () => {
    const { getByTestId } = await render(
      <ConfirmSheet
        visible
        title={'Delete "Cash"'}
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        destructive
        confirmTestID={CONFIRM_TEST_ID}
      />,
    );

    expect(getByTestId(CONFIRM_TEST_ID).props.variant).toBe('destructive');
  });

  it('uses the primary Button variant for the confirm action when not destructive', async () => {
    const { getByTestId } = await render(
      <ConfirmSheet
        visible
        title="Delete Transaction"
        confirmLabel="Delete"
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
        confirmTestID={CONFIRM_TEST_ID}
      />,
    );

    expect(getByTestId(CONFIRM_TEST_ID).props.variant).toBe('primary');
  });
});
