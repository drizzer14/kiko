import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { i18n } from '../../../i18n';
import type { RenderedElement } from '../../../test-support/rendered-element';
import '../../unistyles';
import Button from './button.component';

// The variant-driven fill/label colors live in a react-native-unistyles
// `variants` block, which the project's Jest mock strips out of the resolved
// style before a test can inspect it (see money-text.component.test.tsx). So
// these tests assert behavior and the NON-variant style axes (size, width,
// disabled), never the variant colors. The icon is mocked to a plain text node
// so its presence is queryable without the native SFSymbolView.
jest.mock('../symbol', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <RNText>{`icon:${name}`}</RNText>,
  };
});

const flattenRoot = (node: RenderedElement): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

describe('Button', () => {
  it('renders its children as the label', async () => {
    const { getByText } = await render(<Button onPress={() => {}}>Add holding</Button>);
    expect(getByText('Add holding')).toBeTruthy();
  });

  it('calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button onPress={onPress}>Save</Button>);

    await fireEvent.press(getByText('Save'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress and dims itself when disabled', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button onPress={onPress} disabled>
        Save
      </Button>,
    );

    const button = getByRole('button');
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(flattenRoot(button).opacity).toBe(0.4);
  });

  it('stretches to full width by default', async () => {
    const { getByRole } = await render(<Button onPress={() => {}}>Save</Button>);
    expect(flattenRoot(getByRole('button')).width).toBe('100%');
  });

  it('does not stretch when fullWidth is false', async () => {
    const { getByRole } = await render(
      <Button onPress={() => {}} fullWidth={false}>
        Save
      </Button>,
    );
    expect(flattenRoot(getByRole('button')).width).toBeUndefined();
  });

  it('renders at the prominent regular size by default', async () => {
    const { getByRole } = await render(<Button onPress={() => {}}>Save</Button>);
    const style = flattenRoot(getByRole('button'));
    expect(style.minHeight).toBe(50);
    expect(style.alignSelf).toBeUndefined();
  });

  it('renders a compact, self-hugging button when size is compact', async () => {
    const { getByRole } = await render(
      <Button onPress={() => {}} size="compact" fullWidth={false}>
        Remove
      </Button>,
    );
    const style = flattenRoot(getByRole('button'));
    expect(style.minHeight).toBeUndefined();
    expect(style.alignSelf).toBe('flex-start');
    expect(style.paddingVertical).toBe(8);
  });

  it('renders a leading icon when an icon name is given', async () => {
    const { getByText } = await render(
      <Button onPress={() => {}} icon="checkmark.circle">
        Save
      </Button>,
    );
    expect(getByText('icon:checkmark.circle')).toBeTruthy();
    expect(getByText('Save')).toBeTruthy();
  });

  it('renders a trailing icon when a trailingIcon name is given', async () => {
    const { getByText } = await render(
      <Button onPress={() => {}} trailingIcon="pencil">
        Edit
      </Button>,
    );
    expect(getByText('icon:pencil')).toBeTruthy();
    expect(getByText('Edit')).toBeTruthy();
  });

  it('forwards an accessibilityLabel so identical labels stay distinguishable', async () => {
    const { getByLabelText } = await render(
      <Button onPress={() => {}} accessibilityLabel="Remove contribution 2">
        Remove
      </Button>,
    );
    expect(getByLabelText('Remove contribution 2')).toBeTruthy();
  });

  it('overrides the label color when textColor is given', async () => {
    const { getByText } = await render(
      <Button onPress={() => {}} variant="ghost" textColor="#FF453A">
        Cancel
      </Button>,
    );
    // textColor is applied inline (not through the variant block the mock
    // strips), so it survives into the flattened label style.
    expect(flattenRoot(getByText('Cancel')).color).toBe('#FF453A');
  });

  it('does not force a text transform on the label', async () => {
    const { getByText } = await render(<Button onPress={jest.fn()}>Add account</Button>);

    const style = StyleSheet.flatten(getByText('Add account').props.style);

    expect(style.textTransform).toBeUndefined();
  });

  it('renders a Ukrainian label in sentence case, unchanged', async () => {
    await i18n.changeLanguage('uk');

    const { getByText } = await render(<Button onPress={jest.fn()}>Додати рахунок</Button>);

    expect(getByText('Додати рахунок')).toBeTruthy();

    await i18n.changeLanguage('en');
  });
});
