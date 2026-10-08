import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import ReminderOfferCard from '.';

// The Jest unistyles mock strips `variants` from the resolved style, so the
// Button variant is read from the props the card passes, not from a fill color.
jest.mock('@kiko/design-system/components/button', () => {
  const actual = jest.requireActual('@kiko/design-system/components/button');

  return { __esModule: true, default: jest.fn(actual.default) };
});

const { default: mockButton } = jest.requireMock('@kiko/design-system/components/button') as {
  default: jest.Mock;
};

const MESSAGE = 'Get a reminder to import this account every month?';
const ACCEPT = 'Set a reminder';
const DISMISS = 'Not now';

const renderCard = (overrides: { onAccept?: () => void; onDismiss?: () => void } = {}) =>
  render(
    <ReminderOfferCard
      message={MESSAGE}
      acceptLabel={ACCEPT}
      dismissLabel={DISMISS}
      onAccept={overrides.onAccept ?? jest.fn()}
      onDismiss={overrides.onDismiss ?? jest.fn()}
      testID="offer"
    />,
  );

const buttonPropsFor = (label: string): Record<string, unknown> => {
  const call = mockButton.mock.calls.find(([props]) => props.children === label);

  if (call === undefined) {
    throw new Error(`no Button rendered with the label ${label}`);
  }

  return call[0];
};

describe('ReminderOfferCard', () => {
  beforeEach(() => {
    mockButton.mockClear();
  });

  it('renders the message on the shared solid Card surface', async () => {
    const { getByText, getByTestId } = await renderCard();

    expect(getByText(MESSAGE)).toBeTruthy();

    const style = StyleSheet.flatten(getByTestId('offer').props.style);
    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
    expect(style.borderColor).toBe(darkTheme.colors.border);
    expect(style.borderRadius).toBe(darkTheme.radii.md);
  });

  it('reports an accept press', async () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await renderCard({ onAccept, onDismiss });

    await fireEvent.press(getByText(ACCEPT));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('reports a dismiss press', async () => {
    const onAccept = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await renderCard({ onAccept, onDismiss });

    await fireEvent.press(getByText(DISMISS));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('renders accept as the small primary and dismiss as the small faint-tint secondary', async () => {
    await renderCard();

    expect(buttonPropsFor(ACCEPT)).toMatchObject({
      variant: 'primary',
      size: 'small',
      fullWidth: false,
    });
    expect(buttonPropsFor(DISMISS)).toMatchObject({
      variant: 'secondaryTonal',
      size: 'small',
      fullWidth: false,
    });
  });

  it('keeps a 44pt tap target on both small buttons', async () => {
    const { getAllByRole } = await renderCard();
    const buttons = getAllByRole('button');

    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      const slop = button.props.hitSlop as { top: number; bottom: number };
      const visibleHeight = StyleSheet.flatten(button.props.style).minHeight as number;

      expect(visibleHeight + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    }
  });
});
