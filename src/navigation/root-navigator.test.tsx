import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';
import '../design-system/unistyles';
import { RootNavigator } from './root-navigator';

describe('RootNavigator', () => {
  it('boots to the Home screen', async () => {
    const { findByText } = await render(
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>,
    );
    expect(await findByText('Home')).toBeTruthy();
  });
});
