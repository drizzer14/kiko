import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import TextField from '@kiko/design-system/components/text-field';

import { fieldSuffix } from './field-suffix';

describe('fieldSuffix', () => {
  it('reads the unit a field shows after its own input', async () => {
    const { getByLabelText } = await render(
      <>
        <TextField label="Rate" value="" onChangeText={jest.fn()} suffix="%" />
        <TextField label="Amount" value="" onChangeText={jest.fn()} suffix="₴" />
      </>,
    );

    expect(fieldSuffix(getByLabelText('Rate'))).toBe('%');
    expect(fieldSuffix(getByLabelText('Amount'))).toBe('₴');
  });

  it('reads null for a field with no suffix, never its label', async () => {
    const { getByLabelText } = await render(
      <TextField label="Name" value="" onChangeText={jest.fn()} />,
    );

    expect(fieldSuffix(getByLabelText('Name'))).toBeNull();
  });
});
