import { StyleSheet } from 'react-native';
import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';
import { glyphNamesWithin, glyphTintsWithin } from '@kiko/test-support/glyphs-within';

import FieldError from '.';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

describe('FieldError', () => {
  it('renders the message in the negative caption tone', async () => {
    const { getByText } = await render(<FieldError message="Enter an amount greater than 0." />);

    expect(getByText('Enter an amount greater than 0.')).toBeTruthy();
  });

  it('applies an optional testID to its outer container', async () => {
    const { getByTestId } = await render(
      <FieldError message="Select a category." testID="my-reason" />,
    );

    expect(getByTestId('my-reason')).toBeTruthy();
  });

  it('renders no testID when none is passed', async () => {
    const { queryByTestId } = await render(<FieldError message="Select a category." />);

    expect(queryByTestId('my-reason')).toBeNull();
  });

  it('leads the message with the exclamationmark.triangle.fill icon at the caption icon size in the negative tone', async () => {
    const view = await render(<FieldError message="Select a category." testID="my-reason" />);
    const field = view.getByTestId('my-reason');

    expect(glyphNamesWithin(field)).toEqual(['exclamationmark.triangle.fill']);
    expect(glyphTintsWithin(field)).toEqual([darkTheme.colors.negative]);

    const icons =
      view.root?.queryAll((node) => node.props.fallbackName === 'exclamationmark.triangle.fill') ??
      [];

    expect(icons[0]?.props.size).toBe(darkTheme.iconSizes.caption);
  });

  it('keeps the message as caption text in the negative tone', async () => {
    const { getByText } = await render(<FieldError message="Select a category." />);

    expect(getByText('Select a category.').props.variant).toBe('caption');
    expect(getByText('Select a category.').props.tone).toBe('negative');
  });

  it('is one accessible element labelled by the message', async () => {
    const { getByLabelText, queryByRole } = await render(
      <FieldError message="Select a category." />,
    );

    expect(getByLabelText('Select a category.').props.accessible).toBe(true);
    expect(queryByRole('alert')).toBeNull();
  });

  it('lets the message wrap beside a top-aligned icon', async () => {
    const { getByText, getByLabelText } = await render(
      <FieldError message="A long message that wraps" />,
    );

    expect(
      StyleSheet.flatten(getByText('A long message that wraps').parent?.props.style).flex,
    ).toBe(1);
    expect(JSON.stringify(getByLabelText('A long message that wraps').props.style)).toContain(
      'flex-start',
    );
  });

  it('keeps the testID on its outer animated container around the row', async () => {
    const { getByTestId, getByLabelText } = await render(
      <FieldError message="Select a category." testID="my-reason" />,
    );

    expect(getByTestId('my-reason')).not.toBe(getByLabelText('Select a category.'));
    expect(within(getByTestId('my-reason')).getByLabelText('Select a category.')).toBe(
      getByLabelText('Select a category.'),
    );
  });
});
