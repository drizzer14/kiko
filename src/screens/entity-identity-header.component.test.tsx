import { render } from '@testing-library/react-native';
import '../design-system/unistyles';
import { darkTheme } from '../design-system/theme';
import EntityIdentityHeader from './entity-identity-header.component';

const { entityColors } = darkTheme.colors;

describe('EntityIdentityHeader', () => {
  it('renders the entity name as text', async () => {
    const { getByText } = await render(
      <EntityIdentityHeader icon="creditcard" name="Everyday card" color={entityColors.white} />,
    );

    expect(getByText('Everyday card')).toBeTruthy();
  });

  it('renders the icon tinted by the given effective color', async () => {
    const { getByLabelText } = await render(
      <EntityIdentityHeader icon="building.columns" name="Bank" color={entityColors.violet} />,
    );

    const icon = getByLabelText('Icon building.columns');
    expect(icon).toBeTruthy();
    expect(icon.props.tintColor).toBe(entityColors.violet);
  });
});
