import { render } from '@testing-library/react-native';
import '../../unistyles';
import LoadingState from '.';

describe('LoadingState', () => {
  it('renders a spinner with no text — no i18n key to add for this state', async () => {
    const { getByTestId, queryByText } = await render(
      <LoadingState testID="account-detail-loading" />,
    );

    expect(getByTestId('account-detail-loading')).toBeTruthy();
    // A pure spinner carries no visible text at all, so there is no string
    // to assert here — this test documents the absence rather than a value.
    expect(queryByText(/./)).toBeNull();
  });
});
