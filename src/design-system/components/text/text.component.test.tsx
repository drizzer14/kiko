import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import Text from './text.component';

describe('Text', () => {
  it('renders its children', async () => {
    const { getByText } = await render(<Text>Hello</Text>);
    expect(getByText('Hello')).toBeTruthy();
  });

  // Unistyles resolves variant styles natively, so jest sees an empty style:
  // the size, weight and line height are pinned on the token in theme.test.ts.
  it('renders largeTitle unscaled, like the fixed-size native large title', async () => {
    const { getByText } = await render(<Text variant="largeTitle">Title</Text>);

    expect(getByText('Title').props.allowFontScaling).toBe(false);
  });

  it('keeps Dynamic Type scaling on for the other variants', async () => {
    const { getByText } = await render(<Text variant="heading">Head</Text>);

    expect(getByText('Head').props.allowFontScaling).toBe(true);
  });

  it('marks itself as a heading for the screen reader when asked', async () => {
    const { getByText } = await render(<Text accessibilityRole="header">Title</Text>);

    expect(getByText('Title').props.accessibilityRole).toBe('header');
  });

  it('has no accessibility role of its own', async () => {
    const { getByText } = await render(<Text>plain</Text>);

    expect(getByText('plain').props.accessibilityRole).toBeUndefined();
  });

  it('forwards single-line shrink-to-fit props to the underlying Text', async () => {
    const { getByText } = await render(
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        $1,234,567.89
      </Text>,
    );

    const node = getByText('$1,234,567.89');
    expect(node.props.numberOfLines).toBe(1);
    expect(node.props.adjustsFontSizeToFit).toBe(true);
    expect(node.props.minimumFontScale).toBe(0.7);
  });

  it('leaves the shrink-to-fit props undefined when not supplied', async () => {
    const { getByText } = await render(<Text>plain</Text>);

    const node = getByText('plain');
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.adjustsFontSizeToFit).toBeUndefined();
    expect(node.props.minimumFontScale).toBeUndefined();
  });
});
