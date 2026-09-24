import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import '../../unistyles';
import FieldLabel from '.';

// Text's tone -> color mapping is a react-native-unistyles variant, which
// this project's Jest setup cannot resolve back out of a rendered style (the
// same limitation `use-keyboard-done-accessory.test.tsx` documents) — mock
// Text to surface its `tone` prop through a testID instead. Children still
// render as plain text, so every other query in this file is unaffected.
jest.mock('../text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone = 'textPrimary', children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

describe('FieldLabel', () => {
  it('renders the label text', async () => {
    const { getByText } = await render(<FieldLabel label="Name" />);

    expect(getByText('Name')).toBeTruthy();
  });

  it('renders an asterisk when required', async () => {
    const { getByText } = await render(<FieldLabel label="Name" required />);

    // The marker is hidden from the accessibility tree (see below), so the
    // query must include hidden elements to see the rendered "*".
    expect(getByText('*', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders no asterisk when not required', async () => {
    const { queryByText } = await render(<FieldLabel label="Name" />);

    expect(queryByText('*')).toBeNull();
  });

  it('hides the required marker from accessibility so VoiceOver never reads a lone "star"', async () => {
    const { getByText } = await render(<FieldLabel label="Name" required />);

    // The marker is decorative: the field's own control owns its
    // accessibilityLabel, so the "*" must be hidden from the accessibility tree.
    const marker = getByText('*', { includeHiddenElements: true });

    expect(marker.parent?.props.accessibilityElementsHidden).toBe(true);
  });

  it('keeps the label in the textSecondary tone by default', async () => {
    const { getByTestId } = await render(<FieldLabel label="Name" />);

    expect(getByTestId('text-tone-textSecondary')).toHaveTextContent('Name');
  });

  it('tints the label negative when invalid', async () => {
    const { getByTestId } = await render(<FieldLabel label="Name" invalid />);

    expect(getByTestId('text-tone-negative')).toHaveTextContent('Name');
  });

  it('keeps the label textSecondary when not invalid', async () => {
    const { getByTestId } = await render(<FieldLabel label="Name" invalid={false} />);

    expect(getByTestId('text-tone-textSecondary')).toHaveTextContent('Name');
  });
});
