import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';

// The real Settings screen (wired into RootNavigator) pulls in db/client,
// which opens a real op-sqlite connection at module load. op-sqlite has no
// Jest binary, so stub it the same way every repo test does.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import '../design-system/unistyles';
import RootNavigator from './root.navigator';

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
