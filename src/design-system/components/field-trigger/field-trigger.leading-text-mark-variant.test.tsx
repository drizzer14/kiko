import { render } from '@testing-library/react-native';

import '../../unistyles';

import FieldTrigger from '.';

// The jest unistyles mock strips every resolved variant style (fontSize
// included) from a rendered node's style, since `Text` resolves its variant
// through `styles.useVariants(...)`, which the mock does not compute — the
// same caveat documented in
// `trend-filter-field.section-header-tone.test.tsx` and
// `option-pills.label-variant.test.tsx`. Mock the shared `Text` primitive
// with a passthrough that forwards its `variant` prop onto the host node
// instead, so the leading text mark's type step can be asserted from the
// PROP that actually drives it rather than a resolved `fontSize` the mock
// cannot produce. Kept in its own file (rather than inside
// `field-trigger.component.test.tsx`) so this file-wide module mock never
// touches that file's other assertions, which render the real `Text`.
jest.mock('../text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({ children, variant }: { children: React.ReactNode; variant?: string }) =>
    React.createElement(RNText, { variant }, children);

  return { __esModule: true, default: MockText };
});

// DEVICE BUG (review, 2026-09-14): the leading text mark (e.g.
// CurrencyField's trigger currency symbol) used to be sized to
// `theme.iconSizes.body` (an ICON size) via an inline `fontSize` override, so
// it read visibly larger than the value text beside it — the same device bug
// SelectableRow's own leading mark was fixed for (see
// `selectable-row.styles.ts`'s `leadingTextMark` doc comment). The mark must
// inherit `theme.typography.body`'s size straight from the SAME
// `variant="body"` prop the value itself uses, never an icon-sized override.
describe('FieldTrigger leading text mark type step', () => {
  it('gives the leading text mark the same `body` variant as the value, not an icon size', async () => {
    const { getByText } = await render(
      <FieldTrigger
        label="Currency"
        onPress={jest.fn()}
        value="UAE Dirham"
        valueTone="textPrimary"
        leadingText="AED"
      />,
    );

    expect(getByText('AED').props.variant).toBe('body');
    expect(getByText('UAE Dirham').props.variant).toBe('body');
  });
});
