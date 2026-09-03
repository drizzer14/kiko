import { render } from '@testing-library/react-native';
import '../../unistyles';
import TextField from '.';

describe('TextField', () => {
  it('renders its label as a caption and the value in the input', async () => {
    const { getByText, getByDisplayValue } = await render(
      <TextField label="Token" value="abc123" onChangeText={jest.fn()} />,
    );

    expect(getByText('Token')).toBeTruthy();
    expect(getByDisplayValue('abc123')).toBeTruthy();
  });

  it('forwards secureTextEntry to the input so a secret field is masked', async () => {
    const { getByLabelText } = await render(
      <TextField label="Token" value="secret" onChangeText={jest.fn()} secureTextEntry />,
    );

    expect(getByLabelText('Token').props.secureTextEntry).toBe(true);
  });

  it('defaults secureTextEntry off for an ordinary field', async () => {
    const { getByLabelText } = await render(
      <TextField label="Name" value="Jane" onChangeText={jest.fn()} />,
    );

    // Undefined (never masked) unless the caller opts in.
    expect(getByLabelText('Name').props.secureTextEntry).toBeUndefined();
  });
});
