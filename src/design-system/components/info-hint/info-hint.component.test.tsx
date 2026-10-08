import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';

import InfoHint from '.';

describe('InfoHint', () => {
  it('renders the info.circle icon at the caption icon size beside the text', async () => {
    const view = await render(<InfoHint message="Tap Connect first." />);

    expect(view.getByText('Tap Connect first.')).toBeTruthy();

    const icons = view.root?.queryAll((node) => node.props.name === 'info.circle') ?? [];

    expect(icons[0]?.props.size).toBe(darkTheme.iconSizes.caption);
  });

  it('is one accessible element labelled by the message', async () => {
    const { getByLabelText } = await render(<InfoHint message="Tap Connect first." />);

    expect(getByLabelText('Tap Connect first.').props.accessible).toBe(true);
  });

  it('lets the text take the remaining width so it wraps beside the icon, top-aligned', async () => {
    const { getByText, getByTestId } = await render(
      <InfoHint message="A long message" testID="hint" />,
    );

    expect(JSON.stringify(getByText('A long message').parent?.props.style)).toContain('"flex":1');
    expect(JSON.stringify(getByTestId('hint').props.style)).toContain('flex-start');
  });
});
