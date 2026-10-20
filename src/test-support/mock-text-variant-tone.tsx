import type { ReactNode } from 'react';
import { type StyleProp, Text as RNText, type TextStyle } from 'react-native';

// The Text primitive's variant and tone live in a react-native-unistyles variant that the
// project's Jest mock strips before a test can inspect it. A test that must pin a label's
// typography step or color mocks Text with this component, which hands both through as host
// props for `layoutOf` (`@kiko/test-support/layout-of`) to record. `style` goes through too,
// for a test that pins a screen-local override such as a footer line's `textAlign`.
// Mount it through a getter, `get default() { return mockTextVariantTone; }`, in the
// `jest.mock` factory: it is read when `Text` is first used, after the import ran.
const MockTextVariantTone = ({
  variant = 'body',
  tone = 'textPrimary',
  style,
  children,
}: {
  variant?: string;
  tone?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}) => {
  return <RNText {...{ variant, tone, style }}>{children}</RNText>;
};

export default MockTextVariantTone;
