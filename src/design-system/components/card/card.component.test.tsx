import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { darkTheme } from '@kiko/design-system/theme';
import Text from '@kiko/design-system/components/text';

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

  it('marks the row a pane shows selected with a raised surface and an accent border', async () => {
    const style = await cardStyle({ selected: true });

    expect(style.backgroundColor).toBe(darkTheme.colors.surfaceHigh);
    expect(style.borderColor).toBe(darkTheme.colors.accent);
  });

  it('keeps the border width when selected, so the content does not shift', async () => {
    expect((await cardStyle({ selected: true })).borderWidth).toBe((await cardStyle()).borderWidth);
  });

  it('lets a caller style win over the selected look', async () => {
    const { getByTestId } = await render(
      <Card testID="card" selected style={{ backgroundColor: '#123456' }}>
        <Text>content</Text>
      </Card>,
    );

    expect(StyleSheet.flatten(getByTestId('card').props.style).backgroundColor).toBe('#123456');
  });
});
