import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import TipCard from '.';

const MESSAGE = 'Tap and hold a card to edit or delete it.';
const CLOSE = 'Dismiss tip';

describe('TipCard', () => {
  it('renders the message on the shared solid Card surface', async () => {
    const { getByText, getByTestId } = await render(
      <TipCard message={MESSAGE} closeLabel={CLOSE} onClose={jest.fn()} testID="tip" />,
    );

    expect(getByText(MESSAGE)).toBeTruthy();

    const style = StyleSheet.flatten(getByTestId('tip').props.style);
    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
  });

  it('renders a close button with the given accessibility label', async () => {
    const { getByRole } = await render(
      <TipCard message={MESSAGE} closeLabel={CLOSE} onClose={jest.fn()} />,
    );

    expect(getByRole('button', { name: CLOSE })).toBeTruthy();
  });

  it('calls onClose once when the close button is pressed', async () => {
    const onClose = jest.fn();
    const { getByRole } = await render(
      <TipCard message={MESSAGE} closeLabel={CLOSE} onClose={onClose} />,
    );

    await fireEvent.press(getByRole('button', { name: CLOSE }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close button hugging its icon instead of stretching across the card', async () => {
    const { getByRole } = await render(
      <TipCard message={MESSAGE} closeLabel={CLOSE} onClose={jest.fn()} />,
    );

    expect(
      StyleSheet.flatten(getByRole('button', { name: CLOSE }).props.style).width,
    ).toBeUndefined();
  });

  it('keeps a 44pt tap target on the close button', async () => {
    const { getByRole } = await render(
      <TipCard message={MESSAGE} closeLabel={CLOSE} onClose={jest.fn()} />,
    );
    const button = getByRole('button', { name: CLOSE });
    const style = StyleSheet.flatten(button.props.style);
    const slop = (button.props.hitSlop ?? { top: 0, bottom: 0 }) as { top: number; bottom: number };

    expect((style.minHeight as number) + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });
});
