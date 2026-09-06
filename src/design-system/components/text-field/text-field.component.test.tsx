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

  it('renders a trailing suffix after the input', async () => {
    const { getByText, getByDisplayValue } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} suffix="₴" />,
    );

    // The value stays in the input; the currency glyph shows alongside it.
    expect(getByDisplayValue('100.00')).toBeTruthy();
    expect(getByText('₴')).toBeTruthy();
  });

  it('renders no suffix by default', async () => {
    const { queryByText } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} />,
    );

    expect(queryByText('₴')).toBeNull();
  });

  it('treats an empty suffix as no suffix', async () => {
    const { queryByText } = await render(
      <TextField label="Amount" value="100.00" onChangeText={jest.fn()} suffix="" />,
    );

    // An empty suffix (a currency not yet known) renders exactly as the
    // no-suffix field — no stray trailing node.
    expect(queryByText('')).toBeNull();
  });
});
