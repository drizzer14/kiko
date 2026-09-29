import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import NoticeBanner from '.';

const MESSAGE = 'Notifications are off for Kiko.';

describe('NoticeBanner', () => {
  it('renders the message on the surfaceHigh fill with the small corner radius', async () => {
    const { getByText, getByTestId } = await render(
      <NoticeBanner message={MESSAGE} testID="notice" />,
    );

    expect(getByText(MESSAGE)).toBeTruthy();

    const style = StyleSheet.flatten(getByTestId('notice').props.style);
    expect(style.backgroundColor).toBe(darkTheme.colors.surfaceHigh);
    expect(style.borderRadius).toBe(darkTheme.radii.sm);
  });

  it('renders the action button and reports its press when both actionLabel and onAction are given', async () => {
    const onAction = jest.fn();
    const { getByText } = await render(
      <NoticeBanner message={MESSAGE} actionLabel="Open Settings" onAction={onAction} />,
    );

    await fireEvent.press(getByText('Open Settings'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no button when only actionLabel is given', async () => {
    const { queryByRole } = await render(
      <NoticeBanner message={MESSAGE} actionLabel="Open Settings" />,
    );

    expect(queryByRole('button')).toBeNull();
  });

  it('renders no button when only onAction is given', async () => {
    const { queryByRole } = await render(<NoticeBanner message={MESSAGE} onAction={jest.fn()} />);

    expect(queryByRole('button')).toBeNull();
  });

  it('renders no button when neither actionLabel nor onAction is given', async () => {
    const { queryByRole } = await render(<NoticeBanner message={MESSAGE} />);

    expect(queryByRole('button')).toBeNull();
  });
});
