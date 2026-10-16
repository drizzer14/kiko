import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';

// The Text primitive's variant and tone live in a react-native-unistyles variant that the
// project's Jest mock strips before a test can inspect it. A test that must pin a label's
// typography step or color mocks Text with this component, which hands both through as host
// props for `layoutOf` (`@kiko/test-support/layout-of`) to record.
const MockTextVariantTone = ({
  variant = 'body',
  tone = 'textPrimary',
  children,
}: {
  variant?: string;
  tone?: string;
  children: ReactNode;
}) => <RNText {...{ variant, tone }}>{children}</RNText>;

export default MockTextVariantTone;
