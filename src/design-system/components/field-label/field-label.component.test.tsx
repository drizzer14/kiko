import { render } from '@testing-library/react-native';
import '../../unistyles';
import FieldLabel from '.';

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
});
