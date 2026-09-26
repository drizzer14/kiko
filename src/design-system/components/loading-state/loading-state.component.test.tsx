import { act, render } from '@testing-library/react-native';

import '../../unistyles';
import LoadingState, { SPINNER_DELAY_MS } from '.';

// A screen whose own read resolves faster than SPINNER_DELAY_MS (the common
// case, off the local op-sqlite worker) never flashes a spinner at all —
// only a genuinely slow first read shows one, so fake timers drive every
// test here explicitly rather than waiting out the real delay.
describe('LoadingState', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the plain background, no spinner, before the delay elapses', async () => {
    const { getByTestId, queryByTestId, queryByText } = await render(
      <LoadingState testID="account-detail-loading" />,
    );

    expect(getByTestId('account-detail-loading')).toBeTruthy();
    expect(queryByTestId('account-detail-loading-spinner')).toBeNull();
    // A pure spinner carries no visible text at all, so there is no string
    // to assert here — this test documents the absence rather than a value.
    expect(queryByText(/./)).toBeNull();
  });

  it('shows the spinner once the delay elapses — no i18n key to add for this state', async () => {
    const { getByTestId, queryByText } = await render(
      <LoadingState testID="account-detail-loading" />,
    );

    await act(async () => {
      jest.advanceTimersByTime(SPINNER_DELAY_MS);
    });

    expect(getByTestId('account-detail-loading-spinner')).toBeTruthy();
    expect(queryByText(/./)).toBeNull();
  });
});
