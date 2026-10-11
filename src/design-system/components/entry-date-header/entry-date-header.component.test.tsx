import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';

import EntryDateHeader from '.';

jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-variant-tone').default,
}));

describe('EntryDateHeader', () => {
  it('draws its title as a secondary caption with room above and a tight gap below', async () => {
    const { getByTestId } = await render(<EntryDateHeader title="Today" testID="header" />);

    expect(layoutOf(getByTestId('header'))).toEqual({
      style: { paddingTop: darkTheme.spacing(3), paddingBottom: darkTheme.spacing(1) },
      testID: 'header',
      children: [{ variant: 'caption', tone: 'textSecondary', children: ['Today'] }],
    });
  });

  it('renders without a testID', async () => {
    const { getByText } = await render(<EntryDateHeader title="15.11.2026" />);

    expect(getByText('15.11.2026')).toBeTruthy();
  });
});
