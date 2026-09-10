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

    expect(getByText('*')).toBeTruthy();
  });

  it('renders no asterisk when not required', async () => {
    const { queryByText } = await render(<FieldLabel label="Name" />);

    expect(queryByText('*')).toBeNull();
  });
});
