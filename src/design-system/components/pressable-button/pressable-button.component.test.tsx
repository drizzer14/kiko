import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import '../../unistyles';
import Text from '../text';
import PressableButton from './pressable-button.component';

describe('PressableButton', () => {
  it('renders a title-cased label from the `label` prop', async () => {
    const { getByText } = await render(
      <PressableButton onPress={() => {}} backgroundColor="#000" label="add transaction" />,
    );

    const label = getByText('add transaction');
    // The label text is not rewritten — only presented in title case via a
    // CSS-level transform, so the underlying string stays as passed.
    expect(StyleSheet.flatten(label.props.style).textTransform).toBe('capitalize');
  });

  it('renders raw children without injecting a transform (e.g. currency codes)', async () => {
    const { getByText } = await render(
      <PressableButton onPress={() => {}} backgroundColor="#000">
        <Text variant="body">USD</Text>
      </PressableButton>,
    );

    const child = getByText('USD');
    expect(StyleSheet.flatten(child.props.style).textTransform).toBeUndefined();
  });
});
