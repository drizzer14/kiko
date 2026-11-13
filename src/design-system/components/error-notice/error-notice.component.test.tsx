import { AccessibilityInfo } from 'react-native';
import { FadeIn } from 'react-native-reanimated';
import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';
import { glyphNamesWithin, glyphTintsWithin } from '@kiko/test-support/glyphs-within';

import ErrorNotice from '.';

// A getter, so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

const message = 'Could not connect. Check the token and try again.';

describe('ErrorNotice', () => {
  beforeEach(() => {
    jest.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
  });

  it('renders the message beside the exclamationmark.triangle.fill icon at the body icon size in the negative tone', async () => {
    const view = await render(<ErrorNotice message={message} />);

    expect(view.getByText(message)).toBeTruthy();

    const alert = view.getByRole('alert');

    expect(glyphNamesWithin(alert)).toEqual(['exclamationmark.triangle.fill']);
    expect(glyphTintsWithin(alert)).toEqual([darkTheme.colors.negative]);

    const icons =
      view.root?.queryAll((node) => node.props.fallbackName === 'exclamationmark.triangle.fill') ??
      [];

    expect(icons[0]?.props.size).toBe(darkTheme.iconSizes.body);
  });

  it('shows the message as body text in the textPrimary tone', async () => {
    const { getByText } = await render(<ErrorNotice message={message} />);

    expect(getByText(message).props.variant).toBe('body');
    expect(getByText(message).props.tone).toBe('textPrimary');
  });

  it('is one accessible alert element labelled by the message', async () => {
    const { getByRole } = await render(<ErrorNotice message={message} />);

    expect(getByRole('alert').props.accessible).toBe(true);
    expect(getByRole('alert').props.accessibilityLabel).toBe(message);
  });

  it('paints the negativeSubtle fill with the small radius and the spacing(3) padding', async () => {
    const { getByRole } = await render(<ErrorNotice message={message} />);
    const style = JSON.stringify(getByRole('alert').props.style);

    expect(style).toContain(darkTheme.colors.negativeSubtle);
    expect(style).toContain(`"borderRadius":${darkTheme.radii.sm}`);
    expect(style).toContain(`"padding":${darkTheme.spacing(3)}`);
  });

  it('lets the text take the remaining width beside a top-aligned icon', async () => {
    const { getByText, getByRole } = await render(<ErrorNotice message={message} />);

    expect(JSON.stringify(getByText(message).parent?.props.style)).toContain('"flex":1');
    expect(JSON.stringify(getByRole('alert').props.style)).toContain('flex-start');
  });

  it('spaces the icon from the text by the spacing(2) gap', async () => {
    const { getByRole } = await render(<ErrorNotice message={message} />);

    expect(JSON.stringify(getByRole('alert').props.style)).toContain(
      `"gap":${darkTheme.spacing(2)}`,
    );
  });

  it('puts an optional testID on the outer container, around the alert row and not on it', async () => {
    const view = await render(<ErrorNotice message={message} testID="notice" />);

    expect(view.getByTestId('notice')).not.toBe(view.getByRole('alert'));
    expect(within(view.getByTestId('notice')).getByRole('alert')).toBe(view.getByRole('alert'));
  });

  it('enters with the FadeIn preset', async () => {
    const { getByTestId } = await render(<ErrorNotice message={message} testID="notice" />);

    expect(getByTestId('notice').props.entering).toBe(FadeIn);
  });

  it('announces the message to VoiceOver on mount, once per text, again when the text changes', async () => {
    const view = await render(<ErrorNotice message={message} />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith(message);

    await view.rerender(<ErrorNotice message={message} />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);

    await view.rerender(<ErrorNotice message="Another failure." />);

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Another failure.');
  });

  it('stays silent when announce is false', async () => {
    await render(<ErrorNotice message={message} announce={false} />);

    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('renders every line in one block, each line carrying its own testID, labelled by the lines joined with a period and a space', async () => {
    const view = await render(
      <ErrorNotice
        lines={[
          { key: 'one', text: 'line 1', testID: 'a' },
          { key: 'two', text: 'line 2', testID: 'b' },
        ]}
      />,
    );

    expect(view.getAllByRole('alert')).toHaveLength(1);
    expect(view.getByTestId('a')).toHaveTextContent('line 1');
    expect(view.getByTestId('b')).toHaveTextContent('line 2');
    expect(view.getByRole('alert').props.accessibilityLabel).toBe('line 1. line 2');
    expect(glyphNamesWithin(view.getByRole('alert'))).toEqual(['exclamationmark.triangle.fill']);
  });

  it('shows each line as body text in the textPrimary tone, the lines spaced by the spacing(1) gap', async () => {
    const view = await render(
      <ErrorNotice
        lines={[
          { key: 'one', text: 'line 1', testID: 'a' },
          { key: 'two', text: 'line 2', testID: 'b' },
        ]}
      />,
    );

    for (const text of ['line 1', 'line 2']) {
      expect(view.getByText(text).props.variant).toBe('body');
      expect(view.getByText(text).props.tone).toBe('textPrimary');
    }

    const lineBlock = view.getByTestId('a').parent;

    if (lineBlock === null) {
      throw new Error('The first line has no parent');
    }

    const gapped = ancestorWithStyle(lineBlock, 'gap');

    expect(within(gapped).getByTestId('b')).toBeTruthy();
    expect(JSON.stringify(gapped.props.style)).toContain(`"gap":${darkTheme.spacing(1)}`);
  });
});
