import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';

// The Text primitive's tone -> color mapping lives in a react-native-unistyles
// variant that the project's Jest mock strips before a test can inspect it.
// A screen test that needs to assert the resolved MoneyText `tone` mocks Text
// with this component, exposing the tone via a testID while still rendering the
// amount as plain text so every getByText assertion is unaffected.
const MockTextTone = ({ tone, children }: { tone: string; children: ReactNode }) => (
  <RNText testID={`text-tone-${tone}`}>{children}</RNText>
);

export default MockTextTone;
