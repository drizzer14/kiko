import { render } from '@testing-library/react-native';
import '../../design-system/unistyles';
import EntityHeaderIcon from './entity-header-icon.component';

describe('EntityHeaderIcon', () => {
  it('renders the entity glyph with the identity icon name and color', async () => {
    const { getByLabelText } = await render(
      <EntityHeaderIcon identity={{ icon: 'creditcard.fill', color: '#FFD60A' }} />,
    );

    // The identity color is a palette hex, passed straight through SymbolIcon to
    // the native SFSymbolView's tintColor (already hex, so the conversion is a
    // no-op). The accessibilityLabel is derived from the icon name.
    const icon = getByLabelText('Icon creditcard.fill');
    expect(icon.props.name).toBe('creditcard.fill');
    expect(icon.props.tintColor).toBe('#FFD60A');
  });

  it('renders nothing when no identity is given (row still loading)', async () => {
    const { toJSON } = await render(<EntityHeaderIcon />);

    expect(toJSON()).toBeNull();
  });
});
