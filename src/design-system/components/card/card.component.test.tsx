import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import Text from '@kiko/design-system/components/text';
import { useIsOnAccent } from '@kiko/design-system/selected-surface';

import Card from './card.component';

const cardStyle = async (props: { selected?: boolean } = {}) => {
  const { getByTestId } = await render(
    <Card testID="card" {...props}>
      <Text>content</Text>
    </Card>,
  );

  return StyleSheet.flatten(getByTestId('card').props.style);
};

describe('Card', () => {
  it('is the solid content surface with a hairline border', async () => {
    const style = await cardStyle();

    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
    expect(style.borderColor).toBe(darkTheme.colors.border);
    expect(style.borderWidth).toBeGreaterThan(0);
  });

  it('marks the row a pane shows selected with the accent fill, border included', async () => {
    const style = await cardStyle({ selected: true });

    expect(style.backgroundColor).toBe(darkTheme.colors.accent);
    expect(style.borderColor).toBe(darkTheme.colors.accent);
  });

  it('keeps the border width when selected, so the content does not shift', async () => {
    expect((await cardStyle({ selected: true })).borderWidth).toBe((await cardStyle()).borderWidth);
  });

  // The foreground is `onAccent` only on the accent fill, so a caller cannot change the fill.
  it('lets the selected look win over a caller style', async () => {
    const { getByTestId } = await render(
      <Card testID="card" selected style={{ backgroundColor: '#123456', borderRadius: 3 }}>
        <Text>content</Text>
      </Card>,
    );
    const style = StyleSheet.flatten(getByTestId('card').props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors.accent);
    expect(style.borderRadius).toBe(3);
  });

  describe('what it draws inside', () => {
    const Probe = () => <Text>{useIsOnAccent() ? 'on accent' : 'on surface'}</Text>;

    it('sits on the accent when selected', async () => {
      const { getByText } = await render(
        <Card selected>
          <Probe />
        </Card>,
      );

      expect(getByText('on accent')).toBeTruthy();
    });

    it('sits on the plain surface when not selected, even inside a selected card', async () => {
      const { getByText } = await render(
        <Card selected>
          <Card>
            <Probe />
          </Card>
        </Card>,
      );

      expect(getByText('on surface')).toBeTruthy();
    });
  });
});
