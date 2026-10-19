import { render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import SegmentedControl from './segmented-control.component';

// The jest unistyles mock strips every resolved variant style (fontSize
// included) from a rendered node's style, since `Text` resolves its variant
// through `styles.useVariants(...)`, which the mock does not compute — the
// same caveat documented in `trend-filter-field.section-header-tone.test.tsx`.
// Mock the shared `Text` primitive with the shared passthrough that forwards its
// `variant` prop onto the host node instead, so `labelVariant` can be
// asserted from the PROP it actually drives. Kept in its own file (rather
// than inside `segmented-control.component.test.tsx`) so this file-wide
// module mock never touches that file's other assertions, which render the
// real `Text`.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

describe('SegmentedControl labelVariant', () => {
  it('defaults the segment label to the body variant when labelVariant is omitted', async () => {
    const { getByText } = await render(
      <SegmentedControl
        options={['a', 'b']}
        selected="a"
        onSelect={jest.fn()}
        accessibilityLabel="Mode"
      />,
    );

    expect(getByText('a').props.variant).toBe('body');
  });

  it('applies an explicit labelVariant to the segment label, subordinate to its own section label', async () => {
    const { getByText } = await render(
      <SegmentedControl
        options={['a', 'b']}
        selected="a"
        onSelect={jest.fn()}
        accessibilityLabel="Mode"
        labelVariant="caption"
      />,
    );

    expect(getByText('a').props.variant).toBe('caption');
  });
});
