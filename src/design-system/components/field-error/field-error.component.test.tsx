import { render } from '@testing-library/react-native';
import '../../unistyles';
import FieldError from '.';

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
});
