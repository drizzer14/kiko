import { act, fireEvent, render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import '../../../i18n';
import type { TrendFilter } from '../../../statistics/trend-filter';

import TrendFilterField from './trend-filter-field.component';

// The jest unistyles mock strips every resolved variant style (fontSize
// included) from a rendered node's style, since `Text` resolves its
// variant/tone through `styles.useVariants(...)`, which the mock does not
// compute — so neither the tone's resolved color nor the variant's resolved
// `fontSize` can be asserted from the rendered style. Mock the shared `Text`
// primitive with a passthrough that forwards both its `tone` AND `variant`
// props onto the host node instead, so the test can read the PROPS that
// drive the color and the type-scale step.
jest.mock('../../../design-system/components/text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({
    children,
    tone,
    variant,
  }: {
    children: React.ReactNode;
    tone?: string;
    variant?: string;
  }) => {
    return React.createElement(RNText, { tone, variant }, children);
  };

  return { __esModule: true, default: MockText };
});

const FIELD_ID = 'trend-filter';

const openSheet = async (filter: TrendFilter): ReturnType<typeof render> => {
  const utilities = await render(
    <TrendFilterField
      testID={FIELD_ID}
      filter={filter}
      categoryOptions={[{ value: 'groceries', label: 'Groceries' }]}
      onSave={() => {}}
    />,
  );

  await act(async () => {
    fireEvent.press(utilities.getByTestId(FIELD_ID));
  });

  return utilities;
};

describe('TrendFilterField section header tone', () => {
  it('gives the top-mode section headers the white textPrimary tone', async () => {
    const { getByText } = await openSheet({ mode: 'top', amount: 3, by: 'contribution' });

    // The section headers read as strong white sub-headings, not the dim grey
    // (`textSecondary`) they were before, so the grouped hierarchy is legible.
    expect(getByText('Selection').props.tone).toBe('textPrimary');
    expect(getByText('Amount').props.tone).toBe('textPrimary');
    expect(getByText('By').props.tone).toBe('textPrimary');
  });

  it('gives the manual-mode categories header the white textPrimary tone', async () => {
    const { getByText } = await openSheet({ mode: 'manual', keys: [] });

    expect(getByText('Categories').props.tone).toBe('textPrimary');
  });
});

describe('TrendFilterField label/value type hierarchy', () => {
  // The sheet title (`heading`, 20) > each section label (`body`, 16, raised
  // from the former `caption`, 13) > its OptionPills value (`caption`, 13,
  // dropped from the former hardcoded `body`) — the label must read strictly
  // larger than the value it sits above, reversing the inverted hierarchy
  // this was reported against.
  it('renders each top-mode section label at body and its OptionPills value at caption', async () => {
    const { getByText } = await openSheet({ mode: 'top', amount: 3, by: 'contribution' });

    expect(getByText('Selection').props.variant).toBe('body');
    expect(getByText('Amount').props.variant).toBe('body');
    expect(getByText('By').props.variant).toBe('body');

    // The Selection group's own pill values ("Manual" / "Top"), the Amount
    // group's numeric pill values, and the By group's measure pill values.
    expect(getByText('Manual').props.variant).toBe('caption');
    expect(getByText('Top').props.variant).toBe('caption');
    expect(getByText('5').props.variant).toBe('caption');
    expect(getByText('Contribution').props.variant).toBe('caption');
  });

  it('keeps the sheet title (heading) strictly above the manual-mode categories label (body)', async () => {
    const { getByText } = await openSheet({ mode: 'manual', keys: [] });

    expect(getByText('Filters').props.variant).toBe('heading');
    expect(getByText('Categories').props.variant).toBe('body');
  });
});
