import { render } from '@testing-library/react-native';
import '../../unistyles';
import Text from './text.component';

describe('Text', () => {
  it('renders its children', async () => {
    const { getByText } = await render(<Text>Hello</Text>);
    expect(getByText('Hello')).toBeTruthy();
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
