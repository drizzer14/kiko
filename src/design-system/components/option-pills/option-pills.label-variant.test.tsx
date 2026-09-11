import { render } from '@testing-library/react-native';

import '../../unistyles';

import OptionPills from './option-pills.component';

// The jest unistyles mock strips every resolved variant style (fontSize
// included) from a rendered node's style, since `Text` resolves its variant
// through `styles.useVariants(...)`, which the mock does not compute — the
// same caveat documented in
// `trend-filter-field.section-header-tone.test.tsx`. Mock the shared `Text`
// primitive with a passthrough that forwards its `variant` prop onto the
// host node instead, so `labelVariant` can be asserted from the PROP it
// actually drives rather than a resolved `fontSize` the mock cannot produce.
// Kept in its own file (rather than a describe block inside
// `option-pills.component.test.tsx`) so this file-wide module mock never
// touches that file's other assertions, which render the real `Text`.
jest.mock('../text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({ children, variant }: { children: React.ReactNode; variant?: string }) =>
    React.createElement(RNText, { variant }, children);

  return { __esModule: true, default: MockText };
});

describe('OptionPills labelVariant', () => {
  it('defaults the pill label to the body variant when labelVariant is omitted', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} />,
    );

    expect(getByText('30').props.variant).toBe('body');
  });

  it('applies an explicit labelVariant to the pill label', async () => {
    const { getByText } = await render(
      <OptionPills options={[0, 30]} selected={30} onSelect={jest.fn()} labelVariant="caption" />,
    );

    expect(getByText('30').props.variant).toBe('caption');
  });
});
